/**
 * i18n.js
 * 中英文双语国际化模块 / Chinese-English Bilingual i18n Module
 *
 * 功能：
 *   - t(key) 翻译函数
 *   - 中文 zh / 英文 en 两套翻译
 *   - 自动检测系统语言
 *   - 语言模式：'auto' | 'zh' | 'en'，存 localStorage
 *   - 实时切换语言并更新所有 data-i18n 元素
 *   - 切换时触发 'languagechange' 自定义事件
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'pixel_tools_lang';

  const translations = {
    zh: {
      page_title: '像素风格工具网站 Pixel Tools',

      register_title: '欢迎来到像素风格工具网站',
      register_nickname_hint: '请输入你的昵称（可跳过）',
      register_placeholder: '访客',
      register_skip: '跳过',
      register_confirm: '确定',

      app_landing_title: '像素风格工具网站',
      app_landing_subtitle: 'PIXEL TOOLS',
      category_learning: '学习类 LEARNING',
      category_art: '艺术类 ART',
      card_math_title: '像素数学',
      card_math_desc: '数字序列预测 · 计算器 · 神经网络可视化',
      card_pixel_art_title: '像素艺术生成器',
      card_pixel_art_desc: '种子化随机生成像素艺术 · 流场 · 粒子 · 几何图案',
      card_pixel_draw_title: '像素绘图编辑器',
      card_pixel_draw_desc: '逐像素手绘创作 · 多图层 · 调色板 · 导出 PNG',
      card_pixel_music_title: '像素音乐合成器',
      card_pixel_music_desc: '8-bit 芯片音乐创作 · 音序器 · 多轨合成 · 导出 WAV',
      category_pixel_drawing: 'PIXEL DRAWING 像素图画',
      category_pixel_music: 'PIXEL MUSIC 像素音乐',
      footer_github: 'GitHub 仓库：xiaozhenweiyan/pixel-tools',

      back_to_tools: '← 返回工具首页',
      back_to_math: '← 返回像素数学',
      back_home: '← 返回首页',

      landing_title: '像素数学',
      landing_subtitle: 'PIXEL MATH',
      card_predictor_title: '预测系统',
      card_predictor_desc: '输入数字序列，40 种数学方法 + 神经网络预测',
      card_function_title: '函数系统',
      card_function_desc: '输入函数表达式 · 绘制平面直角坐标系图像',
      card_learning_title: '学习系统',
      card_learning_desc: '数学学习卡片，互动练习',
      card_calculator_title: '计算机系统',
      card_calculator_desc: '像素风计算器，支持四则运算与表达式求值',

      learning_title: '学习系统',
      learning_subtitle: 'LEARNING SYSTEM',
      learning_subdesc: '互动数学学习',
      learning_category_math: '数学学习卡片 MATH CARDS',
      card_arithmetic_title: '四则运算',
      card_arithmetic_desc: '加减乘除基础运算练习',
      card_mixed_title: '混合运算',
      card_mixed_desc: '带括号的四则混合运算练习',

      back_to_learning: '← 返回学习系统',
      arithmetic_title: '四则运算练习',
      arithmetic_subtitle: 'ARITHMETIC PRACTICE',
      tab_add: '加法 ADD',
      tab_subtract: '减法 SUB',
      tab_multiply: '乘法 MUL',
      tab_divide: '除法 DIV',
      progress_level: '关卡',
      arithmetic_input_placeholder: '输入答案',
      btn_submit: '提交',
      wrong_answer: '答错了！',
      correct_answer: '正确答案：',
      btn_continue: '继续',
      result_title: '练习完成！',
      stat_correct: '正确',
      stat_wrong: '错误',
      rating_3star: '太棒了！完美通关！',
      rating_2star: '做得不错！继续加油！',
      rating_1star: '还需努力，再接再厉！',
      review_title: '错题回顾',
      btn_retry: '再来一次',

      mixed_title: '混合运算练习',
      mixed_subtitle: 'MIXED ARITHMETIC PRACTICE',
      mixed_tab_easy: '简单 EASY',
      mixed_tab_medium: '中等 MEDIUM',
      mixed_tab_hard: '困难 HARD',
      mixed_steps_label: '运算过程：',

      predictor_title: '预测系统 PIXEL PREDICTOR',
      predictor_subtitle: '输入数字序列 · 40 种数学方法预测 · 复古深空像素风',
      input_series_title: '输入数字序列',
      input_series_placeholder: '输入数字，用空格/逗号/换行分隔，如：1, 2, 3, 5, 8, 13',
      btn_predict: '预测',
      btn_predict_train: '预测+训练',
      btn_reset: '重置',
      btn_export_json: '导出 JSON',
      btn_export_csv: '导出 CSV',
      label_longterm: '长期训练',
      weight_mode_label: '权重模式：',
      weight_backtest: '回测权重',
      weight_uniform: '均匀权重',
      training_label: '训练中...',
      training_step: '训练中 step {current} / {total}',
      training_complete: '训练完成，执行最终预测...',
      nn_training: '神经网络渐进训练中...',

      ensemble_title: '融合预测结果',
      waiting_input: '— 等待输入 —',
      waiting_predict: '— 等待预测 —',

      nn_title: '神经网络预测（独立，不参与融合）',

      weight_title: '方法权重',
      method_list_title: '40 种方法详情',
      method_need_more: '还差 {n} 个',
      method_failed: '预测失败',

      chart_title: '折线图（拖动滚动条平移 · +/- 缩放）',

      fit_title: '拟合函数',
      fit_domain: '定义域: ',
      fit_range: '值域: ',
      fit_r2: 'R²: ',

      overfit_title: '过拟合算法（独立，不参与融合）',

      offset_title: '偏移算法（独立，不参与融合）',
      offset_type: '类型: ',
      offset_exact_match: '✓ 精确匹配',
      offset_closest: '最接近',
      offset_prediction: '预测: ',

      footer_copyright: '© 2026 Pixel Predictor · MIT License · 复古深空像素风',

      toast_min_numbers: '至少需要 2 个数字',
      toast_ignored: '已忽略 {n} 个非法值',
      toast_prediction_done: '预测完成',
      toast_reset: '已重置',
      toast_export_first: '请先输入并预测',
      toast_export_json: '已导出 JSON',
      toast_export_csv: '已导出 CSV',
      toast_longterm_on: '长期训练模式已开启，每次预测将累积序列并增量训练神经网络',
      toast_longterm_off: '长期训练模式已关闭',
      toast_series_length: '累积序列长度：{n}',
      toast_training: '训练中...',

      calculator_title: '计算机系统 PIXEL CALCULATOR',
      calculator_subtitle: '按键或键盘输入 · 支持四则运算 · 复古深空像素风',
      calculator_heading: '计算器',
      calc_history_empty: '— 等待输入 —',
      calc_input_placeholder: '输入表达式，如 1+2*3，按回车求值',
      calc_steps_title: '运算过程',
      calc_steps_empty: '— 等待计算 —',
      calc_error: '错误',
      calc_angle_mode: '角度模式：{mode}',
      calc_empty_expr: '空表达式',
      calc_incomplete: '表达式不完整',
      calc_div_zero: '除数不能为零',
      calc_invalid_result: '结果无效',
      calc_syntax_error: '语法错误',
      calc_no_variable: '计算器不支持变量',
      calc_unknown_const: '未知常量: {name}',
      calc_unknown_op: '未知运算符: {op}',
      calc_unknown_func: '未知函数: {name}',
      calc_unknown_node: '未知 AST 节点类型: {type}',
      calc_sqrt_error: '根号内表达式错误',
      calc_trig_error: '{func} 内表达式错误',
      calc_paren_error: '括号内表达式错误',

      function_title: '函数系统 PIXEL FUNCTION',
      function_subtitle: '输入函数表达式 · 平面直角坐标系 · 拖拽平移 · 滚轮缩放',
      function_canvas_title: '坐标系',
      function_input_title: '函数输入',
      function_input_placeholder: '输入函数，如 y=x^2 或 f(x)=sin(x)，按回车添加',
      btn_add: '添加',
      btn_clear_all: '清除全部',
      function_empty: '— 暂无函数 —',
      function_help_1: '支持格式：y=表达式 或 f(x)=表达式',
      function_help_2: '支持函数：sin, cos, tan, log, sqrt, abs, exp',
      function_help_3: '支持运算：+ - * / ^（幂）',
      function_help_4: '操作：鼠标拖拽平移 · 滚轮缩放 · 右下角 +/- 按钮缩放',
      toast_please_input_func: '请输入函数表达式',
      toast_func_added: '已添加函数',
      toast_func_error: '错误：{msg}',
      toast_func_cleared: '已清除所有函数',
      func_empty_input: '空输入',
      func_empty_expr: '表达式为空',
      func_parse_error: '表达式错误：{msg}',
      func_not_number: '结果不是数字',

      pixel_art_title: '像素艺术生成器 PIXEL ART',
      pixel_art_subtitle: '种子化随机生成 · 复古深空像素风',
      canvas_title: '画布',
      controls_title: '控制台',
      label_seed: '种子',
      btn_random_seed: '随机种子',
      label_art_mode: '艺术模式',
      mode_flow: '流场 Flow Field',
      mode_particles: '粒子系统 Particles',
      mode_mosaic: '几何马赛克 Mosaic',
      mode_spiral: '螺旋 Spiral',
      mode_fractal_tree: '分形树 Fractal Tree',
      mode_voronoi: 'Voronoi 镶嵌',
      mode_wave: '波干涉 Wave',
      mode_reaction_diffusion: '反应扩散 RD',
      label_resolution: '分辨率',
      label_density: '密度',
      label_hue: '色相',
      label_fractal_depth: '递归深度',
      label_fractal_angle: '分支角度',
      label_fractal_ratio: '长度衰减',
      label_fractal_initlen: '初始长度',
      label_voronoi_points: '种子点数',
      label_voronoi_relax: '松弛迭代',
      label_voronoi_color: '配色方式',
      voronoi_color_distance: '按距离',
      voronoi_color_size: '按细胞大小',
      label_wave_sources: '波源数量',
      label_wave_freq: '频率',
      label_wave_amp: '振幅',
      label_rd_feed: 'Feed 速率',
      label_rd_kill: 'Kill 速率',
      label_rd_iter: '迭代次数',
      btn_regenerate: '重新生成',
      btn_download: '下载 PNG',
      btn_animate: '动画播放',
      btn_stop_animate: '停止动画',
      toast_regenerated: '已重新生成',
      toast_download_done: '已下载 PNG ({size}×{size})',
      toast_download_error: '下载失败：{msg}',
      toast_animate_not_supported: '该模式不支持动画播放（仅流场和粒子模式支持）',

      pixel_drawing_title: '像素绘图编辑器 PIXEL DRAWING EDITOR',
      pixel_drawing_subtitle: '逐像素手绘创作 · 调色板 · 导出 PNG',
      tool_brush: '画笔',
      tool_eraser: '橡皮',
      tool_picker: '取色器',
      tool_bucket: '填色桶',
      tool_line: '直线',
      tool_rect: '矩形',
      tool_circle: '圆形',
      tool_undo: '撤销',
      tool_redo: '重做',
      tool_mirror: '水平镜像',
      tool_clear: '清空画布',
      tool_grid: '网格线',
      palette_title: '调色板',
      custom_color: '自定义颜色',
      current_color: '当前颜色',
      foreground_color: '前景色',
      background_color: '背景色',
      canvas_size: '画布尺寸',
      export_png: '导出 PNG',
      toast_canvas_cleared: '画布已清空',
      toast_color_picked: '已取色',
      toast_bucket_filled: '已填充',
      toast_canvas_resized: '画布尺寸已调整为 {size}×{size}',
      toast_export_png: '已导出 PNG',
      confirm_clear_canvas: '确定要清空画布吗？',
      confirm_resize_canvas: '调整画布尺寸会清空当前内容，确定继续吗？',

      settings_title: '个人设置 PIXEL SETTINGS',
      settings_subtitle: '昵称 · 头像 · 背景 · 临时账号（关闭浏览器自动销毁）',
      settings_heading: '个人设置',
      label_nickname: '昵称',
      nickname_placeholder: '输入新昵称',
      btn_save_nickname: '保存昵称',
      label_avatar: '头像（≤200KB，jpg/png/gif/webp/svg）',
      btn_clear_avatar: '清除头像',
      label_bg_image: '背景图片（≤1MB，jpg/png/gif/webp/svg）',
      label_bg_color: '背景颜色',
      btn_apply_color: '应用颜色',
      btn_reset_bg: '恢复默认背景',
      btn_logout: '退出登录',
      btn_back_home: '返回首页',
      label_language: '语言',
      lang_auto: '跟随系统',
      lang_zh: '中文',
      lang_en: '英文',
      btn_reload: '刷新',
      btn_reload_title: '语言切换失败时点击刷新页面',

      label_wasm_acceleration: 'WebAssembly 加速',
      wasm_desc: '反应扩散模式硬件加速（实验性功能）',
      toast_wasm_enabled: 'WebAssembly 加速已开启，反应扩散模式将使用 Wasm 加速',
      toast_wasm_disabled: 'WebAssembly 加速已关闭',
      toast_wasm_load_failed: 'Wasm 模块加载失败，将使用 JS 版本',

      guest: '访客',
      toast_welcome: '欢迎你，{name}！',
      toast_default_nickname: '已使用默认昵称"访客"',
      toast_nickname_updated: '昵称已更新：{name}',
      toast_image_too_big: '图片过大，请用更小的图片',
      toast_storage_failed: '存储失败：{msg}',
      toast_unknown_error: '未知错误',
      toast_unsupported_format: '不支持的格式，请使用 jpg/png/gif/webp/svg',
      toast_file_too_big: '文件过大（>{size}KB），请压缩后上传',
      toast_file_read_error: '文件读取失败',
      toast_svg_too_big: 'SVG 文件过大（>200KB），请精简后上传',
      toast_svg_unsafe: 'SVG 文件含不安全内容或格式错误，已拒绝',
      toast_avatar_updated: '头像已更新',
      toast_avatar_cleared: '头像已清除',
      toast_bg_image_applied: '背景图片已应用',
      toast_bg_color_applied: '背景颜色已应用：{color}',
      toast_bg_reset: '已恢复默认背景',
      toast_logged_out: '已退出，数据已清除',
      toast_compressing: '正在压缩图片...',
      toast_image_process_error: '图片处理失败：{msg}',
      toast_image_load_error: '图片加载失败',
      toast_invalid_size: '图片尺寸无效',
      toast_pixel_too_big: '图片像素尺寸过大（单边 > {size}px）',
      toast_total_pixel_too_big: '图片总像素过大（> {size} 像素）',
      toast_file_10mb: '文件过大（>10MB），请压缩后上传',

      floating_settings_title: '个人系统',
      floating_avatar_title: '访客',

      coming_soon: '四则运算学习卡片即将上线，敬请期待',
      mixed_coming_soon: '混合运算学习卡片即将上线，敬请期待',
      toast_pixel_draw_coming_soon: '像素绘图编辑器即将上线，敬请期待',
      toast_pixel_music_coming_soon: '像素音乐合成器即将上线，敬请期待',

      pixel_music_title: '像素音乐合成器 PIXEL MUSIC SYNTH',
      pixel_music_subtitle: '8-bit 芯片音乐 · 钢琴键盘 · 多音色合成 · 示波器可视化',
      pixel_music_back: '← 返回工具首页',
      pixel_music_waveform: '波形 WAVEFORM',
      pixel_music_timbre: '音色 TIMBRE',
      pixel_music_volume: '音量 VOLUME',
      pixel_music_octave: '八度 OCTAVE',
      pixel_music_square: '方波 SQUARE',
      pixel_music_triangle: '三角波 TRIANGLE',
      pixel_music_sawtooth: '锯齿波 SAWTOOTH',
      pixel_music_noise: '噪声 NOISE',
      pixel_music_keyboard_hint: '键盘按键：白键 A S D F G H J K L ; \'  黑键 W E T Y U O P',
      pixel_music_click_to_start: '点击任意琴键开始演奏',

      sequencer_title: '音序器 SEQUENCER',
      sequencer_play: '播放',
      sequencer_stop: '停止',
      sequencer_bpm: '速度 BPM',
      sequencer_step: '步',
      sequencer_track: '轨',
      sequencer_pitch: '音高',
      sequencer_note_c4: 'C4',
      sequencer_note_d4: 'D4',
      sequencer_note_e4: 'E4',
      sequencer_note_f4: 'F4',
      sequencer_note_g4: 'G4',
      sequencer_note_a4: 'A4',
      sequencer_note_b4: 'B4',
      sequencer_note_c5: 'C5',
      sequencer_note_d5: 'D5',
      sequencer_note_e5: 'E5',

      delete: '删除'
    },

    en: {
      page_title: 'Pixel Tools',

      register_title: 'Welcome to Pixel Tools',
      register_nickname_hint: 'Enter your nickname (optional)',
      register_placeholder: 'Guest',
      register_skip: 'Skip',
      register_confirm: 'Confirm',

      app_landing_title: 'PIXEL TOOLS',
      app_landing_subtitle: 'PIXEL TOOLS',
      category_learning: 'LEARNING',
      category_art: 'ART',
      card_math_title: 'Pixel Math',
      card_math_desc: 'Number Sequence Prediction · Calculator · Neural Network Visualization',
      card_pixel_art_title: 'Pixel Art Generator',
      card_pixel_art_desc: 'Seeded Random Pixel Art · Flow Field · Particles · Geometric Patterns',
      card_pixel_draw_title: 'Pixel Draw Editor',
      card_pixel_draw_desc: 'Pixel-by-pixel drawing · Multi-layer · Palette · Export PNG',
      card_pixel_music_title: 'Pixel Music Synthesizer',
      card_pixel_music_desc: '8-bit Chiptune · Sequencer · Multi-track · Export WAV',
      category_pixel_drawing: 'PIXEL DRAWING',
      category_pixel_music: 'PIXEL MUSIC',
      footer_github: 'GitHub: xiaozhenweiyan/pixel-tools',

      back_to_tools: '← Back to Tools',
      back_to_math: '← Back to Pixel Math',
      back_home: '← Back Home',

      landing_title: 'PIXEL MATH',
      landing_subtitle: 'PIXEL MATH',
      card_predictor_title: 'Prediction System',
      card_predictor_desc: 'Enter number sequence, 40 math methods + neural network prediction',
      card_function_title: 'Function System',
      card_function_desc: 'Enter function expression · Plot on Cartesian coordinate system',
      card_learning_title: 'Learning System',
      card_learning_desc: 'Math learning cards, interactive practice',
      card_calculator_title: 'Calculator System',
      card_calculator_desc: 'Pixel-style calculator, supports arithmetic and expression evaluation',

      learning_title: 'LEARNING SYSTEM',
      learning_subtitle: 'LEARNING SYSTEM',
      learning_subdesc: 'Interactive Math Learning',
      learning_category_math: 'MATH CARDS',
      card_arithmetic_title: 'Arithmetic',
      card_arithmetic_desc: 'Basic addition, subtraction, multiplication, division practice',
      card_mixed_title: 'Mixed Operations',
      card_mixed_desc: 'Mixed arithmetic practice with parentheses',

      back_to_learning: '← Back to Learning',
      arithmetic_title: 'Arithmetic Practice',
      arithmetic_subtitle: 'ARITHMETIC PRACTICE',
      tab_add: 'ADD',
      tab_subtract: 'SUB',
      tab_multiply: 'MUL',
      tab_divide: 'DIV',
      progress_level: 'Level',
      arithmetic_input_placeholder: 'Enter answer',
      btn_submit: 'SUBMIT',
      wrong_answer: 'Wrong answer!',
      correct_answer: 'Correct answer:',
      btn_continue: 'Continue',
      result_title: 'Practice Complete!',
      stat_correct: 'Correct',
      stat_wrong: 'Wrong',
      rating_3star: 'Amazing! Perfect score!',
      rating_2star: 'Good job! Keep going!',
      rating_1star: 'Keep practicing, you got this!',
      review_title: 'Wrong Answers Review',
      btn_retry: 'Try Again',

      mixed_title: 'Mixed Arithmetic Practice',
      mixed_subtitle: 'MIXED ARITHMETIC PRACTICE',
      mixed_tab_easy: 'Easy EASY',
      mixed_tab_medium: 'Medium MEDIUM',
      mixed_tab_hard: 'Hard HARD',
      mixed_steps_label: 'Calculation steps:',

      predictor_title: 'PIXEL PREDICTOR',
      predictor_subtitle: 'Enter number sequence · 40 math methods · Retro deep-space pixel style',
      input_series_title: 'Enter Number Sequence',
      input_series_placeholder: 'Enter numbers separated by space/comma/newline, e.g. 1, 2, 3, 5, 8, 13',
      btn_predict: 'PREDICT',
      btn_predict_train: 'PREDICT+TRAIN',
      btn_reset: 'RESET',
      btn_export_json: 'EXPORT JSON',
      btn_export_csv: 'EXPORT CSV',
      label_longterm: 'Long-term Training',
      weight_mode_label: 'Weight Mode:',
      weight_backtest: 'Backtest Weight',
      weight_uniform: 'Uniform Weight',
      training_label: 'Training...',
      training_step: 'Training step {current} / {total}',
      training_complete: 'Training complete, final prediction...',
      nn_training: 'Neural network progressive training...',

      ensemble_title: 'Ensemble Prediction',
      waiting_input: '— WAITING FOR INPUT —',
      waiting_predict: '— WAITING FOR PREDICTION —',

      nn_title: 'Neural Network (Independent, Not in Ensemble)',

      weight_title: 'Method Weights',
      method_list_title: '40 Methods Details',
      method_need_more: 'Need {n} more',
      method_failed: 'Prediction Failed',

      chart_title: 'Line Chart (Drag scrollbar to pan · +/- to zoom)',

      fit_title: 'Fitted Function',
      fit_domain: 'Domain: ',
      fit_range: 'Range: ',
      fit_r2: 'R²: ',

      overfit_title: 'Overfit Algorithm (Independent, Not in Ensemble)',

      offset_title: 'Offset Algorithm (Independent, Not in Ensemble)',
      offset_type: 'Type: ',
      offset_exact_match: '✓ Exact Match',
      offset_closest: 'Closest Match',
      offset_prediction: 'Prediction: ',

      footer_copyright: '© 2026 Pixel Predictor · MIT License · Retro Deep-Space Pixel Style',

      toast_min_numbers: 'At least 2 numbers required',
      toast_ignored: 'Ignored {n} invalid values',
      toast_prediction_done: 'Prediction complete',
      toast_reset: 'Reset complete',
      toast_export_first: 'Please input and predict first',
      toast_export_json: 'JSON exported',
      toast_export_csv: 'CSV exported',
      toast_longterm_on: 'Long-term training mode enabled. Each prediction accumulates the sequence and incrementally trains the neural network.',
      toast_longterm_off: 'Long-term training mode disabled',
      toast_series_length: 'Accumulated sequence length: {n}',
      toast_training: 'Training...',

      calculator_title: 'PIXEL CALCULATOR',
      calculator_subtitle: 'Button or keyboard input · Supports arithmetic · Retro deep-space pixel style',
      calculator_heading: 'Calculator',
      calc_history_empty: '— WAITING FOR INPUT —',
      calc_input_placeholder: 'Enter expression, e.g. 1+2*3, press Enter to evaluate',
      calc_steps_title: 'Calculation Steps',
      calc_steps_empty: '— WAITING FOR CALCULATION —',
      calc_error: 'Error',
      calc_angle_mode: 'Angle Mode: {mode}',
      calc_empty_expr: 'Empty expression',
      calc_incomplete: 'Incomplete expression',
      calc_div_zero: 'Division by zero',
      calc_invalid_result: 'Invalid result',
      calc_syntax_error: 'Syntax error',
      calc_no_variable: 'Variables not supported in calculator',
      calc_unknown_const: 'Unknown constant: {name}',
      calc_unknown_op: 'Unknown operator: {op}',
      calc_unknown_func: 'Unknown function: {name}',
      calc_unknown_node: 'Unknown AST node type: {type}',
      calc_sqrt_error: 'Invalid expression inside sqrt',
      calc_trig_error: 'Invalid expression inside {func}',
      calc_paren_error: 'Invalid expression inside parentheses',

      function_title: 'PIXEL FUNCTION',
      function_subtitle: 'Enter function expression · Cartesian coordinates · Drag to pan · Scroll to zoom',
      function_canvas_title: 'Coordinate System',
      function_input_title: 'Function Input',
      function_input_placeholder: 'Enter function, e.g. y=x^2 or f(x)=sin(x), press Enter to add',
      btn_add: 'ADD',
      btn_clear_all: 'CLEAR ALL',
      function_empty: '— NO FUNCTIONS YET —',
      function_help_1: 'Supported formats: y=expression or f(x)=expression',
      function_help_2: 'Supported functions: sin, cos, tan, log, sqrt, abs, exp',
      function_help_3: 'Supported operations: + - * / ^ (power)',
      function_help_4: 'Controls: Drag to pan · Scroll to zoom · +/- buttons in bottom-right to zoom',
      toast_please_input_func: 'Please enter a function expression',
      toast_func_added: 'Function added',
      toast_func_error: 'Error: {msg}',
      toast_func_cleared: 'All functions cleared',
      func_empty_input: 'Empty input',
      func_empty_expr: 'Empty expression',
      func_parse_error: 'Expression error: {msg}',
      func_not_number: 'Result is not a number',

      pixel_art_title: 'PIXEL ART',
      pixel_art_subtitle: 'Seeded random generation · Retro deep-space pixel style',
      canvas_title: 'Canvas',
      controls_title: 'Controls',
      label_seed: 'Seed',
      btn_random_seed: 'Random Seed',
      label_art_mode: 'Art Mode',
      mode_flow: 'Flow Field',
      mode_particles: 'Particles',
      mode_mosaic: 'Geometric Mosaic',
      mode_spiral: 'Spiral',
      mode_fractal_tree: 'Fractal Tree',
      mode_voronoi: 'Voronoi Tessellation',
      mode_wave: 'Wave Interference',
      mode_reaction_diffusion: 'Reaction-Diffusion',
      label_resolution: 'Resolution',
      label_density: 'Density',
      label_hue: 'Hue',
      label_fractal_depth: 'Recursion Depth',
      label_fractal_angle: 'Branch Angle',
      label_fractal_ratio: 'Length Ratio',
      label_fractal_initlen: 'Initial Length',
      label_voronoi_points: 'Seed Points',
      label_voronoi_relax: 'Relaxation Iterations',
      label_voronoi_color: 'Color Mode',
      voronoi_color_distance: 'By Distance',
      voronoi_color_size: 'By Cell Size',
      label_wave_sources: 'Wave Sources',
      label_wave_freq: 'Frequency',
      label_wave_amp: 'Amplitude',
      label_rd_feed: 'Feed Rate',
      label_rd_kill: 'Kill Rate',
      label_rd_iter: 'Iterations',
      btn_regenerate: 'Regenerate',
      btn_download: 'Download PNG',
      btn_animate: 'Animate',
      btn_stop_animate: 'Stop Animation',
      toast_regenerated: 'Regenerated',
      toast_download_done: 'PNG downloaded ({size}×{size})',
      toast_download_error: 'Download failed: {msg}',
      toast_animate_not_supported: 'Animation not supported for this mode (only Flow Field and Particles)',

      pixel_drawing_title: 'PIXEL DRAWING EDITOR',
      pixel_drawing_subtitle: 'Pixel-by-pixel drawing · Palette · Export PNG',
      tool_brush: 'Brush',
      tool_eraser: 'Eraser',
      tool_picker: 'Color Picker',
      tool_bucket: 'Fill Bucket',
      tool_line: 'Line',
      tool_rect: 'Rectangle',
      tool_circle: 'Circle',
      tool_undo: 'Undo',
      tool_redo: 'Redo',
      tool_mirror: 'Horizontal Mirror',
      tool_clear: 'Clear Canvas',
      tool_grid: 'Grid',
      palette_title: 'Palette',
      custom_color: 'Custom Color',
      current_color: 'Current Color',
      foreground_color: 'Foreground',
      background_color: 'Background',
      canvas_size: 'Canvas Size',
      export_png: 'Export PNG',
      toast_canvas_cleared: 'Canvas cleared',
      toast_color_picked: 'Color picked',
      toast_bucket_filled: 'Area filled',
      toast_canvas_resized: 'Canvas resized to {size}×{size}',
      toast_export_png: 'PNG exported',
      confirm_clear_canvas: 'Are you sure you want to clear the canvas?',
      confirm_resize_canvas: 'Resizing will clear the canvas. Continue?',

      settings_title: 'PIXEL SETTINGS',
      settings_subtitle: 'Nickname · Avatar · Background · Temporary account (auto-destroy on browser close)',
      settings_heading: 'Personal Settings',
      label_nickname: 'Nickname',
      nickname_placeholder: 'Enter new nickname',
      btn_save_nickname: 'Save Nickname',
      label_avatar: 'Avatar (≤200KB, jpg/png/gif/webp/svg)',
      btn_clear_avatar: 'Clear Avatar',
      label_bg_image: 'Background Image (≤1MB, jpg/png/gif/webp/svg)',
      label_bg_color: 'Background Color',
      btn_apply_color: 'Apply Color',
      btn_reset_bg: 'Reset Background',
      btn_logout: 'Log Out',
      btn_back_home: 'Back Home',
      label_language: 'Language',
      lang_auto: 'System Default',
      lang_zh: '中文',
      lang_en: 'English',
      btn_reload: 'Reload',
      btn_reload_title: 'Click to reload page if language switch fails',

      label_wasm_acceleration: 'WebAssembly Acceleration',
      wasm_desc: 'Reaction-Diffusion mode hardware acceleration (experimental)',
      toast_wasm_enabled: 'WebAssembly acceleration enabled. Reaction-Diffusion mode will use Wasm acceleration.',
      toast_wasm_disabled: 'WebAssembly acceleration disabled',
      toast_wasm_load_failed: 'Wasm module load failed, falling back to JS version',

      guest: 'Guest',
      toast_welcome: 'Welcome, {name}!',
      toast_default_nickname: 'Using default nickname "Guest"',
      toast_nickname_updated: 'Nickname updated: {name}',
      toast_image_too_big: 'Image too large, please use a smaller image',
      toast_storage_failed: 'Storage failed: {msg}',
      toast_unknown_error: 'Unknown error',
      toast_unsupported_format: 'Unsupported format, please use jpg/png/gif/webp/svg',
      toast_file_too_big: 'File too large (>{size}KB), please compress and upload again',
      toast_file_read_error: 'File read failed',
      toast_svg_too_big: 'SVG file too large (>200KB), please simplify and upload again',
      toast_svg_unsafe: 'SVG contains unsafe content or has invalid format, rejected',
      toast_avatar_updated: 'Avatar updated',
      toast_avatar_cleared: 'Avatar cleared',
      toast_bg_image_applied: 'Background image applied',
      toast_bg_color_applied: 'Background color applied: {color}',
      toast_bg_reset: 'Background reset to default',
      toast_logged_out: 'Logged out, data cleared',
      toast_compressing: 'Compressing image...',
      toast_image_process_error: 'Image processing failed: {msg}',
      toast_image_load_error: 'Image load failed',
      toast_invalid_size: 'Invalid image dimensions',
      toast_pixel_too_big: 'Image pixel size too large (side > {size}px)',
      toast_total_pixel_too_big: 'Total image pixels too large (> {size} pixels)',
      toast_file_10mb: 'File too large (>10MB), please compress and upload again',

      floating_settings_title: 'Settings',
      floating_avatar_title: 'Guest',

      coming_soon: 'Arithmetic learning cards coming soon, stay tuned',
      mixed_coming_soon: 'Mixed operations learning cards coming soon, stay tuned',
      toast_pixel_draw_coming_soon: 'Pixel Draw Editor coming soon, stay tuned',
      toast_pixel_music_coming_soon: 'Pixel Music Synthesizer coming soon, stay tuned',

      pixel_music_title: 'PIXEL MUSIC SYNTH',
      pixel_music_subtitle: '8-bit Chiptune · Piano Keyboard · Multi-timbre Synthesis · Oscilloscope Visualization',
      pixel_music_back: '← Back to Tools',
      pixel_music_waveform: 'WAVEFORM',
      pixel_music_timbre: 'TIMBRE',
      pixel_music_volume: 'VOLUME',
      pixel_music_octave: 'OCTAVE',
      pixel_music_square: 'SQUARE',
      pixel_music_triangle: 'TRIANGLE',
      pixel_music_sawtooth: 'SAWTOOTH',
      pixel_music_noise: 'NOISE',
      pixel_music_keyboard_hint: 'Keyboard: White keys A S D F G H J K L ; \'  Black keys W E T Y U O P',
      pixel_music_click_to_start: 'Click any key to start playing',

      sequencer_title: 'SEQUENCER',
      sequencer_play: 'PLAY',
      sequencer_stop: 'STOP',
      sequencer_bpm: 'BPM',
      sequencer_step: 'Step',
      sequencer_track: 'Track',
      sequencer_pitch: 'Pitch',
      sequencer_note_c4: 'C4',
      sequencer_note_d4: 'D4',
      sequencer_note_e4: 'E4',
      sequencer_note_f4: 'F4',
      sequencer_note_g4: 'G4',
      sequencer_note_a4: 'A4',
      sequencer_note_b4: 'B4',
      sequencer_note_c5: 'C5',
      sequencer_note_d5: 'D5',
      sequencer_note_e5: 'E5',

      delete: 'Delete'
    }
  };

  let currentMode = 'auto';
  let currentLang = 'zh';

  function detectSystemLang() {
    const lang = navigator.language || navigator.userLanguage || 'en';
    if (lang.startsWith('zh')) {
      return 'zh';
    }
    return 'en';
  }

  function resolveLang() {
    if (currentMode === 'auto') {
      return detectSystemLang();
    }
    return currentMode;
  }

  function t(key, params) {
    const langData = translations[currentLang] || translations.en;
    let text = langData[key];
    if (text === undefined || text === null) {
      text = translations.en[key] || key;
    }
    if (params && typeof params === 'object') {
      text = text.replace(/\{(\w+)\}/g, function (match, paramKey) {
        return params.hasOwnProperty(paramKey) ? params[paramKey] : match;
      });
    }
    return text;
  }

  function applyToDOM() {
    const elements = document.querySelectorAll('[data-i18n]');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      const text = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else if (el.tagName === 'OPTION') {
        el.textContent = text;
      } else {
        el.textContent = text;
      }
      // 同步更新 title 属性（如果元素有 data-i18n-title）
      const titleKey = el.getAttribute('data-i18n-title');
      if (titleKey) {
        el.title = t(titleKey);
      }
    }

    document.title = t('page_title');
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

    const floatingSettings = document.getElementById('btn-floating-settings');
    if (floatingSettings) {
      floatingSettings.title = t('floating_settings_title');
      floatingSettings.setAttribute('aria-label', t('floating_settings_title'));
    }

    const langSelect = document.getElementById('settings-language');
    if (langSelect && !langSelect.dataset.i18nBound) {
      langSelect.value = currentMode;
      langSelect.dataset.i18nBound = 'true';
    }
  }

  function setLanguage(mode) {
    if (mode !== 'auto' && mode !== 'zh' && mode !== 'en') {
      mode = 'auto';
    }
    currentMode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) { /* ignore */ }

    const newLang = resolveLang();
    if (newLang !== currentLang) {
      currentLang = newLang;
    }

    applyToDOM();

    const event = new CustomEvent('languagechange', {
      detail: { lang: currentLang, mode: currentMode }
    });
    document.dispatchEvent(event);
  }

  function getCurrentLang() {
    return currentLang;
  }

  function getCurrentMode() {
    return currentMode;
  }

  function init() {
    let savedMode = null;
    try {
      savedMode = localStorage.getItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }

    if (savedMode === 'zh' || savedMode === 'en' || savedMode === 'auto') {
      currentMode = savedMode;
    } else {
      currentMode = 'auto';
    }

    currentLang = resolveLang();
    applyToDOM();
  }

  window.i18n = {
    t: t,
    init: init,
    setLanguage: setLanguage,
    getCurrentLang: getCurrentLang,
    getCurrentMode: getCurrentMode
  };
})();
