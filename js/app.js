/**
 * app.js
 * 主应用逻辑：输入解析、预测流程、渲染、导出 (Main Application Logic)
 *
 * 依赖（通过 <script> 标签在 app.js 之前加载，顺序：predictors → weights → chart → app）：
 *   - predictors.js  → 全局 `predictors` 数组
 *   - weights.js     → backtest / computeWeights / uniformWeights
 *                      / ensemblePredict / computeMethodStats
 *   - chart.js       → setupCanvas / drawLineChart / drawWeightBars
 *
 * 安全规范：
 *   - 永不使用 innerHTML 渲染用户可控内容，统一使用 textContent / createElement + textContent（防 XSS）
 *   - 所有显示数字均通过 formatNumber 处理 null / NaN / Infinity
 *   - 所有输入在处理前进行校验
 *   - 对缺失 DOM 元素进行防御性处理（不抛错）
 */
(function () {
  'use strict';

  // ============================================================
  // 模块级变量 / Module-level state
  // ============================================================

  // Toast 计时器句柄 / toast timer handle
  let toastTimeout = null;

  // 窗口尺寸防抖计时器 / resize debounce timer
  let resizeTimeout = null;

  // 分类配色表 / category color map (inline style.backgroundColor)
  const CATEGORY_COLORS = {
    basic: '#8b4513',
    smoothing: '#1e90ff',
    regression: '#228b22',
    autoregressive: '#9370db',
    other: '#ffd700'
  };

  // 主应用状态 / main app state
  const state = {
    series: [],               // 当前输入序列 number[]
    stats: [],                // 方法统计列表（来自 computeMethodStats）
    weightMode: 'backtest',   // 'backtest' | 'uniform'
    weights: [],              // 当前权重 number[]（和为 1）
    ensemble: null,           // 当前融合预测（单值，兼容旧代码） number|null
    ensemblePredictions: [],  // 融合预测数组（多步） number[]
    nnPredictions: [],        // 神经网络预测值数组（多步） number[]
    fitCurve: null,           // 拟合曲线 { evaluate, degree, formula, domain, range, r2 } | null
    overfitResult: null,      // 过拟合结果 { methods, ensemble, predictions } | null
    offsetResult: null        // 偏移算法结果 { best, candidates, isExactMatch } | null
  };

  // 训练动画状态 / training animation state
  let trainingInProgress = false;
  let trainingTimeoutId = null;  // 用于取消 / for cancellation

  // ============================================================
  // Part 1: 输入解析与校验 / Input Parsing & Validation
  // ============================================================

  /**
   * parseSequence(text) → { values: number[], ignored: number }
   * 按空白 / 逗号 / 分号 / 换行切分文本，解析为数值数组。
   * 非法 token（非数字或非有限值）计入 ignored 并跳过。
   */
  function parseSequence(text) {
    const values = [];
    let ignored = 0;
    if (typeof text !== 'string') {
      return { values: values, ignored: ignored };
    }
    // \s 已包含换行，故可处理多行输入
    const tokens = text.split(/[\s,;]+/);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '') continue;            // 空字符串跳过
      const n = Number(token);
      if (Number.isNaN(n)) {                  // 非数字
        ignored++;
        continue;
      }
      if (!Number.isFinite(n)) {              // Infinity / -Infinity
        ignored++;
        continue;
      }
      values.push(n);
    }
    return { values: values, ignored: ignored };
  }

  /**
   * showToast(message, durationMs = 2500)
   * 显示 toast 提示，durationMs 后自动隐藏。
   * 仅使用 textContent（绝不使用 innerHTML，防 XSS）。
   */
  function showToast(message, durationMs) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
      durationMs = 2500;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;                // XSS 防护：仅 textContent
    el.style.display = 'block';
    if (toastTimeout !== null) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
    toastTimeout = setTimeout(function () {
      el.style.display = 'none';
      toastTimeout = null;
    }, durationMs);
  }

  /**
   * validateInput(values) → boolean
   * 校验输入序列长度 ≥ 2，否则提示并返回 false。
   */
  function validateInput(values) {
    if (!Array.isArray(values) || values.length < 2) {
      showToast('至少需要 2 个数字');
      return false;
    }
    return true;
  }

  // ============================================================
  // Part 2: 当前权重 / Current Weights
  // ============================================================

  /**
   * getCurrentWeights() → number[]
   * 根据当前权重模式返回权重数组（和为 1）。
   */
  function getCurrentWeights() {
    if (state.weightMode === 'uniform') {
      return uniformWeights(predictors, state.series);
    }
    return computeWeights(predictors, state.series); // 默认 backtest
  }

  // ============================================================
  // Part 2.5: 多步预测 + 神经网络融合 / Multi-step + NN Ensemble
  // ============================================================

  /**
   * getPredictCount() → number
   * 读取预测数量输入框，默认为 1，范围 1..50。
   */
  function getPredictCount() {
    const input = document.getElementById('predict-count');
    if (!input) return 1;
    let n = parseInt(input.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 50) n = 50;
    return n;
  }

  /**
   * computeMultiStepPredictions(series, steps, weights) → { mathPreds: number[], ensemble: number[] }
   *
   * 用各数学方法迭代预测 steps 步：每一步基于当前序列+之前的预测值预测下一步，
   * 然后用权重融合得到该步的融合值，再把融合值加入序列用于下一步预测。
   * 返回 mathPreds：各方法对第一步的预测值数组（用于方法列表展示）；
   * ensemble：每一步的融合预测值数组（长度 steps）。
   */
  function computeMultiStepPredictions(series, steps, weights) {
    const mathPreds = [];
    const ensemble = [];
    const workingSeries = series.slice();

    for (let s = 0; s < steps; s++) {
      const preds = predictors.map(function (p) {
        try { return p.predict(workingSeries); }
        catch (e) { return null; }
      });
      const ensVal = ensemblePredict(preds, weights);
      ensemble.push(ensVal);
      if (s === 0) {
        // 第一步各方法预测用于方法列表展示
        for (let i = 0; i < predictors.length; i++) {
          mathPreds.push({
            id: predictors[i].id,
            name: predictors[i].name,
            category: predictors[i].category,
            minLen: predictors[i].minLen,
            prediction: preds[i],
            mape: computeSingleMape(predictors[i], workingSeries)
          });
        }
      }
      // 用融合值扩展序列用于下一步
      workingSeries.push(ensVal);
    }

    return { mathPreds: mathPreds, ensemble: ensemble };
  }

  /**
   * computeSingleMape(predictor, series) → number
   * 计算单个预测器在给定序列上的 MAPE（简化版，和 backtest 一致）。
   */
  function computeSingleMape(predictor, series) {
    if (!series || series.length < 3) return Infinity;
    let totalAPE = 0, count = 0;
    for (let i = 2; i < series.length; i++) {
      const hist = series.slice(0, i);
      const pred = predictor.predict(hist);
      const actual = series[i];
      if (pred === null || pred === undefined || !isFinite(pred)) continue;
      if (actual === 0) continue;
      totalAPE += Math.abs((pred - actual) / actual);
      count++;
    }
    if (count === 0) return Infinity;
    return totalAPE / count;
  }

  // ============================================================
  // Part 3: 预测流程 / Prediction Flow
  // ============================================================

  /**
   * sleep(ms) → Promise
   * 训练动画延时辅助；同时把 timeout 句柄记录到 trainingTimeoutId，
   * 以便 resetAll 能取消当前挂起的 sleep（仅追踪最新一个）。
   */
  function sleep(ms) {
    return new Promise(function (resolve) {
      trainingTimeoutId = setTimeout(resolve, ms);
    });
  }

  /**
   * setTrainingProgress(current, total, label)
   * 控制 #training-progress 容器与进度条的显示/更新。
   * total <= 0 → 隐藏容器；否则显示并设置标签与宽度。
   * 对缺失 DOM 元素进行防御性处理。
   */
  function setTrainingProgress(current, total, label) {
    const progressEl = document.getElementById('training-progress');
    if (!progressEl) return;
    if (typeof total !== 'number' || total <= 0) {
      progressEl.style.display = 'none';
      return;
    }
    progressEl.style.display = 'block';
    const labelEl = document.getElementById('progress-label');
    if (labelEl) labelEl.textContent = label || '';
    const fillEl = document.getElementById('progress-fill');
    if (fillEl) {
      const pct = Math.max(0, Math.min(100, (current / total) * 100));
      fillEl.style.width = pct + '%';
    }
  }

  /**
   * setPredictButtonEnabled(enabled)
   * 启用/禁用预测按钮（同时切换文案）与权重模式单选。
   */
  function setPredictButtonEnabled(enabled) {
    const btn = document.getElementById('btn-predict');
    if (btn) {
      btn.disabled = !enabled;
      btn.textContent = enabled ? '预测' : '训练中...';
    }
    const radios = document.querySelectorAll('input[name="weight-mode"]');
    for (let i = 0; i < radios.length; i++) {
      radios[i].disabled = !enabled;
    }
  }

  /**
   * runPrediction()
   * 读取输入 → 解析 → 校验 → 启动训练动画。
   * 训练进行中再次点击将被忽略（防重入）。
   */
  function runPrediction() {
    if (trainingInProgress) return;  // 防止重复点击 / prevent double-click
    const textarea = document.getElementById('input-series');
    if (!textarea) return;
    const text = textarea.value || '';
    const parsed = parseSequence(text);
    if (parsed.ignored > 0) {
      showToast('已忽略 ' + parsed.ignored + ' 个非法值');
    }
    if (!validateInput(parsed.values)) return;
    runTrainingAnimation(parsed.values);
  }

  /**
   * runTrainingAnimation(series) → Promise<void>
   *
   * 渐进式训练动画编排：
   *   1. 禁用预测按钮、显示训练 UI、重置图表动画状态。
   *   2. 计算渐进式回测步（computeIncrementalBacktest）。
   *   3. 初始绘制：折线图显示输入序列（尚无预测），权重条为均匀权重。
   *   4. 逐步播放：权重条形图过渡动画（400ms）+ 折线图回测点入场动画（300ms）。
   *   5. 训练完成后用完整序列执行最终预测并刷新全部 UI。
   *   6. 收尾：隐藏进度条、恢复按钮、置 trainingInProgress=false。
   *
   * 取消：resetAll 把 trainingInProgress 置 false 并清当前 timeout，
   * 循环顶部与关键 await 后会检测该标志并提前 return。
   */
  async function runTrainingAnimation(series) {
    // 1. 禁用按钮、显示训练 UI / disable predict, show training UI
    trainingInProgress = true;
    setPredictButtonEnabled(false);

    const lineCanvas = document.getElementById('line-chart');
    const weightCanvas = document.getElementById('weight-chart');

    // 2. 重置图表状态（全新动画）/ reset chart states for fresh animation
    if (typeof resetLineChartState === 'function') resetLineChartState();
    if (typeof resetWeightBarAnimState === 'function') resetWeightBarAnimState();

    // 3. 计算渐进式回测步 / compute incremental backtest steps
    const steps = computeIncrementalBacktest(predictors, series);
    const totalSteps = steps.length;

    // 4. 初始绘制：输入序列上折线图，权重条用均匀权重 / initial draw
    const initialWeights = uniformWeights(predictors, series);
    state.series = series;
    state.weights = initialWeights;
    state.stats = computeMethodStats(predictors, series);
    state.ensemble = null;  // 训练期间尚无最终预测 / no final prediction yet
    state.ensemblePredictions = [];
    state.nnPredictions = [];
    state.fitCurve = null;
    if (lineCanvas) drawLineChart(lineCanvas, series, [], state.stats, null);
    if (weightCanvas) drawWeightBars(weightCanvas, state.stats, initialWeights);

    // 5. 逐步播放训练动画 / run each training step with animation
    if (totalSteps === 0) {
      // 数据不足以训练（series.length < 3）/ not enough data to train
      setTrainingProgress(0, 0, '');
      await sleep(200);
    } else {
      for (let i = 0; i < totalSteps; i++) {
        if (!trainingInProgress) return;  // 被取消 / cancelled
        const stepData = steps[i];
        setTrainingProgress(
          i + 1, totalSteps,
          '训练中 step ' + (i + 1) + ' / ' + totalSteps
        );

        // 构建 animateLineChartStep 需要的 methodPredictions / build methodPreds
        const methodPreds = state.stats.map(function (s, idx) {
          return {
            id: s.id,
            name: s.name,
            category: s.category,
            prediction: stepData.methodPredictions[idx]
          };
        });

        // 本步融合预测 / ensemble for this step using step's weights
        const stepEnsemble = ensemblePredict(
          stepData.methodPredictions,
          stepData.weights
        );

        // 更新权重到本步权重（供方法列表展示）
        state.weights = stepData.weights;

        // 权重条形图过渡动画（与折线图动画并发，不 await）
        if (weightCanvas && typeof animateWeightBarsUpdate === 'function') {
          animateWeightBarsUpdate(weightCanvas, state.stats, stepData.weights);
        }

        // 折线图新增回测预测点（入场动画 300ms）
        if (lineCanvas && typeof animateLineChartStep === 'function') {
          await animateLineChartStep(lineCanvas, {
            step: stepData.step,
            predictIndex: stepData.predictIndex,
            actual: stepData.actual,
            methodPredictions: methodPreds,
            ensemblePrediction: stepEnsemble
          });
        }

        if (!trainingInProgress) return;  // 被取消 / cancelled

        // 渲染方法列表（含最新权重）/ refresh method list
        renderMethodList();

        // 步间小间隔（动画本身约 300-400ms，补足至约 750ms 节奏）
        await sleep(450);
      }
    }

    // 6. 训练完成，执行最终预测 / training complete, final prediction
    if (!trainingInProgress) return;  // 被取消 / cancelled
    setTrainingProgress(totalSteps, totalSteps, '训练完成，执行最终预测...');
    await sleep(300);
    if (!trainingInProgress) return;  // 被取消 / cancelled

    // 读取预测数量 / read predict count
    const predSteps = getPredictCount();

    // 用完整序列基于当前权重模式重新计算 / final prediction with full series
    state.weights = getCurrentWeights();
    state.stats = computeMethodStats(predictors, series);

    // 多步数学预测（融合结果仅基于20种数学方法）/ multi-step math predictions
    const multiStep = computeMultiStepPredictions(series, predSteps, state.weights);
    state.ensemblePredictions = multiStep.ensemble;
    state.ensemble = multiStep.ensemble.length > 0 ? multiStep.ensemble[0] : null;

    // 更新 stats 为第一步各方法预测 / update stats to first-step method predictions
    if (multiStep.mathPreds.length > 0) {
      state.stats = multiStep.mathPreds;
    }

    // 函数拟合 / function fitting
    if (typeof funcFit !== 'undefined' && funcFit.fit) {
      try {
        state.fitCurve = funcFit.fit(series);
      } catch (e) {
        console.warn('[app] function fit failed:', e);
        state.fitCurve = null;
      }
    }

    // 过拟合算法 / overfitting algorithm
    if (typeof overfitAlgo !== 'undefined' && overfitAlgo.fit) {
      try {
        state.overfitResult = overfitAlgo.fit(series);
      } catch (e) {
        console.warn('[app] overfit failed:', e);
        state.overfitResult = null;
      }
    }

    // 偏移算法 / offset fitting algorithm
    if (typeof offsetFit !== 'undefined' && offsetFit.fit) {
      try {
        state.offsetResult = offsetFit.fit(series);
      } catch (e) {
        console.warn('[app] offset fit failed:', e);
        state.offsetResult = null;
      }
    }

    // 先渲染数学方法结果 / render math methods first
    renderAll();

    // 神经网络预测（独立，不参与融合）/ NN prediction (independent, not in ensemble)
    // 渐进式训练：用前几个数字预测下一个，误差在±0.1内才训练下一组
    const nnCanvas = document.getElementById('nn-canvas');
    let nnPreds = [];
    if (nnCanvas && typeof neuralNet !== 'undefined' && neuralNet.progressiveTrain) {
      setTrainingProgress(1, 2, '神经网络渐进训练中...');
      try {
        nnPreds = await neuralNet.progressiveTrain(nnCanvas, series, predSteps, function (cur, total, stage) {
          setTrainingProgress(cur, total, stage);
        });
      } catch (e) {
        console.warn('[app] NN prediction failed:', e);
        nnPreds = [];
      }
    }
    state.nnPredictions = nnPreds;
    renderNNResult();

    // 7. 收尾 / cleanup
    setTrainingProgress(0, 0, '');  // 隐藏进度条 / hides progress
    setPredictButtonEnabled(true);
    trainingInProgress = false;
    showToast('预测完成');
  }

  /**
   * renderAll()
   * 渲染全部 UI 区域。
   */
  function renderAll() {
    renderEnsemble();
    renderMethodList();
    renderLineChart();
    renderWeightBars();
    renderNNResult();
    renderFunctionFit();
    renderOverfit();
    renderOffset();
  }

  /**
   * formatNumber(n) → string
   * null / undefined / 非有限值 → '—'；整数原样输出；
   * 小数保留 4 位并去除尾随零。
   */
  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    if (!Number.isFinite(n)) return '—';
    if (Number.isInteger(n)) return String(n);
    // toFixed(4) 后用 parseFloat 去除尾随零
    return parseFloat(n.toFixed(4)).toString();
  }

  /**
   * renderEnsemble()
   * 渲染融合预测结果区域（列表格式）。
   */
  function renderEnsemble() {
    const el = document.getElementById('ensemble-result');
    if (!el) return;
    const preds = state.ensemblePredictions;
    if (!preds || preds.length === 0) {
      el.textContent = '— 等待输入 —';
      return;
    }
    // 列表格式：[v1, v2, v3] / list format
    const parts = preds.map(function (p) { return formatNumber(p); });
    el.textContent = '[' + parts.join(', ') + ']';
  }

  /**
   * renderNNResult()
   * 渲染神经网络预测结果（独立，不参与融合）。
   */
  function renderNNResult() {
    const el = document.getElementById('nn-result');
    if (!el) return;
    const preds = state.nnPredictions;
    if (!preds || preds.length === 0) {
      el.textContent = '— 等待输入 —';
      return;
    }
    // 列表格式：[v1, v2, v3] / list format
    const parts = preds.map(function (p) { return formatNumber(p); });
    el.textContent = '[' + parts.join(', ') + ']';
  }

  /**
   * renderFunctionFit()
   * 渲染函数拟合面板。
   */
  function renderFunctionFit() {
    const panel = document.getElementById('function-fit-panel');
    const formulaEl = document.getElementById('fit-formula');
    const domainEl = document.getElementById('fit-domain');
    const rangeEl = document.getElementById('fit-range');
    const r2El = document.getElementById('fit-r2');
    if (!panel) return;

    const fc = state.fitCurve;
    if (!fc) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    if (formulaEl) formulaEl.textContent = fc.formula || 'f(x) = —';
    if (domainEl) domainEl.textContent = '定义域: ' + (fc.domain || '—');
    if (rangeEl) rangeEl.textContent = '值域: ' + (fc.range || '—');
    if (r2El) r2El.textContent = 'R²: ' + (fc.rSquared !== undefined ? fc.rSquared.toFixed(4) : '—');
  }

  /**
   * renderOverfit()
   * 渲染过拟合算法面板。
   * 使用 DOM API，绝不使用 innerHTML。
   */
  function renderOverfit() {
    const panel = document.getElementById('overfit-panel');
    const resultEl = document.getElementById('overfit-result');
    const detailsEl = document.getElementById('overfit-details');
    if (!panel) return;

    const or = state.overfitResult;
    if (!or) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    if (resultEl) {
      resultEl.textContent = formatNumber(or.ensemble);
    }

    if (detailsEl) {
      while (detailsEl.firstChild) {
        detailsEl.removeChild(detailsEl.firstChild);
      }

      let totalWeight = 0;
      if (or.methods) {
        for (let i = 0; i < or.methods.length; i++) {
          totalWeight += or.methods[i].weight || 0;
        }
      }

      if (or.methods) {
        for (let i = 0; i < or.methods.length; i++) {
          const m = or.methods[i];
          const item = document.createElement('div');
          item.className = 'overfit-item';

          const nameEl = document.createElement('span');
          nameEl.className = 'of-name';
          nameEl.textContent = m.name;

          const rightEl = document.createElement('span');
          rightEl.style.display = 'flex';
          rightEl.style.alignItems = 'center';

          const valEl = document.createElement('span');
          valEl.className = 'of-value';
          valEl.textContent = formatNumber(m.prediction);

          const weightEl = document.createElement('span');
          weightEl.className = 'of-weight';
          if (totalWeight > 0) {
            weightEl.textContent = ((m.weight || 0) / totalWeight * 100).toFixed(1) + '%';
          } else {
            weightEl.textContent = '—';
          }

          rightEl.appendChild(valEl);
          rightEl.appendChild(weightEl);

          item.appendChild(nameEl);
          item.appendChild(rightEl);
          detailsEl.appendChild(item);
        }
      }
    }
  }

  /**
   * renderOffset()
   * 渲染偏移算法面板。
   */
  function renderOffset() {
    const panel = document.getElementById('offset-panel');
    const formulaEl = document.getElementById('offset-formula');
    const typeEl = document.getElementById('offset-type');
    const r2El = document.getElementById('offset-r2');
    const exactEl = document.getElementById('offset-exact');
    const resultEl = document.getElementById('offset-result');
    if (!panel) return;

    const os = state.offsetResult;
    if (!os || !os.best) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    const best = os.best;
    if (formulaEl) formulaEl.textContent = best.formula || 'f(x) = —';
    if (typeEl) typeEl.textContent = '类型: ' + (best.functionName || '—');
    if (r2El) {
      const r2 = best.rSquared;
      r2El.textContent = 'R²: ' + (typeof r2 === 'number' && isFinite(r2) ? r2.toFixed(4) : '—');
    }
    if (exactEl) {
      if (os.isExactMatch) {
        exactEl.textContent = '✓ 精确匹配';
        exactEl.className = 'exact-match';
      } else {
        exactEl.textContent = '最接近';
        exactEl.className = 'closest-match';
      }
    }
    if (resultEl) {
      resultEl.textContent = '预测: ' + formatNumber(best.prediction);
    }
  }

  /**
   * renderMethodList()
   * 渲染方法详情列表（使用 DOM API，绝不使用 innerHTML）。
   */
  function renderMethodList() {
    const el = document.getElementById('method-list');
    if (!el) return;
    // 清空：逐个移除子节点 / clear children without innerHTML
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    if (state.stats.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '— 等待预测 —';
      el.appendChild(empty);
      return;
    }
    for (let i = 0; i < state.stats.length; i++) {
      const m = state.stats[i];
      const item = document.createElement('div');
      item.className = 'method-item';

      // 分类色块 / category color swatch
      const cat = document.createElement('span');
      cat.className = 'method-category';
      cat.style.backgroundColor = CATEGORY_COLORS[m.category] || '#808080';
      cat.style.display = 'inline-block';
      cat.style.width = '12px';
      cat.style.height = '12px';
      cat.style.borderRadius = '2px';
      cat.style.verticalAlign = 'middle';

      // 方法名 / method name
      const name = document.createElement('span');
      name.className = 'method-name';
      name.textContent = m.name;

      // 预测值 / prediction
      const val = document.createElement('span');
      val.className = 'method-value';
      if (m.prediction === null || m.prediction === undefined) {
        const minLen = m.minLen;
        if (minLen !== undefined && minLen !== null && state.series.length < minLen) {
          val.textContent = '还差 ' + (minLen - state.series.length) + ' 个';
        } else {
          val.textContent = '预测失败';
        }
      } else {
        val.textContent = formatNumber(m.prediction);
      }

      // 权重百分比 / weight percentage
      const w = document.createElement('span');
      w.className = 'method-weight';
      w.textContent = ((state.weights[i] || 0) * 100).toFixed(2) + '%';

      // MAPE 回测误差 / backtest MAPE
      const mapeEl = document.createElement('span');
      mapeEl.className = 'method-mape';
      if (m.mape === Infinity || !Number.isFinite(m.mape)) {
        mapeEl.textContent = '—';
      } else {
        mapeEl.textContent = (m.mape * 100).toFixed(2) + '%';
      }

      item.appendChild(cat);
      item.appendChild(name);
      item.appendChild(val);
      item.appendChild(w);
      item.appendChild(mapeEl);
      el.appendChild(item);
    }
  }

  /**
   * renderLineChart()
   * 渲染折线图（多步预测 + 拟合曲线）。
   */
  function renderLineChart() {
    const canvas = document.getElementById('line-chart');
    if (!canvas) return;
    drawLineChart(
      canvas,
      state.series,
      state.ensemblePredictions,
      state.stats,
      state.fitCurve
    );
  }

  /**
   * renderWeightBars()
   * 渲染权重条形图。
   */
  function renderWeightBars() {
    const canvas = document.getElementById('weight-chart');
    if (!canvas) return;
    drawWeightBars(canvas, state.stats, state.weights);
  }

  // ============================================================
  // Part 4: 权重模式切换 / Weight Mode Toggle
  // ============================================================

  /**
   * onWeightModeChange()
   * 切换权重模式后重新计算权重与融合预测并重渲染。
   * 训练进行中忽略切换（按钮已被禁用，但此处再次防御）。
   */
  function onWeightModeChange() {
    if (trainingInProgress) return;  // 训练中忽略 / ignore during training
    const checked = document.querySelector('input[name="weight-mode"]:checked');
    if (!checked) return;
    state.weightMode = checked.value;
    if (state.series.length === 0) return; // 无数据可重算
    state.weights = getCurrentWeights();
    const predSteps = getPredictCount();
    const multiStep = computeMultiStepPredictions(state.series, predSteps, state.weights);
    state.ensemblePredictions = multiStep.ensemble;
    state.ensemble = multiStep.ensemble.length > 0 ? multiStep.ensemble[0] : null;
    if (multiStep.mathPreds.length > 0) {
      state.stats = multiStep.mathPreds;
    }
    renderAll();
  }

  // ============================================================
  // Part 5: 重置 / Reset
  // ============================================================

  /**
   * clearCanvas(canvas)
   * 清空画布内容（防御性，canvas / ctx 缺失则跳过）。
   */
  function clearCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * resetAll()
   * 重置全部状态与 UI。
   * 若训练动画进行中，先取消（置 trainingInProgress=false、清挂起 timeout、
   * 重置图表动画状态、隐藏进度条、恢复按钮）。
   */
  function resetAll() {
    // 取消训练动画 / cancel any running training animation
    trainingInProgress = false;
    if (trainingTimeoutId !== null) {
      clearTimeout(trainingTimeoutId);
      trainingTimeoutId = null;
    }
    if (typeof resetLineChartState === 'function') resetLineChartState();
    if (typeof resetWeightBarAnimState === 'function') resetWeightBarAnimState();
    setTrainingProgress(0, 0, '');  // 隐藏训练进度条 / hide training progress
    setPredictButtonEnabled(true);

    const textarea = document.getElementById('input-series');
    if (textarea) textarea.value = '';

    state.series = [];
    state.stats = [];
    state.weights = [];
    state.ensemble = null;
    state.ensemblePredictions = [];
    state.nnPredictions = [];
    state.fitCurve = null;
    state.overfitResult = null;
    state.offsetResult = null;

    const ensembleEl = document.getElementById('ensemble-result');
    if (ensembleEl) ensembleEl.textContent = '— 等待输入 —';

    const nnResultEl = document.getElementById('nn-result');
    if (nnResultEl) nnResultEl.textContent = '— 等待输入 —';

    const funcFitPanel = document.getElementById('function-fit-panel');
    if (funcFitPanel) funcFitPanel.style.display = 'none';

    const overfitPanel = document.getElementById('overfit-panel');
    if (overfitPanel) overfitPanel.style.display = 'none';

    const offsetPanel = document.getElementById('offset-panel');
    if (offsetPanel) offsetPanel.style.display = 'none';

    const listEl = document.getElementById('method-list');
    if (listEl) {
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      const empty = document.createElement('div');
      empty.textContent = '— 等待预测 —';
      listEl.appendChild(empty);
    }

    clearCanvas(document.getElementById('line-chart'));
    clearCanvas(document.getElementById('weight-chart'));
    clearCanvas(document.getElementById('nn-canvas'));

    showToast('已重置');
  }

  // ============================================================
  // Part 6: 数据导出 / Data Export
  // ============================================================

  /**
   * getTimestamp() → string
   * 返回 YYYYMMDDHHMMSS 格式时间戳（每段补零至 2 位）。
   */
  function getTimestamp() {
    const d = new Date();
    const pad = function (n) {
      const s = String(n);
      return s.length < 2 ? '0' + s : s;
    };
    return '' +
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
  }

  /**
   * downloadBlob(blob, filename)
   * 通过临时 <a> 触发文件下载，并释放对象 URL。
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 100);
  }

  /**
   * csvEscape(s) → string
   * CSV 字段转义：包含逗号 / 引号 / 换行时用双引号包裹，内部引号双写。
   */
  function csvEscape(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 ||
        s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * exportJSON()
   * 导出预测结果为 JSON 文件。
   */
  function exportJSON() {
    if (state.series.length === 0) {
      showToast('请先输入并预测');
      return;
    }
    const obj = {
      timestamp: new Date().toISOString(),
      input: state.series,
      weightMode: state.weightMode,
      ensemblePrediction: state.ensemble,
      ensemblePredictions: state.ensemblePredictions,
      nnPredictions: state.nnPredictions,
      fitCurve: state.fitCurve ? {
        degree: state.fitCurve.degree,
        formula: state.fitCurve.formula,
        domain: state.fitCurve.domain,
        range: state.fitCurve.range,
        r2: state.fitCurve.rSquared
      } : null,
      overfitResult: state.overfitResult ? {
        ensemble: state.overfitResult.ensemble,
        methods: state.overfitResult.methods ? state.overfitResult.methods.map(function (m) {
          return {
            id: m.id,
            name: m.name,
            prediction: m.prediction,
            mape: m.mape,
            weight: m.weight
          };
        }) : []
      } : null,
      offsetResult: state.offsetResult ? {
        best: state.offsetResult.best,
        candidates: state.offsetResult.candidates,
        isExactMatch: state.offsetResult.isExactMatch
      } : null,
      methods: state.stats.map(function (s, i) {
        return {
          id: s.id,
          name: s.name,
          category: s.category,
          prediction: s.prediction,
          weight: state.weights[i],
          mape: (s.mape === Infinity || !Number.isFinite(s.mape)) ? null : s.mape
        };
      })
    };
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, 'prediction_' + getTimestamp() + '.json');
    showToast('已导出 JSON');
  }

  /**
   * exportCSV()
   * 导出预测结果为 CSV 文件。
   * 表头：id,name,category,prediction,weight,mape
   * 末行追加 ENSEMBLE 汇总（weight=1）。
   */
  function exportCSV() {
    if (state.series.length === 0) {
      showToast('请先输入并预测');
      return;
    }
    const rows = [];
    rows.push('id,name,category,prediction,weight,mape');
    for (let i = 0; i < state.stats.length; i++) {
      const s = state.stats[i];
      const w = state.weights[i];
      const predStr = (s.prediction === null || s.prediction === undefined)
        ? '' : String(s.prediction);
      const wStr = (typeof w === 'number' && Number.isFinite(w))
        ? w.toFixed(6) : '';
      const mapeStr = (s.mape === Infinity || !Number.isFinite(s.mape))
        ? '' : s.mape.toFixed(6);
      rows.push(
        csvEscape(s.id) + ',' +
        csvEscape(s.name) + ',' +
        csvEscape(s.category) + ',' +
        csvEscape(predStr) + ',' +
        csvEscape(wStr) + ',' +
        csvEscape(mapeStr)
      );
    }
    // 集成行：id=ENSEMBLE, name=ENSEMBLE, category=空, prediction=集成值, weight=1, mape=空
    const ensembleStr = (state.ensemble !== null && state.ensemble !== undefined)
      ? String(state.ensemble) : '';
    rows.push('ENSEMBLE,ENSEMBLE,,' + ensembleStr + ',1,');
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'prediction_' + getTimestamp() + '.csv');
    showToast('已导出 CSV');
  }

  // ============================================================
  // Part 7: 窗口尺寸变化 / Resize Handler
  // ============================================================

  /**
   * onResize()
   * 窗口尺寸变化时防抖（150ms）重绘图表。
   */
  function onResize() {
    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout);
      resizeTimeout = null;
    }
    resizeTimeout = setTimeout(function () {
      resizeTimeout = null;
      if (state.series.length > 0) {
        renderLineChart();
        renderWeightBars();
      }
    }, 150);
  }

  // ============================================================
  // Part 8: 初始化 / Initialization
  // ============================================================

  /**
   * init()
   * 绑定事件监听并设置初始 UI 状态。
   */
  function init() {
    // 按钮事件 / button listeners
    const btnPredict = document.getElementById('btn-predict');
    const btnReset = document.getElementById('btn-reset');
    const btnExportJson = document.getElementById('btn-export-json');
    const btnExportCsv = document.getElementById('btn-export-csv');

    if (btnPredict) btnPredict.addEventListener('click', runPrediction);
    if (btnReset) btnReset.addEventListener('click', resetAll);
    if (btnExportJson) btnExportJson.addEventListener('click', exportJSON);
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportCSV);

    // 权重模式单选 / weight-mode radio listeners
    const radios = document.querySelectorAll('input[name="weight-mode"]');
    for (let i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', onWeightModeChange);
    }

    // 窗口尺寸变化 / window resize
    window.addEventListener('resize', onResize);

    // 输入框回车触发预测（Shift+Enter 换行）/ Enter to predict
    const textarea = document.getElementById('input-series');
    if (textarea) {
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          runPrediction();
        }
      });
    }

    // 初始 UI 状态 / initial UI state
    const ensembleEl = document.getElementById('ensemble-result');
    if (ensembleEl) ensembleEl.textContent = '— 等待输入 —';

    const listEl = document.getElementById('method-list');
    if (listEl) {
      // 清空可能存在的占位文本，统一插入占位节点
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      const empty = document.createElement('div');
      empty.textContent = '— 等待预测 —';
      listEl.appendChild(empty);
    }

    console.log('[app] initialized, predictors:', predictors.length);

    // 落地页交互初始化 / landing page interaction
    initLandingPage();
  }

  // ============================================================
  // 落地页交互 / Landing Page Interaction
  // ============================================================
  function initLandingPage() {
    var landing = document.getElementById('landing-page');
    var enterBtn = document.getElementById('btn-enter-predictor');
    if (!landing || !enterBtn) return;

    enterBtn.addEventListener('click', function () {
      landing.classList.add('hidden');
      // 动画结束后完全移除（保持 DOM 但不可见）
      setTimeout(function () {
        // 聚焦到输入框
        var textarea = document.getElementById('input-series');
        if (textarea) textarea.focus();
      }, 600);
    });

    // 支持键盘 Enter 进入
    document.addEventListener('keydown', function (e) {
      if (landing.classList.contains('hidden')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enterBtn.click();
      }
    });
  }

  // ============================================================
  // 启动 / Startup
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================================
  // 自检 / Self-test
  // ============================================================
  console.log('[app] script loaded');
})();
