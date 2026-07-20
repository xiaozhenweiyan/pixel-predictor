/**
 * physics-sandbox.js
 * 像素风 2D 物理沙盒 / Pixel 2D Physics Sandbox (Falling Sand 风格)
 *
 * 功能：
 *   - 网格化元素模拟：沙子 / 水 / 石头 / 火 / 植物 / 金属 / 油 / 酸
 *   - 鼠标拖拽绘制元素，实时模拟下落 / 流动 / 燃烧 / 腐蚀 / 生长
 *   - 像素风 Canvas 渲染（每格 2×2 像素），requestAnimationFrame 驱动
 *
 * 性能优化：
 *   - 从底向上扫描（先处理下层，避免上层"穿透"下层）
 *   - 每行随机左右方向（避免整体偏向一侧）
 *   - 已处理标记 moved（避免一帧内同一元素被多次处理，等效双缓冲）
 *
 * 用法：
 *   PhysicsSandbox.init('physics-sandbox-canvas');
 *   PhysicsSandbox.setElement(PhysicsSandbox.SAND);
 *   PhysicsSandbox.setBrushSize(4);
 *   PhysicsSandbox.start();
 *   PhysicsSandbox.clear();
 *   PhysicsSandbox.stop();
 */
window.PhysicsSandbox = (function () {
  'use strict';

  // ============================================================
  // 元素类型 / Element Types
  // ============================================================
  const EMPTY = 0;  // 空
  const SAND  = 1;  // 沙子：下落、堆积
  const WATER = 2;  // 水：下落 + 流动
  const STONE = 3;  // 石头：静止
  const FIRE  = 4;  // 火：上升、寿命有限、点燃植物/油
  const PLANT = 5;  // 植物：静止、接触水时生长
  const METAL = 6;  // 金属：静止
  const OIL   = 7;  // 油：像水但更轻、可燃
  const ACID  = 8;  // 酸：像水、腐蚀其他元素（除石头/金属）

  // ============================================================
  // 颜色 / Colors（按元素 id 索引）
  // ============================================================
  const HEX_COLORS = [
    '#1a1a2e', // EMPTY 背景色
    '#c2b280', // SAND  沙色
    '#1e90ff', // WATER 蓝
    '#808080', // STONE 灰
    '#ff4500', // FIRE  红
    '#228b22', // PLANT 绿
    '#c0c0c0', // METAL 银
    '#556b2f', // OIL   暗黄绿
    '#adff2f'  // ACID  亮绿
  ];

  const ELEMENT_NAMES = ['橡皮', '沙子', '水', '石头', '火', '植物', '金属', '油', '酸'];

  // hex -> [r,g,b]
  function parseColor(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substr(0, 2), 16),
      parseInt(h.substr(2, 2), 16),
      parseInt(h.substr(4, 2), 16)
    ];
  }

  // 预解析 RGB（渲染时直接取用，避免重复解析）
  const COLOR_RGB = HEX_COLORS.map(parseColor);

  // ============================================================
  // 参数 / Params
  // ============================================================
  const FIRE_LIFETIME  = 60;           // 火的基础寿命（帧）
  const CELL_SIZE      = 2;            // 每格像素大小（1-2 像素）
  const DEFAULT_COLS   = 200;          // 默认网格列数
  const DEFAULT_ROWS   = 150;          // 默认网格行数
  const PLANT_GROW_CHANCE   = 0.03;    // 植物每帧生长概率
  const ACID_CORRODE_CHANCE = 0.25;    // 酸接触腐蚀触发概率

  // ============================================================
  // 运行时状态 / Runtime State
  // ============================================================
  let canvas = null;
  let ctx = null;
  let cols = DEFAULT_COLS;
  let rows = DEFAULT_ROWS;
  let grid    = null;   // 元素 id (Uint8Array)
  let auxGrid = null;   // 辅助数据（当前仅存火剩余寿命）
  let moved   = null;   // 本帧已处理标记（等效双缓冲，防重复处理）
  let imageData = null; // 渲染缓冲
  let running = false;
  let rafId   = null;
  let currentElement = SAND;
  let brushSize = 3;
  let isDrawing = false;
  let lastX = -1;
  let lastY = -1;

  // ============================================================
  // 工具函数 / Helpers
  // ============================================================

  function inBounds(x, y) {
    return x >= 0 && x < cols && y >= 0 && y < rows;
  }

  // 交换两格内容（含辅助数据），并标记本帧已处理
  function swap(aIdx, bIdx) {
    const t = grid[aIdx]; grid[aIdx] = grid[bIdx]; grid[bIdx] = t;
    const ta = auxGrid[aIdx]; auxGrid[aIdx] = auxGrid[bIdx]; auxGrid[bIdx] = ta;
    moved[aIdx] = 1;
    moved[bIdx] = 1;
  }

  // 把 fromIdx 的内容移动到 toIdx（toIdx 必须为空），fromIdx 清空
  function moveTo(fromIdx, toIdx) {
    grid[toIdx] = grid[fromIdx];
    auxGrid[toIdx] = auxGrid[fromIdx];
    grid[fromIdx] = EMPTY;
    auxGrid[fromIdx] = 0;
    moved[toIdx] = 1;
    moved[fromIdx] = 1;
  }

  // ============================================================
  // 物理规则 / Physics Rules
  // ============================================================

  // 沙子：尝试下落，下方被占则左下/右下；可沉入较轻液体（水/油/酸）
  function updateSand(x, y, idx) {
    const by = y + 1;
    if (by >= rows) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (trySink(x, by, idx)) return;
    if (trySink(x + dir, by, idx)) return;
    if (trySink(x - dir, by, idx)) return;
  }

  // 沙子尝试进入目标格（空或较轻液体）
  function trySink(tx, ty, fromIdx) {
    if (!inBounds(tx, ty)) return false;
    const toIdx = ty * cols + tx;
    if (moved[toIdx]) return false;
    const t = grid[toIdx];
    if (t === EMPTY) { moveTo(fromIdx, toIdx); return true; }
    if (t === WATER || t === OIL || t === ACID) { swap(fromIdx, toIdx); return true; }
    return false;
  }

  // 液体通用流动：下、下左/下右、左/右，仅流入空格
  function flowLiquid(x, y, idx) {
    const by = y + 1;
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (by < rows) {
      if (tryFlow(x, by, idx)) return;
      if (tryFlow(x + dir, by, idx)) return;
      if (tryFlow(x - dir, by, idx)) return;
    }
    if (tryFlow(x + dir, y, idx)) return;
    if (tryFlow(x - dir, y, idx)) return;
  }

  // 液体尝试流入空格
  function tryFlow(tx, ty, fromIdx) {
    if (!inBounds(tx, ty)) return false;
    const toIdx = ty * cols + tx;
    if (moved[toIdx] || grid[toIdx] !== EMPTY) return false;
    moveTo(fromIdx, toIdx);
    return true;
  }

  // 水：标准液体流动
  function updateWater(x, y, idx) {
    flowLiquid(x, y, idx);
  }

  // 油：比水/酸轻，先尝试上浮到水/酸上方，否则像水一样流动
  function updateOil(x, y, idx) {
    const ay = y - 1;
    if (ay >= 0) {
      const aIdx = ay * cols + x;
      if (!moved[aIdx] && (grid[aIdx] === WATER || grid[aIdx] === ACID)) {
        swap(idx, aIdx);
        return;
      }
    }
    flowLiquid(x, y, idx);
  }

  // 酸：像水流动，接触可腐蚀元素时双方消失（石头/金属除外）
  function updateAcid(x, y, idx) {
    const neighbors = [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]];
    for (let i = 0; i < neighbors.length; i++) {
      const nx = neighbors[i][0], ny = neighbors[i][1];
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * cols + nx;
      const n = grid[nIdx];
      if (n !== EMPTY && n !== STONE && n !== METAL && n !== ACID) {
        // 一定概率腐蚀，避免酸瞬间消失，能边流动边腐蚀
        if (Math.random() < ACID_CORRODE_CHANCE) {
          grid[nIdx] = EMPTY; auxGrid[nIdx] = 0; moved[nIdx] = 1;
          grid[idx]  = EMPTY; auxGrid[idx]  = 0; moved[idx]  = 1;
          return;
        }
      }
    }
    flowLiquid(x, y, idx);
  }

  // 火：寿命有限，向上移动，点燃相邻植物/油，遇水熄灭
  function updateFire(x, y, idx) {
    auxGrid[idx] -= 1;
    if (auxGrid[idx] <= 0) {
      grid[idx] = EMPTY; auxGrid[idx] = 0; moved[idx] = 1;
      return;
    }
    const neighbors = [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]];
    for (let i = 0; i < neighbors.length; i++) {
      const nx = neighbors[i][0], ny = neighbors[i][1];
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * cols + nx;
      const n = grid[nIdx];
      if (n === PLANT || n === OIL) {
        // 点燃：植物/油变成火，重置寿命
        grid[nIdx] = FIRE; auxGrid[nIdx] = FIRE_LIFETIME; moved[nIdx] = 1;
      } else if (n === WATER) {
        // 水灭火：火消失（水保留）
        grid[idx] = EMPTY; auxGrid[idx] = 0; moved[idx] = 1;
        return;
      }
    }
    // 向上移动（正上、上左/上右）
    const ay = y - 1;
    if (ay < 0) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (tryRise(x, ay, idx)) return;
    if (tryRise(x + dir, ay, idx)) return;
    if (tryRise(x - dir, ay, idx)) return;
  }

  function tryRise(tx, ty, fromIdx) {
    if (!inBounds(tx, ty)) return false;
    const toIdx = ty * cols + tx;
    if (moved[toIdx] || grid[toIdx] !== EMPTY) return false;
    moveTo(fromIdx, toIdx);
    return true;
  }

  // 植物：静止，旁边有水时随机向空格生长
  function updatePlant(x, y, idx) {
    let hasWater = false;
    const empties = [];
    const neighbors = [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]];
    for (let i = 0; i < neighbors.length; i++) {
      const nx = neighbors[i][0], ny = neighbors[i][1];
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * cols + nx;
      const n = grid[nIdx];
      if (n === WATER) hasWater = true;
      else if (n === EMPTY) empties.push(nIdx);
    }
    if (hasWater && empties.length > 0 && Math.random() < PLANT_GROW_CHANCE) {
      const spot = empties[Math.floor(Math.random() * empties.length)];
      grid[spot] = PLANT; auxGrid[spot] = 0; moved[spot] = 1;
    }
  }

  // 单格更新分发
  function updateCell(x, y, idx, cell) {
    switch (cell) {
      case SAND:  updateSand(x, y, idx); break;
      case WATER: updateWater(x, y, idx); break;
      case OIL:   updateOil(x, y, idx); break;
      case ACID:  updateAcid(x, y, idx); break;
      case FIRE:  updateFire(x, y, idx); break;
      case PLANT: updatePlant(x, y, idx); break;
      // STONE / METAL 静止不动
    }
  }

  // ============================================================
  // 模拟一步 / Simulation Step
  // ============================================================
  function step() {
    moved.fill(0);
    // 从底向上扫描：先处理下层，避免上层元素"穿透"下层
    for (let y = rows - 1; y >= 0; y--) {
      // 每行随机左右方向，避免整体偏向一侧
      const ltr = Math.random() < 0.5;
      for (let i = 0; i < cols; i++) {
        const x = ltr ? i : (cols - 1 - i);
        const idx = y * cols + x;
        if (moved[idx]) continue;       // 本帧已处理，跳过
        const cell = grid[idx];
        if (cell === EMPTY) continue;
        updateCell(x, y, idx, cell);
      }
    }
  }

  // ============================================================
  // 渲染 / Render
  // ============================================================
  function render() {
    if (!imageData) return;
    const data = imageData.data;
    const w = canvas.width;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const cell = grid[idx];
        let r, g, b;
        if (cell === FIRE) {
          // 火焰闪烁效果：在橙红色范围内随机扰动
          const f = Math.random();
          r = 255;
          g = 69 + Math.floor(f * 120);
          b = Math.floor(f * 30);
        } else {
          const rgb = COLOR_RGB[cell];
          r = rgb[0]; g = rgb[1]; b = rgb[2];
        }
        // 填充 CELL_SIZE × CELL_SIZE 像素块
        const bx = x * CELL_SIZE;
        const by = y * CELL_SIZE;
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          const py = by + dy;
          for (let dx = 0; dx < CELL_SIZE; dx++) {
            const pidx = (py * w + bx + dx) * 4;
            data[pidx]     = r;
            data[pidx + 1] = g;
            data[pidx + 2] = b;
            data[pidx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // ============================================================
  // 笔刷绘制 / Brush Painting
  // ============================================================

  // 在 (gx,gy) 处用圆形笔刷绘制当前元素
  function paint(gx, gy) {
    const r = brushSize;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = gx + dx, py = gy + dy;
        if (!inBounds(px, py)) continue;
        const idx = py * cols + px;
        grid[idx] = currentElement;
        auxGrid[idx] = (currentElement === FIRE) ? FIRE_LIFETIME : 0;
      }
    }
  }

  // 沿两点连线绘制（Bresenham），避免快速拖动出现断点
  function paintLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;
    while (true) {
      paint(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }
    }
  }

  // ============================================================
  // 输入事件 / Input Events
  // ============================================================

  // 屏幕坐标 -> 网格坐标
  function getGridPos(e) {
    const rect = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.clientX !== undefined) {
      cx = e.clientX; cy = e.clientY;
    } else if (e.touches && e.touches[0]) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      return { x: -1, y: -1 };
    }
    const rx = (cx - rect.left) / rect.width;
    const ry = (cy - rect.top) / rect.height;
    return {
      x: Math.floor(rx * cols),
      y: Math.floor(ry * rows)
    };
  }

  function onDown(e) {
    if (e.preventDefault) e.preventDefault();
    isDrawing = true;
    const p = getGridPos(e);
    if (p.x < 0) return;
    paint(p.x, p.y);
    lastX = p.x; lastY = p.y;
    render();
  }

  function onMove(e) {
    if (!isDrawing) return;
    if (e.preventDefault) e.preventDefault();
    const p = getGridPos(e);
    if (p.x < 0) return;
    paintLine(lastX, lastY, p.x, p.y);
    lastX = p.x; lastY = p.y;
    render();
  }

  function onUp() {
    isDrawing = false;
  }

  function attachEvents() {
    // pointer 事件统一覆盖鼠标 / 触摸 / 触控笔
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.style.touchAction = 'none'; // 防止触摸时页面滚动
  }

  // ============================================================
  // 网格构建 / Grid Building
  // ============================================================
  function buildGrid(c, r) {
    cols = c; rows = r;
    canvas.width  = cols * CELL_SIZE;
    canvas.height = rows * CELL_SIZE;
    ctx.imageSmoothingEnabled = false;
    grid    = new Uint8Array(cols * rows);
    auxGrid = new Uint8Array(cols * rows);
    moved   = new Uint8Array(cols * rows);
    imageData = ctx.createImageData(canvas.width, canvas.height);
  }

  // ============================================================
  // 主循环 / Main Loop
  // ============================================================
  function loop() {
    if (!running) return;
    step();
    render();
    rafId = requestAnimationFrame(loop);
  }

  // ============================================================
  // 公共 API / Public API
  // ============================================================

  // 初始化：参数可传 canvas 元素或 id，省略则查找 id 'physics-sandbox-canvas'
  function init(canvasOrId) {
    if (typeof canvasOrId === 'string') {
      canvas = document.getElementById(canvasOrId);
    } else if (canvasOrId && canvasOrId.nodeType === 1) {
      canvas = canvasOrId;
    } else {
      canvas = document.getElementById('physics-sandbox-canvas');
    }
    if (!canvas || canvas.tagName.toLowerCase() !== 'canvas') return false;
    ctx = canvas.getContext('2d');
    buildGrid(cols, rows);
    attachEvents();
    render();
    return true;
  }

  // 选择当前绘制元素
  function setElement(id) {
    currentElement = id | 0;
  }

  // 设置笔刷大小（1-10）
  function setBrushSize(n) {
    brushSize = Math.max(1, Math.min(10, n | 0));
  }

  // 开始模拟
  function start() {
    if (running || !grid) return;
    running = true;
    loop();
  }

  // 停止模拟
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // 清空画布
  function clear() {
    if (!grid) return;
    grid.fill(0);
    auxGrid.fill(0);
    moved.fill(0);
    render();
  }

  // 重设网格尺寸（单位：格；会清空内容）
  function resize(c, r) {
    if (!canvas || !ctx) return;
    const newC = (c && c > 0) ? (c | 0) : cols;
    const newR = (r && r > 0) ? (r | 0) : rows;
    buildGrid(newC, newR);
    render();
  }

  // 元素列表（供 UI 构建调色板：{id, name, color}）
  const ELEMENTS = [SAND, WATER, STONE, FIRE, PLANT, METAL, OIL, ACID, EMPTY].map(function (id) {
    return { id: id, name: ELEMENT_NAMES[id], color: HEX_COLORS[id] };
  });

  return {
    init,
    setElement,
    setBrushSize,
    start,
    stop,
    clear,
    resize,
    // 附带常量，方便外部引用元素 id
    ELEMENTS,
    EMPTY, SAND, WATER, STONE, FIRE, PLANT, METAL, OIL, ACID
  };
})();
