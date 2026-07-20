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

  // 长期训练模式状态 / long-term training mode state
  let longtermMode = false;
  let longtermSeries = [];
  const LONGTERM_SERIES_KEY = 'longterm_series';
  const LONGTERM_MODE_KEY = 'longterm_mode';

  // 计算器角度模式 / calculator angle mode: 'RAD' or 'DEG'
  let calcAngleMode = 'RAD';

  // 计算器运算过程动画计时器 / calc steps animation timers
  let calcStepsAnimTimers = [];

  // 新工具初始化标志 / new tool init flags（避免重复绑定事件）
  const initFlags = {
    maze: false,
    function3d: false,
    nnvis: false,
    mathext: false,
    physics: false,
    pixelizer: false,
    clock: false,
    rpg: false
  };

  // ============================================================
  // 用户档案 / User Profile (sessionStorage, 临时账号)
  // ============================================================
  const PROFILE_KEY = 'pixel_user_profile';
  let profile = { nickname: '访客', avatar: '', bgType: '', bgValue: '' };

  function loadProfile() {
    try {
      const saved = sessionStorage.getItem(PROFILE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        profile = {
          nickname: parsed.nickname || '访客',
          avatar: parsed.avatar || '',
          bgType: parsed.bgType || '',
          bgValue: parsed.bgValue || ''
        };
        return true;  // 已有 profile
      }
    } catch (e) { /* ignore */ }
    return false;  // 无 profile，需弹窗
  }

  function saveProfile() {
    try {
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        showToast(i18n.t('toast_image_too_big'));
      } else {
        showToast(i18n.t('toast_storage_failed', { msg: e.message || i18n.t('toast_unknown_error') }));
      }
    }
  }

  function clearProfile() {
    try {
      sessionStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* ignore */ }
    profile = { nickname: '访客', avatar: '', bgType: '', bgValue: '' };
  }

  function showRegisterModal() {
    const modal = document.getElementById('register-modal');
    const input = document.getElementById('register-nickname');
    if (!modal) return;
    modal.style.display = 'flex';
    if (input) {
      input.value = '';
      input.placeholder = '访客';
      setTimeout(function () { input.focus(); }, 50);
    }
  }

  function hideRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) modal.style.display = 'none';
  }

  function initRegisterModal() {
    const confirmBtn = document.getElementById('register-confirm');
    const skipBtn = document.getElementById('register-skip');
    const input = document.getElementById('register-nickname');

    function confirmRegister() {
      let nickname = input ? (input.value || '').trim() : '';
      if (!nickname) nickname = i18n.t('floating_avatar_title');
      if (nickname.length > 20) nickname = nickname.slice(0, 20);
      profile.nickname = nickname;
      saveProfile();
      hideRegisterModal();
      updateAppUserBar();
      showToast(i18n.t('toast_welcome', { name: nickname }));
    }

    if (confirmBtn) confirmBtn.addEventListener('click', confirmRegister);
    if (skipBtn) skipBtn.addEventListener('click', function () {
      profile.nickname = i18n.t('floating_avatar_title');
      saveProfile();
      hideRegisterModal();
      updateAppUserBar();
      showToast(i18n.t('toast_default_nickname'));
    });
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmRegister();
      }
    });
  }

  // ============================================================
  // 浮动头像按钮 / Floating Avatar Button
  // ============================================================
  function updateFloatingAvatar() {
    const avatarEl = document.getElementById('floating-avatar');
    if (!avatarEl) return;
    // 标题 tooltip 显示昵称
    avatarEl.title = profile.nickname || i18n.t('guest');
    if (profile.avatar) {
      avatarEl.style.backgroundImage = 'url(' + profile.avatar + ')';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      const firstChar = profile.nickname ? profile.nickname.charAt(0) : '?';
      avatarEl.textContent = firstChar;
    }
  }

  // 兼容旧调用：updateAppUserBar 现在更新 floating-avatar
  function updateAppUserBar() {
    updateFloatingAvatar();
  }

  function initFloatingAvatar() {
    const avatarBtn = document.getElementById('floating-avatar');
    if (avatarBtn) avatarBtn.addEventListener('click', showSettings);
  }

  function initAppUserBar() {
    // 顶部用户栏已删除，仅初始化浮动头像按钮 / top bar removed, only init floating avatar
    initFloatingAvatar();
  }

  // ============================================================
  // 设置页面 / Settings Page
  // ============================================================

  function showSettings() {
    showPage('settings-page');
    if (window.PixelMusic && typeof window.PixelMusic.cleanup === 'function') {
      window.PixelMusic.cleanup();
    }
    // 把当前 profile 状态填入设置页表单
    const nicknameInput = document.getElementById('settings-nickname');
    if (nicknameInput) nicknameInput.value = profile.nickname;
    updateSettingsAvatarPreview();
    const colorInput = document.getElementById('settings-bg-color');
    if (colorInput && profile.bgType === 'color') colorInput.value = profile.bgValue;
  }

  function updateSettingsAvatarPreview() {
    const preview = document.getElementById('settings-avatar-preview');
    if (!preview) return;
    if (profile.avatar) {
      preview.style.backgroundImage = 'url(' + profile.avatar + ')';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      const firstChar = profile.nickname ? profile.nickname.charAt(0) : '?';
      preview.textContent = firstChar;
    }
  }

  // 图片转 base64（带格式/大小校验）
  function readImageFile(file, maxSize, allowedTypes, onSuccess, onError) {
    if (!file) return;
    // 校验类型
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    if (allowedTypes.indexOf(file.type) < 0 && validExts.indexOf(ext) < 0) {
      onError(i18n.t('toast_unsupported_format'));
      return;
    }
    // 校验大小
    if (file.size > maxSize) {
      const maxKB = Math.round(maxSize / 1024);
      onError(i18n.t('toast_file_too_big', { size: maxKB }));
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) { onSuccess(e.target.result); };
    reader.onerror = function () { onError(i18n.t('toast_file_read_error')); };
    reader.readAsDataURL(file);
  }

  /**
   * sanitizeSvgDataUrl(dataUrl) → string | null
   * 安全最佳实践（defense-in-depth）：SVG 可携带 <script>、on* 事件处理器、
   * <foreignObject>、外部资源引用等，虽作为 CSS background-image 时不执行脚本，
   * 但为防止未来渲染方式变更（如改为 innerHTML / <embed> / <object>）导致 XSS，
   * 此处对 SVG data URL 进行消毒：
   *   1. 用 DOMParser 解析 SVG
   *   2. 移除 script / foreignObject / embed / object / iframe / link[stylesheet] 等危险元素
   *   3. 移除所有 on* 事件属性
   *   4. 移除指向 http(s) 的 href / xlink:href（防外链追踪与 SSRF）
   *   5. 重新序列化为 data URL 返回；解析失败或为空返回 null
   */
  function sanitizeSvgDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    // 仅处理 SVG data URL
    const m = dataUrl.match(/^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]*)$/);
    if (!m) return null;
    let svgText;
    try {
      svgText = atob(m[1]);
    } catch (e) {
      return null;
    }
    if (!svgText || svgText.length > 1024 * 1024) return null;  // 防超大 SVG
    let doc;
    try {
      doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    } catch (e) {
      return null;
    }
    if (!doc || !doc.documentElement) return null;
    const root = doc.documentElement;
    // 解析出错时 DOMParser 会返回 <parsererror>，直接拒绝
    if (root.tagName && root.tagName.toLowerCase() === 'parsererror') return null;
    // 移除危险元素 / remove dangerous elements
    const dangerousSelectors = 'script, foreignObject, embed, object, iframe, link[rel="stylesheet"], meta, base';
    const dangerous = root.querySelectorAll(dangerousSelectors);
    for (let i = dangerous.length - 1; i >= 0; i--) {
      const el = dangerous[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    // 移除事件属性与外链引用 / strip event handlers and external refs
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const attrs = el.attributes;
      for (let j = attrs.length - 1; j >= 0; j--) {
        const attr = attrs[j];
        const name = attr.name.toLowerCase();
        const val = attr.value || '';
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'xlink:href') &&
                   (/^https?:/i.test(val) || /^\/\//.test(val) || val.toLowerCase().indexOf('javascript:') === 0)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    // 重新序列化 / re-serialize
    let cleanSvg;
    try {
      cleanSvg = new XMLSerializer().serializeToString(root);
    } catch (e) {
      return null;
    }
    if (!cleanSvg) return null;
    // 重新编码为 base64 data URL（使用 encodeURIComponent + btoa 处理 Unicode）
    let b64;
    try {
      b64 = btoa(unescape(encodeURIComponent(cleanSvg)));
    } catch (e) {
      return null;
    }
    return 'data:image/svg+xml;base64,' + b64;
  }

  /**
   * compressImage(file, maxDim, isAvatar) → Promise<string>
   * 图片压缩：
   *   - 文件 ≤ 500KB：直接 FileReader.readAsDataURL
   *   - 文件 > 500KB：用 Image + canvas 压缩
   *     - 头像（isAvatar=true）：256×256 居中裁剪，JPEG 0.85
   *     - 背景（isAvatar=false）：最长边 ≤ maxDim 保持比例，JPEG 0.8
   * 安全：解码前校验图像像素尺寸，防"解压炸弹"（小文件大像素）导致浏览器卡死
   */
  function compressImage(file, maxDim, isAvatar) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('no file')); return; }

      // 安全：硬性上限，防大文件解析导致内存爆炸
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error(i18n.t('toast_file_10mb')));
        return;
      }

      // 小文件直接用
      if (file.size <= 500 * 1024) {
        const reader = new FileReader();
        reader.onload = function (e) { resolve(e.target.result); };
        reader.onerror = function () { reject(new Error(i18n.t('toast_file_read_error'))); };
        reader.readAsDataURL(file);
        return;
      }

      // 大文件用 canvas 压缩
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          try {
            // 安全：检查图像像素尺寸，防"解压炸弹" / prevent decompression bomb DoS
            const MAX_PIXELS_PER_SIDE = 8192;
            const MAX_TOTAL_PIXELS = 4096 * 4096;
            if (!Number.isFinite(img.width) || !Number.isFinite(img.height) ||
                img.width <= 0 || img.height <= 0) {
              reject(new Error(i18n.t('toast_invalid_size')));
              return;
            }
            if (img.width > MAX_PIXELS_PER_SIDE || img.height > MAX_PIXELS_PER_SIDE) {
              reject(new Error(i18n.t('toast_pixel_too_big', { size: MAX_PIXELS_PER_SIDE })));
              return;
            }
            if (img.width * img.height > MAX_TOTAL_PIXELS) {
              reject(new Error(i18n.t('toast_total_pixel_too_big', { size: MAX_TOTAL_PIXELS })));
              return;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (isAvatar) {
              // 头像：256×256 居中裁剪
              canvas.width = 256;
              canvas.height = 256;
              const srcSize = Math.min(img.width, img.height);
              const sx = (img.width - srcSize) / 2;
              const sy = (img.height - srcSize) / 2;
              ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, 256, 256);
            } else {
              // 背景：保持比例，最长边 ≤ maxDim
              let w = img.width, h = img.height;
              if (w > maxDim || h > maxDim) {
                if (w > h) {
                  h = Math.round(h * maxDim / w);
                  w = maxDim;
                } else {
                  w = Math.round(w * maxDim / h);
                  h = maxDim;
                }
              }
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);
            }

            const base64 = canvas.toDataURL('image/jpeg', isAvatar ? 0.85 : 0.8);
            resolve(base64);
          } catch (err) {
            reject(new Error(i18n.t('toast_image_process_error', { msg: err.message })));
          }
        };
        img.onerror = function () { reject(new Error(i18n.t('toast_image_load_error'))); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error(i18n.t('toast_file_read_error'))); };
      reader.readAsDataURL(file);
    });
  }

  function initSettings() {
    // 保存昵称
    const saveNicknameBtn = document.getElementById('btn-save-nickname');
    const nicknameInput = document.getElementById('settings-nickname');
    if (saveNicknameBtn && nicknameInput) {
      saveNicknameBtn.addEventListener('click', function () {
        let nickname = (nicknameInput.value || '').trim();
        if (!nickname) nickname = i18n.t('floating_avatar_title');
        if (nickname.length > 20) nickname = nickname.slice(0, 20);
        profile.nickname = nickname;
        saveProfile();
        updateAppUserBar();
        updateSettingsAvatarPreview();
        showToast(i18n.t('toast_nickname_updated', { name: nickname }));
      });
    }

    // 头像上传
    const avatarInput = document.getElementById('settings-avatar-input');
    if (avatarInput) {
      avatarInput.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;

        // 校验格式（不限大小，由 compressImage 处理）
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.indexOf(file.type) < 0 && validExts.indexOf(ext) < 0) {
          showToast(i18n.t('toast_unsupported_format'));
          this.value = '';
          return;
        }

        // SVG 不压缩（直接读取），但需校验大小并消毒 / sanitize SVG, no compression
        if (file.type === 'image/svg+xml' || ext === 'svg') {
          // 安全：限制 SVG 文件大小，防 sessionStorage 配额耗尽与解析 DoS
          if (file.size > 200 * 1024) {
            showToast(i18n.t('toast_svg_too_big'));
            this.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = function (e) {
            // 安全：SVG 可能携带 <script>/on* 等，消毒后再存储
            const cleaned = sanitizeSvgDataUrl(e.target.result);
            if (!cleaned) {
              showToast(i18n.t('toast_svg_unsafe'));
              return;
            }
            profile.avatar = cleaned;
            saveProfile();
            updateAppUserBar();
            updateSettingsAvatarPreview();
            showToast(i18n.t('toast_avatar_updated'));
          };
          reader.onerror = function () {
            showToast(i18n.t('toast_file_read_error'));
          };
          reader.readAsDataURL(file);
          this.value = '';
          return;
        }

        // 安全：限制上传文件大小（防 DoS）
        if (file.size > 10 * 1024 * 1024) {
          showToast(i18n.t('toast_file_10mb'));
          this.value = '';
          return;
        }

        // 大文件显示压缩提示
        if (file.size > 500 * 1024) {
          showToast(i18n.t('toast_compressing'));
        }

        compressImage(file, 256, true).then(function (base64) {
          profile.avatar = base64;
          saveProfile();
          updateAppUserBar();
          updateSettingsAvatarPreview();
          showToast(i18n.t('toast_avatar_updated'));
        }).catch(function (err) {
          showToast(err.message || i18n.t('toast_image_process_error', { msg: '' }));
        });
        this.value = '';
      });
    }

    // 清除头像
    const clearAvatarBtn = document.getElementById('btn-clear-avatar');
    if (clearAvatarBtn) {
      clearAvatarBtn.addEventListener('click', function () {
        profile.avatar = '';
        saveProfile();
        updateAppUserBar();
        updateSettingsAvatarPreview();
        showToast(i18n.t('toast_avatar_cleared'));
      });
    }

    // 背景图片上传
    const bgImageInput = document.getElementById('settings-bg-image-input');
    if (bgImageInput) {
      bgImageInput.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;

        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.indexOf(file.type) < 0 && validExts.indexOf(ext) < 0) {
          showToast(i18n.t('toast_unsupported_format'));
          this.value = '';
          return;
        }

        // SVG 不压缩，但需校验大小并消毒 / sanitize SVG, no compression
        if (file.type === 'image/svg+xml' || ext === 'svg') {
          // 安全：限制 SVG 文件大小，防 sessionStorage 配额耗尽与解析 DoS
          if (file.size > 200 * 1024) {
            showToast(i18n.t('toast_svg_too_big'));
            this.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = function (e) {
            // 安全：SVG 可能携带 <script>/on* 等，消毒后再存储
            const cleaned = sanitizeSvgDataUrl(e.target.result);
            if (!cleaned) {
              showToast(i18n.t('toast_svg_unsafe'));
              return;
            }
            profile.bgType = 'image';
            profile.bgValue = cleaned;
            saveProfile();
            applyBackground();
            showToast(i18n.t('toast_bg_image_applied'));
          };
          reader.onerror = function () {
            showToast(i18n.t('toast_file_read_error'));
          };
          reader.readAsDataURL(file);
          this.value = '';
          return;
        }

        // 安全：限制上传文件大小（防 DoS）
        if (file.size > 10 * 1024 * 1024) {
          showToast(i18n.t('toast_file_10mb'));
          this.value = '';
          return;
        }

        if (file.size > 500 * 1024) {
          showToast(i18n.t('toast_compressing'));
        }

        compressImage(file, 1920, false).then(function (base64) {
          profile.bgType = 'image';
          profile.bgValue = base64;
          saveProfile();
          applyBackground();
          showToast(i18n.t('toast_bg_image_applied'));
        }).catch(function (err) {
          showToast(err.message || i18n.t('toast_image_process_error', { msg: '' }));
        });
        this.value = '';
      });
    }

    // 背景颜色应用
    const applyBgColorBtn = document.getElementById('btn-apply-bg-color');
    const bgColorInput = document.getElementById('settings-bg-color');
    if (applyBgColorBtn && bgColorInput) {
      applyBgColorBtn.addEventListener('click', function () {
        const color = bgColorInput.value;
        profile.bgType = 'color';
        profile.bgValue = color;
        saveProfile();
        applyBackground();
        showToast(i18n.t('toast_bg_color_applied', { color: color }));
      });
    }

    // 恢复默认背景
    const resetBgBtn = document.getElementById('btn-reset-bg');
    if (resetBgBtn) {
      resetBgBtn.addEventListener('click', function () {
        profile.bgType = '';
        profile.bgValue = '';
        saveProfile();
        applyBackground();
        showToast(i18n.t('toast_bg_reset'));
      });
    }

    // 语言切换
    const langSelect = document.getElementById('settings-language');
    if (langSelect) {
      langSelect.value = i18n.getCurrentMode ? i18n.getCurrentMode() : 'auto';
      langSelect.addEventListener('change', function () {
        const mode = this.value;
        i18n.setLanguage(mode);
      });
    }

    // 语言切换刷新按钮（切换失败时点击刷新页面）
    const reloadLangBtn = document.getElementById('btn-reload-lang');
    if (reloadLangBtn) {
      reloadLangBtn.addEventListener('click', function () {
        window.location.reload();
      });
    }

    // Wasm 加速开关
    if (window.PixelArt && window.PixelArt.initWasmToggle) {
      window.PixelArt.initWasmToggle();
    }

    // 退出登录（从设置页退出，清除临时账号）/ logout from settings
    const logoutBtn = document.getElementById('btn-settings-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        clearProfile();
        applyBackground();
        updateFloatingAvatar();
        showAppLanding();
        showRegisterModal();
        showToast(i18n.t('toast_logged_out'));
      });
    }
  }

  function applyBackground() {
    if (profile.bgType === 'image' && profile.bgValue) {
      document.body.style.background = 'url(' + profile.bgValue + ') center center / cover no-repeat #1a1a2e fixed';
    } else if (profile.bgType === 'color' && profile.bgValue) {
      document.body.style.background = profile.bgValue;
    } else {
      document.body.style.background = '';
    }
  }

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
      showToast(i18n.t('toast_min_numbers'));
      return false;
    }
    return true;
  }

  // ============================================================
  // Part 1.5: 长期训练模式 / Long-term Training Mode
  // ============================================================

  /**
   * loadLongtermState()
   * 页面加载时从 localStorage 恢复长期训练模式状态与累积序列。
   */
  function loadLongtermState() {
    try {
      longtermMode = localStorage.getItem(LONGTERM_MODE_KEY) === '1';
      const saved = localStorage.getItem(LONGTERM_SERIES_KEY);
      longtermSeries = saved ? JSON.parse(saved) : [];
    } catch (e) {
      longtermMode = false;
      longtermSeries = [];
    }
    const toggle = document.getElementById('longterm-toggle');
    if (toggle) toggle.checked = longtermMode;
    updatePredictButtonText();
  }

  /**
   * saveLongtermState()
   * 把长期训练模式状态与累积序列持久化到 localStorage。
   */
  function saveLongtermState() {
    try {
      localStorage.setItem(LONGTERM_MODE_KEY, longtermMode ? '1' : '0');
      localStorage.setItem(LONGTERM_SERIES_KEY, JSON.stringify(longtermSeries));
    } catch (e) { /* ignore */ }
  }

  /**
   * updatePredictButtonText()
   * 根据长期模式切换预测按钮文案。
   */
  function updatePredictButtonText() {
    const btn = document.getElementById('btn-predict');
    if (!btn) return;
    btn.textContent = longtermMode ? i18n.t('btn_predict_train') : i18n.t('btn_predict');
  }

  /**
   * initLongtermToggle()
   * 绑定长期训练模式开关事件。
   */
  function initLongtermToggle() {
    const toggle = document.getElementById('longterm-toggle');
    if (!toggle) return;
    toggle.addEventListener('change', function () {
      longtermMode = toggle.checked;
      saveLongtermState();
      updatePredictButtonText();
      if (longtermMode) {
        showToast(i18n.t('toast_longterm_on'));
      } else {
        showToast(i18n.t('toast_longterm_off'));
      }
    });
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
      btn.textContent = enabled ? (longtermMode ? i18n.t('btn_predict_train') : i18n.t('btn_predict')) : i18n.t('training_label');
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
      showToast(i18n.t('toast_ignored', { n: parsed.ignored }));
    }
    if (!validateInput(parsed.values)) {
      // 长期模式下，如果当前输入不足但累积序列足够，仍可继续
      if (longtermMode && longtermSeries.length >= 2) {
        runTrainingAnimation(longtermSeries.slice());
      }
      return;
    }
    if (longtermMode) {
      // 累积模式：追加到 longtermSeries，清空输入框
      for (let i = 0; i < parsed.values.length; i++) {
        longtermSeries.push(parsed.values[i]);
      }
      textarea.value = '';
      saveLongtermState();
      showToast(i18n.t('toast_series_length', { n: longtermSeries.length }));
      runTrainingAnimation(longtermSeries.slice());
    } else {
      runTrainingAnimation(parsed.values);
    }
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
          i18n.t('training_step', { current: i + 1, total: totalSteps })
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
    setTrainingProgress(totalSteps, totalSteps, i18n.t('training_complete'));
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
    // 长期模式下优先使用 incrementalTrain（保留权重），否则降级 progressiveTrain
    const nnCanvas = document.getElementById('nn-canvas');
    let nnPreds = [];
    const trainFn = (longtermMode && typeof neuralNet !== 'undefined' && typeof neuralNet.incrementalTrain === 'function')
      ? neuralNet.incrementalTrain
      : (typeof neuralNet !== 'undefined' ? neuralNet.progressiveTrain : null);
    if (nnCanvas && trainFn) {
      setTrainingProgress(1, 2, i18n.t('nn_training'));
      try {
        nnPreds = await trainFn(nnCanvas, series, predSteps, function (cur, total, stage) {
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
    showToast(i18n.t('toast_prediction_done'));
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
      el.textContent = i18n.t('waiting_input');
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
      el.textContent = i18n.t('waiting_input');
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
    if (domainEl) domainEl.textContent = i18n.t('fit_domain') + (fc.domain || '—');
    if (rangeEl) rangeEl.textContent = i18n.t('fit_range') + (fc.range || '—');
    if (r2El) r2El.textContent = i18n.t('fit_r2') + (fc.rSquared !== undefined ? fc.rSquared.toFixed(4) : '—');
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
    if (typeEl) typeEl.textContent = i18n.t('offset_type') + (best.functionName || '—');
    if (r2El) {
      const r2 = best.rSquared;
      r2El.textContent = i18n.t('fit_r2') + (typeof r2 === 'number' && isFinite(r2) ? r2.toFixed(4) : '—');
    }
    if (exactEl) {
      if (os.isExactMatch) {
        exactEl.textContent = i18n.t('offset_exact_match');
        exactEl.className = 'exact-match';
      } else {
        exactEl.textContent = i18n.t('offset_closest');
        exactEl.className = 'closest-match';
      }
    }
    if (resultEl) {
      resultEl.textContent = i18n.t('offset_prediction') + formatNumber(best.prediction);
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
      empty.textContent = i18n.t('waiting_predict');
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
          val.textContent = i18n.t('method_need_more', { n: minLen - state.series.length });
        } else {
          val.textContent = i18n.t('method_failed');
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
    if (ensembleEl) ensembleEl.textContent = i18n.t('waiting_input');

    const nnResultEl = document.getElementById('nn-result');
    if (nnResultEl) nnResultEl.textContent = i18n.t('waiting_input');

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
      empty.textContent = i18n.t('waiting_predict');
      listEl.appendChild(empty);
    }

    clearCanvas(document.getElementById('line-chart'));
    clearCanvas(document.getElementById('weight-chart'));
    clearCanvas(document.getElementById('nn-canvas'));

    // 长期模式关闭时清空累积序列 / clear accumulated series when longterm mode is off
    if (!longtermMode) {
      longtermSeries = [];
      saveLongtermState();
    }

    showToast(i18n.t('toast_reset'));
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
      showToast(i18n.t('toast_export_first'));
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
    showToast(i18n.t('toast_export_json'));
  }

  /**
   * exportCSV()
   * 导出预测结果为 CSV 文件。
   * 表头：id,name,category,prediction,weight,mape
   * 末行追加 ENSEMBLE 汇总（weight=1）。
   */
  function exportCSV() {
    if (state.series.length === 0) {
      showToast(i18n.t('toast_export_first'));
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
    showToast(i18n.t('toast_export_csv'));
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
  // Part 7.5: 计算器逻辑 / Calculator Logic
  // ============================================================

  /**
   * getExactTrig(func, angle, mode) → number | null
   * 特殊角度精确值查表：
   *   - DEG 模式特殊角度（度数）：0/30/45/60/90/120/135/150/180/270/360
   *   - RAD 模式特殊角度（弧度）：0/π/6/π/4/π/3/π/2/π/3π/2/2π
   *   - 命中返回精确值（如 sin(30°)=0.5），未命中返回 null
   */
  function getExactTrig(func, angle, mode) {
    if (typeof angle !== 'number' || !Number.isFinite(angle) && !Number.isNaN(angle)) {
      return null;
    }
    if (Number.isNaN(angle)) return null;
    const SQRT2 = Math.SQRT2;       // √2
    const SQRT3 = Math.sqrt(3);    // √3
    const PI = Math.PI;

    // DEG 角度表（键为度数整数）
    const degTable = {
      0:   { sin: 0,         cos: 1,          tan: 0 },
      30:  { sin: 0.5,       cos: SQRT3 / 2,  tan: SQRT3 / 3 },
      45:  { sin: SQRT2 / 2, cos: SQRT2 / 2,  tan: 1 },
      60:  { sin: SQRT3 / 2, cos: 0.5,        tan: SQRT3 },
      90:  { sin: 1,        cos: 0,          tan: Infinity },
      120: { sin: SQRT3 / 2, cos: -0.5,       tan: -SQRT3 },
      135: { sin: SQRT2 / 2, cos: -SQRT2 / 2, tan: -1 },
      150: { sin: 0.5,      cos: -SQRT3 / 2, tan: -SQRT3 / 3 },
      180: { sin: 0,        cos: -1,         tan: 0 },
      270: { sin: -1,       cos: 0,          tan: Infinity },
      360: { sin: 0,        cos: 1,          tan: 0 }
    };

    if (mode === 'DEG') {
      // DEG 模式：angle 是度数
      const deg = Math.round(angle);
      if (Math.abs(angle - deg) > 1e-9) return null;  // 非整数度数不查表
      if (!Object.prototype.hasOwnProperty.call(degTable, deg)) return null;
      return degTable[deg][func];
    } else {
      // RAD 模式：angle 是弧度，匹配特殊弧度
      const rads = [
        { rad: 0,          deg: 0 },
        { rad: PI / 6,     deg: 30 },
        { rad: PI / 4,     deg: 45 },
        { rad: PI / 3,     deg: 60 },
        { rad: PI / 2,     deg: 90 },
        { rad: PI,         deg: 180 },
        { rad: 3 * PI / 2, deg: 270 },
        { rad: 2 * PI,     deg: 360 }
      ];
      for (let i = 0; i < rads.length; i++) {
        if (Math.abs(angle - rads[i].rad) < 1e-9) {
          return degTable[rads[i].deg][func];
        }
      }
      return null;
    }
  }

  /**
   * trigEval(func, x, mode) → number
   * 三角函数求值：
   *   1. 先查表（getExactTrig），命中返回精确值
   *   2. 未命中：DEG 模式转弧度后调 Math.sin/cos/tan
   *   3. 浮点吸附：|result - round(result)| < 1e-10 → round；|result| < 1e-15 → 0
   */
  function trigEval(func, x, mode) {
    const exact = getExactTrig(func, x, mode);
    if (exact !== null && exact !== undefined) return exact;
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      return NaN;
    }
    const rad = (mode === 'DEG') ? x * Math.PI / 180 : x;
    let result;
    if (func === 'sin') result = Math.sin(rad);
    else if (func === 'cos') result = Math.cos(rad);
    else if (func === 'tan') result = Math.tan(rad);
    else return NaN;
    // 浮点吸附 / floating point snap
    if (Math.abs(result) < 1e-15) result = 0;
    if (Math.abs(result - Math.round(result)) < 1e-10) result = Math.round(result);
    return result;
  }

  /**
   * evalAstWithTrig(node, angleMode) → number
   * 基于 ExpressionParser.evalAst 的自定义求值器：
   *   - 包装 sin/cos/tan 以支持角度模式和特殊角度精确值
   *   - 不使用 eval 或 new Function
   */
  function evalAstWithTrig(node, angleMode) {
    const EP = window.ExpressionParser;
    if (node === null || node === undefined) {
      throw new Error(i18n.t('calc_syntax_error'));
    }

    switch (node.type) {
      case 'Number':
        return node.value;

      case 'Variable':
        throw new Error(i18n.t('calc_no_variable'));

      case 'Constant':
        if (EP.CONSTANTS.hasOwnProperty(node.name)) {
          return EP.CONSTANTS[node.name];
        }
        throw new Error(i18n.t('calc_unknown_const', { name: node.name }));

      case 'UnaryOp': {
        const val = evalAstWithTrig(node.operand, angleMode);
        if (node.op === '-') return -val;
        if (node.op === '+') return val;
        throw new Error(i18n.t('calc_unknown_op', { op: node.op }));
      }

      case 'BinaryOp': {
        const left = evalAstWithTrig(node.left, angleMode);
        const right = evalAstWithTrig(node.right, angleMode);
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/':
            if (right === 0) throw new Error(i18n.t('calc_div_zero'));
            return left / right;
          case '^':
            return Math.pow(left, right);
          default:
            throw new Error(i18n.t('calc_unknown_op', { op: node.op }));
        }
      }

      case 'FunctionCall': {
        const arg = evalAstWithTrig(node.argument, angleMode);
        const funcName = node.name;
        // 三角函数使用自定义包装（支持角度模式和精确值）
        if (funcName === 'sin' || funcName === 'cos' || funcName === 'tan') {
          return trigEval(funcName, arg, angleMode);
        }
        // 其他函数使用标准实现
        const fn = EP.FUNCTIONS[funcName];
        if (!fn) {
          throw new Error(i18n.t('calc_unknown_func', { name: funcName }));
        }
        return fn(arg);
      }

      default:
        throw new Error(i18n.t('calc_unknown_node', { type: node.type }));
    }
  }

  /**
   * calculateExpr(expr) → { ok: boolean, value?: number, error?: string }
   * 安全表达式求值（Token 解析 + AST 评估，不使用 eval/new Function）：
   *   1. 替换 × ÷ − 为 * / -
   *   2. 使用 ExpressionParser 进行 token 解析和 AST 构建
   *   3. 用 evalAstWithTrig 求值（三角函数支持角度模式 + 特殊角度精确值）
   *   4. 结果校验必须是数字（允许 Infinity / -Infinity，如 tan(90°)）
   */
  function calculateExpr(expr) {
    if (typeof expr !== 'string' || expr.trim() === '') {
      return { ok: false, error: i18n.t('calc_empty_expr') };
    }
    // 替换显示符号为标准符号
    let cleaned = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .trim();

    if (cleaned === '') {
      return { ok: false, error: i18n.t('calc_empty_expr') };
    }

    // 不允许以运算符结尾（除了单个负号）
    if (/[+\-*/^]$/.test(cleaned) && cleaned.length > 1) {
      return { ok: false, error: i18n.t('calc_incomplete') };
    }

    try {
      const parseResult = window.ExpressionParser.parse(cleaned);
      if (!parseResult.ok) {
        return { ok: false, error: i18n.t('calc_syntax_error') };
      }
      const result = evalAstWithTrig(parseResult.ast, calcAngleMode);
      if (typeof result !== 'number' || Number.isNaN(result)) {
        return { ok: false, error: i18n.t('calc_invalid_result') };
      }
      return { ok: true, value: result };
    } catch (e) {
      return { ok: false, error: e.message || i18n.t('calc_syntax_error') };
    }
  }

  /**
   * expandScientific(str) → string
   * 把科学计数法字符串（如 1.23e+21）展开为完整数字字符串（如 1230000000000000000000）。
   * 用字符串处理避免 BigInt 精度限制。
   */
  function expandScientific(str) {
    const m = str.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
    if (!m) return str;
    let mantissa = m[1];
    let exp = parseInt(m[2], 10);
    const dotIdx = mantissa.indexOf('.');
    const isNeg = mantissa.charAt(0) === '-';
    if (isNeg) mantissa = mantissa.slice(1);
    if (dotIdx < 0) {
      // 整数尾数
      if (exp >= 0) {
        const out = mantissa + '0'.repeat(exp);
        return isNeg ? '-' + out : out;
      } else {
        const absExp = -exp;
        let out;
        if (absExp >= mantissa.length) {
          out = '0.' + '0'.repeat(absExp - mantissa.length) + mantissa;
        } else {
          out = mantissa.slice(0, mantissa.length - absExp) + '.' + mantissa.slice(mantissa.length - absExp);
        }
        return isNeg ? '-' + out : out;
      }
    } else {
      // 小数尾数
      const intPart = mantissa.slice(0, dotIdx);
      const fracPart = mantissa.slice(dotIdx + 1);
      const allDigits = intPart + fracPart;
      const newDotPos = intPart.length + exp;
      let out;
      if (newDotPos <= 0) {
        out = '0.' + '0'.repeat(-newDotPos) + allDigits;
      } else if (newDotPos >= allDigits.length) {
        out = allDigits + '0'.repeat(newDotPos - allDigits.length);
      } else {
        out = allDigits.slice(0, newDotPos) + '.' + allDigits.slice(newDotPos);
      }
      return isNeg ? '-' + out : out;
    }
  }

  /**
   * formatCalcResult(value) → string
   * 格式化计算结果：
   *   - NaN → '错误'
   *   - Infinity / -Infinity → 'Infinity' / '-Infinity'
   *   - 整数 → 直接字符串
   *   - 科学计数法 → 展开为完整字符串
   *   - 浮点数 → 保留最多 20 位小数（去尾零）
   */
  function formatCalcResult(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value !== 'number' || !isFinite(value)) {
      if (Number.isNaN(value)) return '错误';
      return String(value);  // Infinity 或 -Infinity
    }
    let str = String(value);
    // 检测科学计数法并展开
    if (str.indexOf('e') >= 0 || str.indexOf('E') >= 0) {
      str = expandScientific(str);
    }
    // 浮点数保留最多 20 位小数 / keep at most 20 decimal places
    if (str.indexOf('.') >= 0) {
      const num = parseFloat(str);
      if (isFinite(num)) {
        str = num.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
      }
    }
    return str;
  }

  /**
   * calcUpdateCurrent()
   * 同步 calc-input 到 calc-current 显示。
   */
  function calcUpdateCurrent() {
    const input = document.getElementById('calc-input');
    const current = document.getElementById('calc-current');
    if (!input || !current) return;
    current.textContent = input.value === '' ? '0' : input.value;
  }

  /**
   * calcAppendKey(key)
   * 把按键字符追加到 calc-input 末尾。
   * 特殊键：sqrt/sin/cos/tan 追加函数名 + (；angle-mode 切换 RAD/DEG；C 清空；back 回退；= 求值。
   */
  function calcAppendKey(key) {
    const input = document.getElementById('calc-input');
    if (!input) return;
    if (key === 'sqrt' || key === 'sin' || key === 'cos' || key === 'tan') {
      input.value += key + '(';
      calcUpdateCurrent();
      return;
    }
    if (key === 'angle-mode') {
      // 切换 RAD ↔ DEG，不修改输入框
      calcAngleMode = (calcAngleMode === 'RAD') ? 'DEG' : 'RAD';
      const btn = document.getElementById('calc-angle-mode');
      if (btn) btn.textContent = calcAngleMode;
      showToast(i18n.t('calc_angle_mode', { mode: calcAngleMode }));
      return;
    }
    if (key === 'C') {
      input.value = '';
    } else if (key === 'back') {
      input.value = input.value.slice(0, -1);
    } else if (key === '=') {
      calcEvaluate();
      return;
    } else {
      // 运算符显示用 × ÷ −，存储也用这些（calculateExpr 会转换）
      let displayKey = key;
      if (key === '*') displayKey = '×';
      else if (key === '/') displayKey = '÷';
      else if (key === '-') displayKey = '−';
      input.value += displayKey;
    }
    calcUpdateCurrent();
  }

  /**
   * computeStepsWithTrace(expr) → { steps: string[], finalValue: number, error: string|null }
   * 生成分步化简过程：
   *   1. 先处理 sqrt(...)：递归求值 sqrt 内的表达式，替换为结果
   *   2. 找最内层括号 (...)，求值替换
   *   3. 无括号时按优先级：先乘除后加减，求值最左边的最高级运算替换
   *   4. 重复直到只剩一个数字
   */
  function computeStepsWithTrace(expr) {
    const steps = [expr];
    let current = expr;
    const maxIter = 50;  // 防死循环

    for (let iter = 0; iter < maxIter; iter++) {
      // 检查是否只剩一个数字
      if (/^-?\d+(\.\d+)?$/.test(current.trim())) break;

      // 1. 处理 sqrt(...)
      const sqrtMatch = current.match(/sqrt\(([^()]+)\)/);
      if (sqrtMatch) {
        const inner = sqrtMatch[1];
        const evalRes = calculateExpr(inner);
        if (!evalRes.ok) return { steps: steps, finalValue: null, error: i18n.t('calc_sqrt_error') };
        // 注意：要对 inner 求值结果应用 sqrt，不能用 inner 直接结果
        const sqrtVal = Math.sqrt(evalRes.value);
        const replacement = String(sqrtVal);
        current = current.replace(sqrtMatch[0], replacement);
        steps.push(current);
        continue;
      }

      // 1b. 处理 sin(...)/cos(...)/tan(...)
      const trigMatch = current.match(/(sin|cos|tan)\(([^()]+)\)/);
      if (trigMatch) {
        const func = trigMatch[1];
        const inner = trigMatch[2];
        const evalRes = calculateExpr(inner);
        if (!evalRes.ok) return { steps: steps, finalValue: null, error: i18n.t('calc_trig_error', { func: func }) };
        const trigVal = trigEval(func, evalRes.value, calcAngleMode);
        const replacement = String(trigVal);
        current = current.replace(trigMatch[0], replacement);
        steps.push(current);
        continue;
      }

      // 2. 处理最内层括号 (...)
      const parenMatch = current.match(/\(([^()]+)\)/);
      if (parenMatch) {
        const inner = parenMatch[1];
        const evalRes = calculateExpr(inner);
        if (!evalRes.ok) return { steps: steps, finalValue: null, error: i18n.t('calc_paren_error') };
        const replacement = String(evalRes.value);
        // 处理负数替换：如 (-3) 替换为 -3，但 (3)*(-3) 需保留括号
        // 简化：若结果是负数，在外面包括号
        if (evalRes.value < 0 && parenMatch.index > 0) {
          const prevChar = current.charAt(parenMatch.index - 1);
          if (prevChar !== '(' && prevChar !== '+' && prevChar !== '-' && prevChar !== '*' && prevChar !== '/') {
            current = current.slice(0, parenMatch.index) + '(' + replacement + ')' + current.slice(parenMatch.index + parenMatch[0].length);
          } else {
            current = current.slice(0, parenMatch.index) + replacement + current.slice(parenMatch.index + parenMatch[0].length);
          }
        } else {
          current = current.slice(0, parenMatch.index) + replacement + current.slice(parenMatch.index + parenMatch[0].length);
        }
        steps.push(current);
        continue;
      }

      // 3. 无括号，按优先级求值
      // 3a. 先求 * 和 /
      const mulDivMatch = current.match(/(-?\d+(?:\.\d+)?)\s*([*/])\s*(-?\d+(?:\.\d+)?)/);
      if (mulDivMatch) {
        const left = parseFloat(mulDivMatch[1]);
        const op = mulDivMatch[2];
        const right = parseFloat(mulDivMatch[3]);
        let result;
        if (op === '*') result = left * right;
        else result = left / right;
        // 防止浮点误差：若结果接近整数则吸附
        if (Math.abs(result - Math.round(result)) < 1e-9) result = Math.round(result);
        current = current.replace(mulDivMatch[0], String(result));
        steps.push(current);
        continue;
      }

      // 3b. 再求 + 和 -（注意要避免把负号当作减号）
      // 匹配 A+B 或 A-B，但不能匹配开头负号
      const addSubMatch = current.match(/(-?\d+(?:\.\d+)?)\s*([+-])\s*(-?\d+(?:\.\d+)?)/);
      if (addSubMatch) {
        // 确保不是把 "5-3" 中的 - 误判，且不匹配开头
        const matchStr = addSubMatch[0];
        const matchIdx = current.indexOf(matchStr);
        // 如果匹配的是整个开头且首字符是 -，跳过避免死循环
        if (matchIdx === 0 && matchStr.charAt(0) === '-') {
          // 这种情况说明整个表达式就是 -N，应结束
          break;
        }
        const left = parseFloat(addSubMatch[1]);
        const op = addSubMatch[2];
        const right = parseFloat(addSubMatch[3]);
        let result;
        if (op === '+') result = left + right;
        else result = left - right;
        if (Math.abs(result - Math.round(result)) < 1e-9) result = Math.round(result);
        current = current.replace(matchStr, String(result));
        steps.push(current);
        continue;
      }

      // 无法继续化简，退出
      break;
    }

    // 最终求值
    const finalRes = calculateExpr(current);
    if (!finalRes.ok) return { steps: steps, finalValue: null, error: i18n.t('calc_syntax_error') };

    return { steps: steps, finalValue: finalRes.value, error: null };
  }

  /**
   * showCalcSteps(steps, finalValue, error)
   * 一次性显示全部步骤（保留供调用）。
   */
  function showCalcSteps(steps, finalValue, error) {
    const container = document.getElementById('calc-steps');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (error) {
      const errDiv = document.createElement('div');
      errDiv.className = 'calc-step-error calc-step-line';
      errDiv.textContent = i18n.t('calc_error') + '：' + error;
      container.appendChild(errDiv);
      return;
    }

    if (!steps || steps.length === 0) return;

    for (let i = 0; i < steps.length; i++) {
      const line = document.createElement('div');
      line.className = 'calc-step-line';
      line.textContent = steps[i];
      container.appendChild(line);
    }

    // 最终结果行
    if (finalValue !== null && finalValue !== undefined) {
      const finalLine = document.createElement('div');
      finalLine.className = 'calc-step-line calc-step-final';
      finalLine.textContent = '= ' + formatCalcResult(finalValue);
      container.appendChild(finalLine);
    }

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
  }

  /**
   * clearCalcStepsAnimTimers()
   * 清除所有正在等待的运算过程动画计时器。
   */
  function clearCalcStepsAnimTimers() {
    for (let i = 0; i < calcStepsAnimTimers.length; i++) {
      clearTimeout(calcStepsAnimTimers[i]);
    }
    calcStepsAnimTimers = [];
  }

  /**
   * showCalcStepsAnimated(steps, finalValue, error)
   * 动态化显示运算过程（合并动画版）：
   *   - 错误时立即显示，不延迟
   *   - 每步先以 .calc-step-highlight（高亮 + 上方位移 + 半透明）出现
   *   - 200ms 后移除高亮类（变为正常样式，模拟下移合并动画）
   *   - 每步总间隔 400ms（200ms 高亮 + 200ms 合并）
   *   - 最后添加 = 结果行
   */
  function showCalcStepsAnimated(steps, finalValue, error) {
    const container = document.getElementById('calc-steps');
    if (!container) return;
    clearCalcStepsAnimTimers();
    // 清空 / clear
    while (container.firstChild) container.removeChild(container.firstChild);

    if (error) {
      // 错误时立即显示，不延迟
      const errDiv = document.createElement('div');
      errDiv.className = 'calc-step-error calc-step-line';
      errDiv.textContent = i18n.t('calc_error') + '：' + error;
      container.appendChild(errDiv);
      return;
    }

    if (!steps || steps.length === 0) return;

    // 每步间隔 400ms：先高亮 200ms（上方位移 + 半透明），再正常 200ms（合并到位置）
    const STEP_INTERVAL = 400;
    const HIGHLIGHT_DURATION = 200;

    for (let i = 0; i < steps.length; i++) {
      (function (idx) {
        // 步骤出现：先以高亮样式添加
        const tAppear = setTimeout(function () {
          const line = document.createElement('div');
          line.className = 'calc-step-line calc-step-highlight';
          line.textContent = steps[idx];
          container.appendChild(line);
          container.scrollTop = container.scrollHeight;
          // 200ms 后移除高亮类，触发 transition 过渡为正常样式（下移合并）
          const tMerge = setTimeout(function () {
            line.classList.remove('calc-step-highlight');
          }, HIGHLIGHT_DURATION);
          calcStepsAnimTimers.push(tMerge);
        }, idx * STEP_INTERVAL);
        calcStepsAnimTimers.push(tAppear);
      })(i);
    }

    // 最后添加 = 结果行 / final = result line
    if (finalValue !== null && finalValue !== undefined) {
      const finalDelay = steps.length * STEP_INTERVAL;
      const t = setTimeout(function () {
        const finalLine = document.createElement('div');
        finalLine.className = 'calc-step-line calc-step-final calc-step-highlight';
        finalLine.textContent = '= ' + formatCalcResult(finalValue);
        container.appendChild(finalLine);
        container.scrollTop = container.scrollHeight;
        const tMerge = setTimeout(function () {
          finalLine.classList.remove('calc-step-highlight');
        }, HIGHLIGHT_DURATION);
        calcStepsAnimTimers.push(tMerge);
      }, finalDelay);
      calcStepsAnimTimers.push(t);
    }
  }

  /**
   * calcEvaluate()
   * 求值并把结果加入历史。求值成功后立即显示 finalValue 到 calc-current，
   * 运算过程在 calc-steps 中逐步动画显示（每步 200ms）。
   */
  function calcEvaluate() {
    const input = document.getElementById('calc-input');
    const history = document.getElementById('calc-history');
    const current = document.getElementById('calc-current');
    if (!input || !current) return;
    const expr = input.value;
    if (expr.trim() === '') return;
    const result = calculateExpr(expr);
    if (result.ok) {
      const formatted = formatCalcResult(result.value);
      // 立即显示最终结果 / show final result immediately
      if (history) history.textContent = expr + ' =';
      current.textContent = formatted;
      input.value = formatted;
      // 生成并逐步动画显示运算过程 / generate steps and animate
      const trace = computeStepsWithTrace(expr);
      showCalcStepsAnimated(trace.steps, trace.finalValue, trace.error);
    } else {
      if (history) history.textContent = expr;
      current.textContent = i18n.t('calc_error') + '：' + (result.error || i18n.t('calc_invalid_result'));
      showCalcStepsAnimated([], null, result.error || i18n.t('calc_invalid_result'));
    }
  }

  /**
   * initCalculator()
   * 绑定计算器按键和输入框事件。
   */
  function initCalculator() {
    const keys = document.querySelectorAll('.calc-key');
    for (let i = 0; i < keys.length; i++) {
      keys[i].addEventListener('click', function () {
        const k = this.getAttribute('data-key');
        if (k) calcAppendKey(k);
      });
    }
    const input = document.getElementById('calc-input');
    if (input) {
      input.addEventListener('input', calcUpdateCurrent);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          calcEvaluate();
        }
      });
    }
  }

  // ============================================================
  // Part 7.6: 页面切换 / Page Switching
  // ============================================================

  // 所有页面 ID 清单（统一管理，避免遗漏）
  var PAGE_IDS = [
    'app-landing-page',     // 工具首页
    'landing-page',         // 像素数学首页
    'learning-landing-page',// 学习系统首页
    'predictor-page',       // 预测系统
    'calculator-page',      // 计算机系统
    'function-page',        // 函数系统
    'pixel-art-page',       // 像素艺术生成器
    'pixel-drawing-page',   // 像素绘图编辑器
    'pixel-music-page',     // 像素音乐合成器
    'arithmetic-page',      // 四则运算学习卡片
    'mixed-arithmetic-page',// 混合运算学习卡片
    'maze-page',            // 像素迷宫
    'function-3d-page',     // 函数3D
    'nn-visualizer-page',   // 神经网络可视化
    'math-ext-page',        // 数学卡片扩展
    'physics-page',         // 物理模拟器
    'pixelizer-page',       // AI图像像素化
    'clock-page',           // 像素时钟
    'rpg-page',             // 像素RPG
    'settings-page'         // 设置页
  ];

  // 用 active 类显示的页面
  var ACTIVE_PAGES = {
    'app-landing-page': true,
    'predictor-page': true,
    'calculator-page': true,
    'function-page': true,
    'pixel-art-page': true,
    'pixel-drawing-page': true,
    'pixel-music-page': true,
    'maze-page': true,
    'function-3d-page': true,
    'nn-visualizer-page': true,
    'math-ext-page': true,
    'physics-page': true,
    'pixelizer-page': true,
    'clock-page': true,
    'rpg-page': true,
    'settings-page': true
  };

  // 用 hidden 类隐藏的页面（landing-page, learning-landing-page, arithmetic-page, mixed-arithmetic-page）
  var HIDDEN_PAGES = {
    'landing-page': true,
    'learning-landing-page': true,
    'arithmetic-page': true,
    'mixed-arithmetic-page': true
  };

  // 统一隐藏所有页面（清除 active 和 hidden 类的状态）
  function hideAllPages() {
    for (var i = 0; i < PAGE_IDS.length; i++) {
      var id = PAGE_IDS[i];
      var el = document.getElementById(id);
      if (!el) continue;
      if (ACTIVE_PAGES[id]) {
        el.classList.remove('active');
      }
      if (HIDDEN_PAGES[id]) {
        el.classList.add('hidden');
      }
    }
  }

  // 显示指定页面（先隐藏全部，再显示目标）
  function showPage(pageId) {
    hideAllPages();
    var el = document.getElementById(pageId);
    if (!el) return;
    if (ACTIVE_PAGES[pageId]) {
      el.classList.add('active');
    } else if (HIDDEN_PAGES[pageId]) {
      el.classList.remove('hidden');
    }
  }

  function showLanding() {
    showPage('landing-page');
  }

  function showAppLanding() {
    showPage('app-landing-page');
    // 停止后台运行的工具 / stop background tools
    stopBackgroundTools();
  }

  function showPredictor() {
    showPage('predictor-page');
    // 触发画布重绘 / trigger canvas resize
    setTimeout(function () {
      if (typeof resizeCanvases === 'function') resizeCanvases();
      else window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  function showCalculator() {
    showPage('calculator-page');
  }

  function showFunction() {
    showPage('function-page');
    // 进入页面后重绘一次函数坐标系（尺寸就位后）
    setTimeout(function () {
      if (window.functionPlotterInstance) {
        window.functionPlotterInstance.resize();
        window.functionPlotterInstance.redraw();
      }
    }, 50);
  }

  function showPixelArt() {
    showPage('pixel-art-page');
    if (window.PixelMusic && typeof window.PixelMusic.cleanup === 'function') {
      window.PixelMusic.cleanup();
    }
    // 进入页面后重新生成一次，确保画布初始化正确
    setTimeout(function () {
      if (window.PixelArt && typeof window.PixelArt.regenerate === 'function') {
        window.PixelArt.regenerate();
      }
    }, 50);
  }

  function showPixelDrawing() {
    showPage('pixel-drawing-page');
    if (window.PixelMusic && typeof window.PixelMusic.cleanup === 'function') {
      window.PixelMusic.cleanup();
    }
    setTimeout(function () {
      if (window.PixelDrawingEditor && typeof window.PixelDrawingEditor.resize === 'function') {
        window.PixelDrawingEditor.resize();
      }
    }, 50);
  }

  function showPixelMusic() {
    showPage('pixel-music-page');
    setTimeout(function () {
      if (window.PixelMusic && typeof window.PixelMusic.init === 'function') {
        window.PixelMusic.init();
      }
    }, 50);
  }

  function showLearningLanding() {
    showPage('learning-landing-page');
  }

  function showArithmetic() {
    showPage('arithmetic-page');
    if (window.MathCards && typeof window.MathCards.init === 'function') {
      window.MathCards.init();
    }
  }

  function showMixedArithmetic() {
    showPage('mixed-arithmetic-page');
    if (window.MathCards && typeof window.MathCards.initMixed === 'function') {
      window.MathCards.initMixed();
    }
  }

  // ============================================================
  // Part 7.7: 新工具页面切换 / New Tool Page Switching
  // ============================================================

  /**
   * stopBackgroundTools()
   * 离开当前页面时停止在后台运行的工具（物理模拟器、RPG、PixelMusic）。
   */
  function stopBackgroundTools() {
    if (window.PhysicsSandbox && typeof window.PhysicsSandbox.stop === 'function') {
      try { window.PhysicsSandbox.stop(); } catch (e) { /* ignore */ }
    }
    if (window.PixelRPG && typeof window.PixelRPG.stop === 'function') {
      try { window.PixelRPG.stop(); } catch (e) { /* ignore */ }
    }
    if (window.PixelMusic && typeof window.PixelMusic.cleanup === 'function') {
      try { window.PixelMusic.cleanup(); } catch (e) { /* ignore */ }
    }
    if (window.NNVisualizer && typeof window.NNVisualizer.stop === 'function') {
      try { window.NNVisualizer.stop(); } catch (e) { /* ignore */ }
    }
  }

  // ---------- 像素迷宫 / Maze ----------
  function showMaze() {
    stopBackgroundTools();
    showPage('maze-page');
    setTimeout(initMazeTool, 50);
  }

  function initMazeTool() {
    if (initFlags.maze) return;
    initFlags.maze = true;
    const canvas = document.getElementById('maze-canvas');
    if (!canvas || !window.MazeGenerator) return;
    window.MazeGenerator.init(canvas);

    const algoSel = document.getElementById('maze-algorithm');
    const sizeInput = document.getElementById('maze-size');
    const genBtn = document.getElementById('btn-maze-generate');
    const solveBtn = document.getElementById('btn-maze-solve');
    const clearBtn = document.getElementById('btn-maze-clear');
    const exportBtn = document.getElementById('btn-maze-export');

    function doGenerate() {
      const a = algoSel ? algoSel.value : 'recursive';
      const s = sizeInput ? (parseInt(sizeInput.value, 10) || 21) : 21;
      window.MazeGenerator.generate(a, s, s);
    }

    if (genBtn) genBtn.addEventListener('click', doGenerate);
    if (solveBtn) solveBtn.addEventListener('click', function () {
      window.MazeGenerator.solve();
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      window.MazeGenerator.clear();
    });
    if (exportBtn) exportBtn.addEventListener('click', function () {
      window.MazeGenerator.export('maze.png');
    });

    // 自动生成一个初始迷宫
    doGenerate();
  }

  // ---------- 函数3D / Function 3D ----------
  function showFunction3D() {
    stopBackgroundTools();
    showPage('function-3d-page');
    setTimeout(initFunction3DTool, 50);
  }

  function initFunction3DTool() {
    if (initFlags.function3d) return;
    initFlags.function3d = true;
    const canvas = document.getElementById('function-3d-canvas');
    if (!canvas || !window.Function3D) return;
    window.Function3D.init(canvas);

    const input = document.getElementById('function-3d-input');
    const applyBtn = document.getElementById('btn-function-3d-apply');
    const resetBtn = document.getElementById('btn-function-3d-reset');
    const paramsEl = document.getElementById('function-3d-params');

    function renderParams() {
      if (!paramsEl) return;
      while (paramsEl.firstChild) paramsEl.removeChild(paramsEl.firstChild);
      if (typeof window.Function3D.getParams !== 'function') return;
      let info;
      try { info = window.Function3D.getParams(); } catch (e) { return; }
      if (!info || !info.names || info.names.length === 0) return;

      for (let i = 0; i < info.names.length; i++) {
        const name = info.names[i];
        const val = info.values[i];

        const item = document.createElement('div');
        item.className = 'function-3d-param-item';

        const label = document.createElement('label');
        label.className = 'function-3d-param-label';
        label.textContent = name + ' = ' + (Number.isFinite(val) ? val.toFixed(2) : String(val));

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'pixel-input';
        slider.min = '-5';
        slider.max = '5';
        slider.step = '0.1';
        slider.value = String(val);
        slider.addEventListener('input', function () {
          const v = parseFloat(this.value);
          if (!Number.isFinite(v)) return;
          const obj = {};
          obj[name] = v;
          window.Function3D.setParams(obj);
          label.textContent = name + ' = ' + v.toFixed(2);
        });

        item.appendChild(label);
        item.appendChild(slider);
        paramsEl.appendChild(item);
      }
    }

    function applyExpr() {
      if (!input || !input.value || !input.value.trim()) return;
      window.Function3D.setExpression(input.value);
      renderParams();
    }

    if (applyBtn) applyBtn.addEventListener('click', applyExpr);
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyExpr(); }
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      window.Function3D.reset();
    });

    // 应用初始表达式
    applyExpr();
  }

  // ---------- 神经网络可视化 / NN Visualizer ----------
  function showNNVisualizer() {
    stopBackgroundTools();
    showPage('nn-visualizer-page');
    setTimeout(initNNVisualizerTool, 50);
  }

  function initNNVisualizerTool() {
    if (initFlags.nnvis) return;
    initFlags.nnvis = true;
    const netCanvas = document.getElementById('nnvis-network-canvas');
    const lossCanvas = document.getElementById('nnvis-loss-canvas');
    if (!netCanvas || !lossCanvas || !window.NNVisualizer) return;
    window.NNVisualizer.init(netCanvas, lossCanvas);

    const datasetSel = document.getElementById('nnvis-dataset');
    const structInput = document.getElementById('nnvis-structure');
    const lrInput = document.getElementById('nnvis-lr');
    const trainBtn = document.getElementById('btn-nnvis-train');
    const stopBtn = document.getElementById('btn-nnvis-stop');
    const resetBtn = document.getElementById('btn-nnvis-reset');

    function applyStructure() {
      if (!structInput || !structInput.value || !structInput.value.trim()) return;
      const parts = structInput.value.split(',').map(function (s) {
        const n = parseInt(s.trim(), 10);
        return isNaN(n) ? 1 : Math.max(1, n);
      }).filter(function (n) { return n > 0; });
      if (parts.length >= 2) {
        try { window.NNVisualizer.setStructure(parts); } catch (e) { /* ignore */ }
      }
    }

    applyStructure();

    if (structInput) structInput.addEventListener('change', applyStructure);

    if (trainBtn) trainBtn.addEventListener('click', function () {
      const ds = datasetSel ? datasetSel.value : 'xor';
      const lr = lrInput ? (parseFloat(lrInput.value) || 0.3) : 0.3;
      let dataset = null;
      if (window.NNVisualizer.datasets) {
        if (ds === 'sine' && typeof window.NNVisualizer.datasets.sine === 'function') {
          try { dataset = window.NNVisualizer.datasets.sine(); } catch (e) { dataset = null; }
        } else if (window.NNVisualizer.datasets.xor) {
          dataset = window.NNVisualizer.datasets.xor;
        }
      }
      if (dataset) {
        try { window.NNVisualizer.train(dataset, 10000, lr); } catch (e) { /* ignore */ }
      }
    });

    if (stopBtn) stopBtn.addEventListener('click', function () {
      window.NNVisualizer.stop();
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      window.NNVisualizer.reset();
    });
  }

  // ---------- 数学卡片扩展 / Math Cards Ext ----------
  function showMathExt() {
    stopBackgroundTools();
    showPage('math-ext-page');
    setTimeout(initMathExtTool, 50);
  }

  function initMathExtTool() {
    if (initFlags.mathext) return;
    initFlags.mathext = true;
    const canvas = document.getElementById('mathext-canvas');
    if (!canvas || !window.MathCardsExt) return;

    const tabs = document.querySelectorAll('.mathext-tab');

    function switchMode(mode) {
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-mode') === mode);
      }
      try {
        if (mode === 'fraction' && typeof window.MathCardsExt.initFraction === 'function') {
          window.MathCardsExt.initFraction(canvas);
        } else if (mode === 'decimal' && typeof window.MathCardsExt.initDecimal === 'function') {
          window.MathCardsExt.initDecimal(canvas);
        } else if (mode === 'equation' && typeof window.MathCardsExt.initEquation === 'function') {
          window.MathCardsExt.initEquation(canvas);
        } else if (mode === 'geometry' && typeof window.MathCardsExt.initGeometry === 'function') {
          window.MathCardsExt.initGeometry(canvas);
        } else if (mode === 'speed' && typeof window.MathCardsExt.initSpeedChallenge === 'function') {
          window.MathCardsExt.initSpeedChallenge(canvas);
        }
      } catch (e) { /* ignore */ }
    }

    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        switchMode(this.getAttribute('data-mode'));
      });
    }

    // 默认进入分数模式
    switchMode('fraction');
  }

  // ---------- 物理模拟器 / Physics Sandbox ----------
  function showPhysics() {
    stopBackgroundTools();
    showPage('physics-page');
    setTimeout(initPhysicsTool, 50);
  }

  function initPhysicsTool() {
    if (initFlags.physics) return;
    initFlags.physics = true;
    const canvas = document.getElementById('physics-canvas');
    if (!canvas || !window.PhysicsSandbox) return;
    window.PhysicsSandbox.init(canvas);

    // 构建元素按钮 / build element buttons
    const elementsEl = document.getElementById('physics-elements');
    if (elementsEl && window.PhysicsSandbox.ELEMENTS) {
      while (elementsEl.firstChild) elementsEl.removeChild(elementsEl.firstChild);
      const elements = window.PhysicsSandbox.ELEMENTS;
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const btn = document.createElement('button');
        btn.className = 'physics-element-btn' + (i === 0 ? ' active' : '');
        btn.dataset.element = el.id;
        btn.style.backgroundColor = el.color;
        btn.textContent = el.name;
        btn.addEventListener('click', function () {
          const allBtns = elementsEl.querySelectorAll('.physics-element-btn');
          for (let j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
          this.classList.add('active');
          window.PhysicsSandbox.setElement(el.id);
        });
        elementsEl.appendChild(btn);
      }
      // 默认选择第一个元素
      if (elements.length > 0) {
        window.PhysicsSandbox.setElement(elements[0].id);
      }
    }

    const brushInput = document.getElementById('physics-brush');
    const brushValue = document.getElementById('physics-brush-value');
    if (brushInput) {
      brushInput.addEventListener('input', function () {
        const v = parseInt(this.value, 10) || 1;
        window.PhysicsSandbox.setBrushSize(v);
        if (brushValue) brushValue.textContent = v;
      });
    }

    const startBtn = document.getElementById('btn-physics-start');
    const stopBtn = document.getElementById('btn-physics-stop');
    const clearBtn = document.getElementById('btn-physics-clear');

    if (startBtn) startBtn.addEventListener('click', function () {
      window.PhysicsSandbox.start();
    });
    if (stopBtn) stopBtn.addEventListener('click', function () {
      window.PhysicsSandbox.stop();
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      window.PhysicsSandbox.clear();
    });
  }

  // ---------- AI图像像素化 / Image Pixelizer ----------
  function showPixelizer() {
    stopBackgroundTools();
    showPage('pixelizer-page');
    setTimeout(initPixelizerTool, 50);
  }

  function initPixelizerTool() {
    if (initFlags.pixelizer) return;
    initFlags.pixelizer = true;
    const origCanvas = document.getElementById('pixelizer-original-canvas');
    const procCanvas = document.getElementById('pixelizer-processed-canvas');
    if (!origCanvas || !procCanvas || !window.ImagePixelizer) return;
    window.ImagePixelizer.init(origCanvas, procCanvas);

    const fileInput = document.getElementById('pixelizer-file');
    const pixelSizeInput = document.getElementById('pixelizer-pixel-size');
    const pixelValue = document.getElementById('pixelizer-pixel-value');
    const paletteSel = document.getElementById('pixelizer-palette');
    const colorCountInput = document.getElementById('pixelizer-color-count');
    const colorCountValue = document.getElementById('pixelizer-count-value');
    const processBtn = document.getElementById('btn-pixelizer-process');
    const exportBtn = document.getElementById('btn-pixelizer-export');

    if (fileInput) fileInput.addEventListener('change', function () {
      const file = this.files && this.files[0];
      if (!file) return;
      // 安全：限制文件大小 10MB
      if (file.size > 10 * 1024 * 1024) {
        showToast(i18n.t('toast_file_10mb'));
        this.value = '';
        return;
      }
      window.ImagePixelizer.loadImage(file);
      this.value = '';
    });

    if (pixelSizeInput) pixelSizeInput.addEventListener('input', function () {
      const v = parseInt(this.value, 10) || 1;
      window.ImagePixelizer.setPixelSize(v);
      if (pixelValue) pixelValue.textContent = v;
    });

    if (paletteSel) paletteSel.addEventListener('change', function () {
      window.ImagePixelizer.setPalette(this.value);
    });

    if (colorCountInput) colorCountInput.addEventListener('input', function () {
      const v = parseInt(this.value, 10) || 2;
      window.ImagePixelizer.setColorCount(v);
      if (colorCountValue) colorCountValue.textContent = v;
    });

    if (processBtn) processBtn.addEventListener('click', function () {
      window.ImagePixelizer.process();
    });

    if (exportBtn) exportBtn.addEventListener('click', function () {
      window.ImagePixelizer.exportImage();
    });
  }

  // ---------- 像素时钟 / Pixel Clock ----------
  function showClock() {
    stopBackgroundTools();
    showPage('clock-page');
    setTimeout(initClockTool, 50);
  }

  function initClockTool() {
    if (initFlags.clock) return;
    initFlags.clock = true;
    const canvas = document.getElementById('clock-canvas');
    if (!canvas || !window.PixelClock) return;

    const tabs = document.querySelectorAll('.clock-tab');

    function switchMode(mode) {
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-mode') === mode);
      }
      try {
        if (mode === 'clock') {
          window.PixelClock.initClock(canvas);
        } else if (mode === 'calendar') {
          window.PixelClock.initCalendar(canvas);
        } else if (mode === 'pomodoro') {
          window.PixelClock.initPomodoro(canvas);
        }
      } catch (e) { /* ignore */ }
    }

    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        switchMode(this.getAttribute('data-mode'));
      });
    }

    const fontBtns = document.querySelectorAll('.clock-font-btn');
    for (let i = 0; i < fontBtns.length; i++) {
      fontBtns[i].addEventListener('click', function () {
        for (let j = 0; j < fontBtns.length; j++) fontBtns[j].classList.remove('active');
        this.classList.add('active');
        try { window.PixelClock.setFontStyle(this.getAttribute('data-font')); } catch (e) { /* ignore */ }
      });
    }

    // 默认进入时钟模式
    switchMode('clock');
  }

  // ---------- 像素RPG / Pixel RPG ----------
  function showRPG() {
    stopBackgroundTools();
    showPage('rpg-page');
    setTimeout(initRPGTool, 50);
  }

  function initRPGTool() {
    if (initFlags.rpg) return;
    initFlags.rpg = true;
    const canvas = document.getElementById('rpg-canvas');
    if (!canvas || !window.PixelRPG) return;
    window.PixelRPG.init(canvas);

    const startBtn = document.getElementById('btn-rpg-start');
    const stopBtn = document.getElementById('btn-rpg-stop');
    const resetBtn = document.getElementById('btn-rpg-reset');

    if (startBtn) startBtn.addEventListener('click', function () {
      window.PixelRPG.start();
    });
    if (stopBtn) stopBtn.addEventListener('click', function () {
      window.PixelRPG.stop();
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      window.PixelRPG.reset();
    });
  }

  function initPageSwitching() {
    const btnPredictor = document.getElementById('btn-enter-predictor');
    const btnCalc = document.getElementById('btn-enter-calculator');
    const btnFunction = document.getElementById('btn-enter-function');
    const btnBackPredict = document.getElementById('btn-back-home-predict');
    const btnBackCalc = document.getElementById('btn-back-home-calc');
    const btnBackFunction = document.getElementById('btn-back-home-function');
    const btnBackSettings = document.getElementById('btn-back-home-settings');
    const btnFloatingSettings = document.getElementById('btn-floating-settings');
    const btnEnterMath = document.getElementById('btn-enter-math');
    const btnBackToTools = document.getElementById('btn-back-to-tools');
    const btnEnterPixelArt = document.getElementById('btn-enter-pixel-art');
    const btnBackHomeArt = document.getElementById('btn-back-home-art');
    const btnEnterPixelDrawEditor = document.getElementById('btn-enter-pixel-draw-editor');
    const btnEnterPixelMusic = document.getElementById('btn-enter-pixel-music');
    const btnBackHomeMusic = document.getElementById('btn-back-home-music');
    const btnEnterLearning = document.getElementById('btn-enter-learning');
    const btnBackToLanding = document.getElementById('btn-back-to-landing');
    const btnEnterArithmetic = document.getElementById('btn-enter-arithmetic');
    const btnEnterMixed = document.getElementById('btn-enter-mixed');
    if (btnPredictor) btnPredictor.addEventListener('click', showPredictor);
    if (btnCalc) btnCalc.addEventListener('click', showCalculator);
    if (btnFunction) btnFunction.addEventListener('click', showFunction);
    if (btnBackPredict) btnBackPredict.addEventListener('click', showLanding);
    if (btnBackCalc) btnBackCalc.addEventListener('click', showLanding);
    if (btnBackFunction) btnBackFunction.addEventListener('click', showLanding);
    if (btnFloatingSettings) btnFloatingSettings.addEventListener('click', showSettings);
    if (btnBackSettings) btnBackSettings.addEventListener('click', showAppLanding);
    if (btnEnterMath) btnEnterMath.addEventListener('click', showLanding);
    if (btnBackToTools) btnBackToTools.addEventListener('click', showAppLanding);
    if (btnEnterPixelArt) btnEnterPixelArt.addEventListener('click', showPixelArt);
    if (btnBackHomeArt) btnBackHomeArt.addEventListener('click', showAppLanding);
    if (btnEnterPixelDrawEditor) btnEnterPixelDrawEditor.addEventListener('click', showPixelDrawing);
    const btnBackHomeDrawing = document.getElementById('btn-back-home-drawing');
    if (btnBackHomeDrawing) btnBackHomeDrawing.addEventListener('click', showAppLanding);
    if (btnEnterPixelMusic) btnEnterPixelMusic.addEventListener('click', showPixelMusic);
    if (btnBackHomeMusic) btnBackHomeMusic.addEventListener('click', showAppLanding);
    if (btnEnterLearning) btnEnterLearning.addEventListener('click', showLearningLanding);
    if (btnBackToLanding) btnBackToLanding.addEventListener('click', showLanding);
    if (btnEnterArithmetic) btnEnterArithmetic.addEventListener('click', showArithmetic);
    if (btnEnterMixed) btnEnterMixed.addEventListener('click', showMixedArithmetic);

    // 新工具卡片点击事件 / new tool card click events
    const btnEnterMaze = document.getElementById('btn-enter-maze');
    const btnEnterFunction3D = document.getElementById('btn-enter-function-3d');
    const btnEnterNNVis = document.getElementById('btn-enter-nn-visualizer');
    const btnEnterMathExt = document.getElementById('btn-enter-math-ext');
    const btnEnterPhysics = document.getElementById('btn-enter-physics');
    const btnEnterPixelizer = document.getElementById('btn-enter-pixelizer');
    const btnEnterClock = document.getElementById('btn-enter-clock');
    const btnEnterRPG = document.getElementById('btn-enter-rpg');
    if (btnEnterMaze) btnEnterMaze.addEventListener('click', showMaze);
    if (btnEnterFunction3D) btnEnterFunction3D.addEventListener('click', showFunction3D);
    if (btnEnterNNVis) btnEnterNNVis.addEventListener('click', showNNVisualizer);
    if (btnEnterMathExt) btnEnterMathExt.addEventListener('click', showMathExt);
    if (btnEnterPhysics) btnEnterPhysics.addEventListener('click', showPhysics);
    if (btnEnterPixelizer) btnEnterPixelizer.addEventListener('click', showPixelizer);
    if (btnEnterClock) btnEnterClock.addEventListener('click', showClock);
    if (btnEnterRPG) btnEnterRPG.addEventListener('click', showRPG);

    // 新工具返回首页按钮 / new tool back-to-home buttons
    const btnBackHomeMaze = document.getElementById('btn-back-home-maze');
    const btnBackHomeFunction3D = document.getElementById('btn-back-home-function-3d');
    const btnBackHomeNN = document.getElementById('btn-back-home-nn');
    const btnBackHomeMathExt = document.getElementById('btn-back-home-math-ext');
    const btnBackHomePhysics = document.getElementById('btn-back-home-physics');
    const btnBackHomePixelizer = document.getElementById('btn-back-home-pixelizer');
    const btnBackHomeClock = document.getElementById('btn-back-home-clock');
    const btnBackHomeRPG = document.getElementById('btn-back-home-rpg');
    if (btnBackHomeMaze) btnBackHomeMaze.addEventListener('click', showAppLanding);
    if (btnBackHomeFunction3D) btnBackHomeFunction3D.addEventListener('click', showAppLanding);
    if (btnBackHomeNN) btnBackHomeNN.addEventListener('click', showAppLanding);
    if (btnBackHomeMathExt) btnBackHomeMathExt.addEventListener('click', showAppLanding);
    if (btnBackHomePhysics) btnBackHomePhysics.addEventListener('click', showAppLanding);
    if (btnBackHomePixelizer) btnBackHomePixelizer.addEventListener('click', showAppLanding);
    if (btnBackHomeClock) btnBackHomeClock.addEventListener('click', showAppLanding);
    if (btnBackHomeRPG) btnBackHomeRPG.addEventListener('click', showAppLanding);
  }

  /**
   * initFunctionPlotter()
   * 初始化函数系统：创建 FunctionPlotter 实例并绑定按钮事件。
   */
  function initFunctionPlotter() {
    const functionCanvas = document.getElementById('function-canvas');
    if (!functionCanvas || !window.FunctionPlotter) return;
    window.functionPlotterInstance = new window.FunctionPlotter(functionCanvas);

    const addBtn = document.getElementById('btn-function-add');
    const clearBtn = document.getElementById('btn-function-clear');
    const input = document.getElementById('function-input');
    const zoomIn = document.getElementById('btn-function-zoom-in');
    const zoomOut = document.getElementById('btn-function-zoom-out');
    const list = document.getElementById('function-list');
    const paramPanel = document.getElementById('param-panel');
    const paramSliders = document.getElementById('param-sliders');
    const animBar = document.getElementById('param-animation-bar');
    const playBtn = document.getElementById('param-animation-play-btn');
    const speedSelect = document.getElementById('param-speed-select');

    const params = {};
    const paramConfig = {};
    const PARAM_DEFAULT_MIN = -10;
    const PARAM_DEFAULT_MAX = 10;
    const PARAM_DEFAULT_STEP = 0.1;
    const PARAM_DEFAULT_VALUE = 1;
    const ANIM_PERIOD = 4000;

    let animating = false;
    let animSpeed = 1;
    let animStartTime = 0;
    let animPausedTime = 0;
    let animRafId = null;

    function formatParamValue(val) {
      if (Number.isInteger(val)) return String(val);
      return parseFloat(val.toFixed(4)).toString();
    }

    function ensureParamConfig(name) {
      if (!paramConfig[name]) {
        paramConfig[name] = {
          min: PARAM_DEFAULT_MIN,
          max: PARAM_DEFAULT_MAX,
          step: PARAM_DEFAULT_STEP,
          phase: Math.random() * Math.PI * 2
        };
      }
      return paramConfig[name];
    }

    function createGearSvg() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '3');
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('fill', 'none');
      svg.appendChild(circle);

      const teeth = [
        'M12 2 L12 5',
        'M12 19 L12 22',
        'M2 12 L5 12',
        'M19 12 L22 12',
        'M4.93 4.93 L7.05 7.05',
        'M16.95 16.95 L19.07 19.07',
        'M4.93 19.07 L7.05 16.95',
        'M16.95 7.05 L19.07 4.93'
      ];
      for (let i = 0; i < teeth.length; i++) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', teeth[i]);
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'square');
        svg.appendChild(path);
      }

      return svg;
    }

    function updatePlayButtonIcon() {
      if (!playBtn) return;
      while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('fill', 'none');
      if (animating) {
        const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r1.setAttribute('x', '3');
        r1.setAttribute('y', '2');
        r1.setAttribute('width', '4');
        r1.setAttribute('height', '12');
        r1.setAttribute('fill', '#ffd700');
        svg.appendChild(r1);
        const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r2.setAttribute('x', '9');
        r2.setAttribute('y', '2');
        r2.setAttribute('width', '4');
        r2.setAttribute('height', '12');
        r2.setAttribute('fill', '#ffd700');
        svg.appendChild(r2);
      } else {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '4,2 14,8 4,14');
        poly.setAttribute('fill', '#ffd700');
        svg.appendChild(poly);
      }
      playBtn.appendChild(svg);
      playBtn.title = animating ? '暂停动画' : '播放动画';
    }

    function animate(currentTime) {
      if (!animating) return;

      const elapsed = (currentTime - animStartTime) * animSpeed;
      const fps = window.functionPlotterInstance;
      if (!fps) return;

      const allParams = fps.getAllParams();
      let changed = false;

      for (let i = 0; i < allParams.length; i++) {
        const name = allParams[i];
        const cfg = ensureParamConfig(name);
        const t = (elapsed / ANIM_PERIOD) * Math.PI * 2 + cfg.phase;
        const normalized = (Math.sin(t) + 1) / 2;
        const val = cfg.min + (cfg.max - cfg.min) * normalized;
        const stepped = Math.round(val / cfg.step) * cfg.step;
        const clamped = Math.max(cfg.min, Math.min(cfg.max, stepped));

        if (params[name] !== clamped) {
          params[name] = clamped;
          changed = true;
        }
      }

      if (changed) {
        updateSliderDomValues();
        fps.setParams(params);
      }

      animRafId = requestAnimationFrame(animate);
    }

    function updateSliderDomValues() {
      if (!paramSliders) return;
      const sliderInputs = paramSliders.querySelectorAll('input[type="range"]');
      for (let i = 0; i < sliderInputs.length; i++) {
        const slider = sliderInputs[i];
        const name = slider.dataset.param;
        if (name && params.hasOwnProperty(name)) {
          const val = params[name];
          slider.value = String(val);
          const item = slider.closest('.param-slider-item');
          if (item) {
            const valueEl = item.querySelector('.param-slider-value');
            if (valueEl) valueEl.textContent = formatParamValue(val);
          }
        }
      }
    }

    function startAnimation() {
      if (animating) return;
      const fps = window.functionPlotterInstance;
      if (!fps || fps.getAllParams().length === 0) return;

      animating = true;
      animStartTime = performance.now() - animPausedTime;
      updatePlayButtonIcon();
      animRafId = requestAnimationFrame(animate);
    }

    function stopAnimation() {
      if (!animating) return;
      animating = false;
      animPausedTime = performance.now() - animStartTime;
      if (animRafId !== null) {
        cancelAnimationFrame(animRafId);
        animRafId = null;
      }
      updatePlayButtonIcon();
    }

    function toggleAnimation() {
      if (animating) {
        stopAnimation();
      } else {
        startAnimation();
      }
    }

    function renderParamSliders() {
      if (!paramPanel || !paramSliders) return;
      const fps = window.functionPlotterInstance;
      if (!fps) return;

      const allParams = fps.getAllParams();

      if (allParams.length === 0) {
        paramPanel.style.display = 'none';
        if (animBar) animBar.style.display = 'none';
        stopAnimation();
        animPausedTime = 0;
        return;
      }

      paramPanel.style.display = 'block';
      if (animBar) animBar.style.display = 'flex';

      while (paramSliders.firstChild) {
        paramSliders.removeChild(paramSliders.firstChild);
      }

      for (let i = 0; i < allParams.length; i++) {
        const name = allParams[i];
        if (!params.hasOwnProperty(name)) {
          params[name] = PARAM_DEFAULT_VALUE;
        }
        const cfg = ensureParamConfig(name);
        const val = params[name];

        const item = document.createElement('div');
        item.className = 'param-slider-item';

        const header = document.createElement('div');
        header.className = 'param-slider-header';

        const nameEl = document.createElement('span');
        nameEl.className = 'param-slider-name';
        nameEl.textContent = name;

        const rightWrap = document.createElement('div');
        rightWrap.style.display = 'flex';
        rightWrap.style.alignItems = 'center';
        rightWrap.style.gap = '8px';

        const valueEl = document.createElement('span');
        valueEl.className = 'param-slider-value';
        valueEl.textContent = formatParamValue(val);

        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'param-settings-btn';
        settingsBtn.title = '参数设置';
        settingsBtn.appendChild(createGearSvg());

        rightWrap.appendChild(valueEl);
        rightWrap.appendChild(settingsBtn);

        header.appendChild(nameEl);
        header.appendChild(rightWrap);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(cfg.min);
        slider.max = String(cfg.max);
        slider.step = String(cfg.step);
        slider.value = String(val);
        slider.dataset.param = name;

        slider.addEventListener('input', function () {
          const paramName = this.dataset.param;
          const paramVal = parseFloat(this.value);
          params[paramName] = paramVal;
          valueEl.textContent = formatParamValue(paramVal);
          fps.setParams(params);
        });

        const rangeEl = document.createElement('div');
        rangeEl.className = 'param-slider-range';
        rangeEl.textContent = formatParamValue(cfg.min) + ' ~ ' + formatParamValue(cfg.max);

        const settingsPanel = document.createElement('div');
        settingsPanel.className = 'param-settings-panel';

        const errorEl = document.createElement('div');
        errorEl.className = 'param-settings-error';
        settingsPanel.appendChild(errorEl);

        const minRow = document.createElement('div');
        minRow.className = 'param-settings-row';
        const minLabel = document.createElement('span');
        minLabel.className = 'param-settings-label';
        minLabel.textContent = '最小';
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.className = 'param-settings-input';
        minInput.value = String(cfg.min);
        minInput.step = 'any';
        minRow.appendChild(minLabel);
        minRow.appendChild(minInput);
        settingsPanel.appendChild(minRow);

        const maxRow = document.createElement('div');
        maxRow.className = 'param-settings-row';
        const maxLabel = document.createElement('span');
        maxLabel.className = 'param-settings-label';
        maxLabel.textContent = '最大';
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.className = 'param-settings-input';
        maxInput.value = String(cfg.max);
        maxInput.step = 'any';
        maxRow.appendChild(maxLabel);
        maxRow.appendChild(maxInput);
        settingsPanel.appendChild(maxRow);

        const stepRow = document.createElement('div');
        stepRow.className = 'param-settings-row';
        const stepLabel = document.createElement('span');
        stepLabel.className = 'param-settings-label';
        stepLabel.textContent = '步长';
        const stepInput = document.createElement('input');
        stepInput.type = 'number';
        stepInput.className = 'param-settings-input';
        stepInput.value = String(cfg.step);
        stepInput.step = 'any';
        stepRow.appendChild(stepLabel);
        stepRow.appendChild(stepInput);
        settingsPanel.appendChild(stepRow);

        const applyBtn = document.createElement('button');
        applyBtn.className = 'param-settings-apply-btn';
        applyBtn.textContent = '应用';
        settingsPanel.appendChild(applyBtn);

        settingsBtn.addEventListener('click', function () {
          const isOpen = settingsPanel.classList.contains('open');
          settingsPanel.classList.toggle('open');
          settingsBtn.classList.toggle('active');
          if (!isOpen) {
            minInput.value = String(cfg.min);
            maxInput.value = String(cfg.max);
            stepInput.value = String(cfg.step);
            errorEl.textContent = '';
          }
        });

        applyBtn.addEventListener('click', function () {
          const newMin = parseFloat(minInput.value);
          const newMax = parseFloat(maxInput.value);
          const newStep = parseFloat(stepInput.value);

          if (isNaN(newMin) || isNaN(newMax) || isNaN(newStep)) {
            errorEl.textContent = '请输入有效的数值';
            return;
          }
          if (newMin >= newMax) {
            errorEl.textContent = '最小值必须小于最大值';
            return;
          }
          if (newStep <= 0) {
            errorEl.textContent = '步长必须大于 0';
            return;
          }

          cfg.min = newMin;
          cfg.max = newMax;
          cfg.step = newStep;

          if (params[name] < newMin) params[name] = newMin;
          if (params[name] > newMax) params[name] = newMax;

          slider.min = String(newMin);
          slider.max = String(newMax);
          slider.step = String(newStep);
          slider.value = String(params[name]);
          valueEl.textContent = formatParamValue(params[name]);
          rangeEl.textContent = formatParamValue(newMin) + ' ~ ' + formatParamValue(newMax);

          settingsPanel.classList.remove('open');
          settingsBtn.classList.remove('active');
          errorEl.textContent = '';

          fps.setParams(params);
        });

        item.appendChild(header);
        item.appendChild(slider);
        item.appendChild(rangeEl);
        item.appendChild(settingsPanel);
        paramSliders.appendChild(item);
      }

      fps.setParams(params);
      updatePlayButtonIcon();
    }

    function renderFunctionList() {
      if (!list) return;
      while (list.firstChild) list.removeChild(list.firstChild);
      const fps = window.functionPlotterInstance;
      if (!fps || fps.functions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'function-list-empty';
        empty.textContent = i18n.t('function_empty');
        list.appendChild(empty);
        return;
      }
      for (let i = 0; i < fps.functions.length; i++) {
        const f = fps.functions[i];
        const item = document.createElement('div');
        item.className = 'function-item';
        const colorBox = document.createElement('div');
        colorBox.className = 'function-item-color';
        colorBox.style.backgroundColor = f.color;
        const expr = document.createElement('div');
        expr.className = 'function-item-expr';
        expr.textContent = f.input;
        const del = document.createElement('button');
        del.className = 'function-item-delete';
        del.textContent = i18n.t('delete');
        (function (idx) {
          del.addEventListener('click', function () {
            fps.removeFunction(idx);
            renderFunctionList();
            renderParamSliders();
          });
        })(i);
        item.appendChild(colorBox);
        item.appendChild(expr);
        item.appendChild(del);
        list.appendChild(item);
      }
    }

    function addFromInput() {
      if (!input || !input.value || !input.value.trim()) {
        showToast(i18n.t('toast_please_input_func'));
        return;
      }
      const result = window.functionPlotterInstance.addFunction(input.value);
      if (result.ok) {
        showToast(i18n.t('toast_func_added'));
        input.value = '';
        renderFunctionList();
        renderParamSliders();
      } else {
        showToast(i18n.t('toast_func_error', { msg: result.error || i18n.t('func_empty_expr') }));
      }
    }

    if (playBtn) playBtn.addEventListener('click', toggleAnimation);
    if (speedSelect) {
      speedSelect.addEventListener('change', function () {
        animSpeed = parseFloat(this.value) || 1;
      });
    }

    if (addBtn) addBtn.addEventListener('click', addFromInput);
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      window.functionPlotterInstance.clearFunctions();
      renderFunctionList();
      renderParamSliders();
      showToast(i18n.t('toast_func_cleared'));
    });
    if (zoomIn) zoomIn.addEventListener('click', function () {
      window.functionPlotterInstance.zoomByButton(10);
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      window.functionPlotterInstance.zoomByButton(-10);
    });
    // 初始绘制
    window.functionPlotterInstance.redraw();
    renderFunctionList();
    renderParamSliders();

    // 语言切换时重新渲染函数列表
    document.addEventListener('languagechange', function () {
      renderFunctionList();
    });
  }

  // ============================================================
  // Part 8: 初始化 / Initialization
  // ============================================================

  /**
   * init()
   * 绑定事件监听并设置初始 UI 状态。
   */
  function init() {
    // 初始化国际化 / init i18n
    if (window.i18n && typeof window.i18n.init === 'function') {
      window.i18n.init();
    }

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
    if (ensembleEl) ensembleEl.textContent = i18n.t('waiting_input');

    const listEl = document.getElementById('method-list');
    if (listEl) {
      // 清空可能存在的占位文本，统一插入占位节点
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      const empty = document.createElement('div');
      empty.textContent = i18n.t('waiting_predict');
      listEl.appendChild(empty);
    }

    console.log('[app] initialized, predictors:', predictors.length);

    // 落地页交互初始化 / landing page interaction
    initLandingPage();

    // 长期训练模式初始化 / long-term training mode init
    loadLongtermState();
    initLongtermToggle();

    // 计算器与页面切换初始化 / calculator and page switching init
    initCalculator();
    initPageSwitching();

    // 函数系统初始化 / Function Plotter init
    initFunctionPlotter();

    // 用户档案与设置初始化 / user profile and settings init
    const hasProfile = loadProfile();
    updateAppUserBar();
    applyBackground();
    initRegisterModal();
    initAppUserBar();
    initSettings();
    // 默认显示工具首页 / show app landing page by default
    showAppLanding();
    if (!hasProfile) {
      showRegisterModal();
    }

    // 语言切换事件监听 / language change event listener
    document.addEventListener('languagechange', function () {
      // 重新渲染预测系统相关内容
      renderEnsemble();
      renderNNResult();
      renderMethodList();
      renderFunctionFit();
      renderOverfit();
      renderOffset();
      updatePredictButtonText();
      setPredictButtonEnabled(true);

      // 重新渲染函数列表
      if (typeof renderFunctionList === 'function') {
        // renderFunctionList 在 initFunctionPlotter 内部定义，需要通过实例触发
      }
      if (window.functionPlotterInstance) {
        // 触发函数列表重新渲染（通过 app.js 内部的 renderFunctionList）
      }

      // 更新浮动头像标题
      updateFloatingAvatar();

      // 更新设置页语言选择器
      const langSelect = document.getElementById('settings-language');
      if (langSelect && i18n.getCurrentMode) {
        langSelect.value = i18n.getCurrentMode();
      }
    });

    initMobileOptimizations();
  }

  // ============================================================
  // 移动端优化 / Mobile Optimizations
  // ============================================================
  function initMobileOptimizations() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile && window.innerWidth > 768) return;

    const inputs = document.querySelectorAll('input, textarea, select');
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('focus', function () {
        const el = this;
        setTimeout(function () {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      });
    }

    let lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      const currentWidth = window.innerWidth;
      if (Math.abs(currentWidth - lastWidth) > 100) {
        lastWidth = currentWidth;
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          setTimeout(function () {
            active.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    });

    document.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  // ============================================================
  // 落地页交互 / Landing Page Interaction
  // ============================================================
  function initLandingPage() {
    var landing = document.getElementById('landing-page');
    var enterBtn = document.getElementById('btn-enter-predictor');
    if (!landing || !enterBtn) return;

    enterBtn.addEventListener('click', function () {
      showPredictor();
      setTimeout(function () {
        var textarea = document.getElementById('input-series');
        if (textarea) textarea.focus();
      }, 600);
    });

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
  // 暴露到全局 / Expose to global
  // ============================================================
  window.showLearningLanding = showLearningLanding;
  window.showArithmetic = showArithmetic;
  window.showMixedArithmetic = showMixedArithmetic;

  // ============================================================
  // 自检 / Self-test
  // ============================================================
  console.log('[app] script loaded');
})();
