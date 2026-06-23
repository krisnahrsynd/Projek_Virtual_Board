const socket = io();

const params = new URLSearchParams(window.location.search);

const roomId = params.get("room") || "default";
const username = params.get("user") || "User";
const role = params.get("role") || "student";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const splitBtn = document.getElementById("splitBtn");
const clearBtn = document.getElementById("clearBtn");
const backBtn = document.getElementById("backBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const lockBtn = document.getElementById("lockBtn");
const exportBtn = document.getElementById("exportBtn");

const toolbarToggleBtn = document.getElementById("toolbarToggleBtn");
const floatingToolbar = document.getElementById("floatingToolbar");

const sidePanel = document.getElementById("sidePanel");
const sidePanelToggleBtn = document.getElementById("sidePanelToggleBtn");
const sidePanelCloseBtn = document.getElementById("sidePanelCloseBtn");

const panTool = document.getElementById("panTool");
const selectTool = document.getElementById("selectTool");
const penTool = document.getElementById("penTool");
const eraserTool = document.getElementById("eraserTool");
const textTool = document.getElementById("textTool");
const imageTool = document.getElementById("imageTool");
const imageInput = document.getElementById("imageInput");

const materialTool = document.getElementById("materialTool");
const materialInput = document.getElementById("materialInput");
const materialUploadBtn = document.getElementById("materialUploadBtn");
const materialList = document.getElementById("materialList");
const materialLayer = document.getElementById("materialLayer");
const materialStage = document.getElementById("materialStage");
const materialFrame = document.getElementById("materialFrame");
const materialFallback = document.getElementById("materialFallback");
const materialFallbackText = document.getElementById("materialFallbackText");
const materialOpenLink = document.getElementById("materialOpenLink");
const materialBadge = document.getElementById("materialBadge");
const materialName = document.getElementById("materialName");
const materialOpenBtn = document.getElementById("materialOpenBtn");
const materialHideBtn = document.getElementById("materialHideBtn");

const shapeMenuBtn = document.getElementById("shapeMenuBtn");
const shapeMenu = document.getElementById("shapeMenu");
const lineTool = document.getElementById("lineTool");
const rectTool = document.getElementById("rectTool");
const circleTool = document.getElementById("circleTool");

const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const fitViewBtn = document.getElementById("fitViewBtn");
const zoomLabel = document.getElementById("zoomLabel");

const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeLabel = document.getElementById("sizeLabel");
const statusText = document.getElementById("statusText");

const roomLabel = document.getElementById("roomLabel");
const userLabel = document.getElementById("userLabel");
const roleLabel = document.getElementById("roleLabel");
const userList = document.getElementById("userList");

roomLabel.textContent = roomId;
userLabel.textContent = username;
roleLabel.textContent = role === "teacher" ? "Guru" : "Siswa";

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;

const DEFAULT_TEACHER_COLOR = "#111827";
const DEFAULT_STUDENT_COLOR = "#2563eb";

const CURSOR_INTERVAL = 35;
const STROKE_PROGRESS_INTERVAL = 18;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.15;
const PAN_MARGIN = 90;

const SHAPE_TOOLS = ["line", "rect", "circle"];

let baseScale = 1;
let zoom = 1;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let panX = 0;
let panY = 0;

let isPanning = false;
let panPointerId = null;
let lastPanScreen = null;

let strokes = [];
let splitMode = false;
let locked = false;

let materials = [];
let currentMaterial = null;
let materialVisible = true;

let tool = "pen";
let previousToolBeforeSpace = null;

let color = role === "teacher" ? DEFAULT_TEACHER_COLOR : DEFAULT_STUDENT_COLOR;
let size = role === "teacher" ? 4 : 3;

let redrawPending = false;
let lastCursorEmit = 0;
let lastStrokeProgressEmit = 0;

let selectedStrokeId = null;
let draggingSelection = null;

const activePointers = {};
const activeStrokes = {};
const activeShapes = {};
const activeErasers = {};
const activeRemoteStrokes = {};
const remoteCursors = {};
const imageCache = {};

colorPicker.value = color;
sizeSlider.value = size;
sizeLabel.textContent = size;

function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTypingTarget() {
  const active = document.activeElement;
  if (!active) return false;

  const tag = active.tagName;

  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function setStatus(text) {
  statusText.textContent = text;
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function getCenteredOffsetX() {
  return (canvas.width - VIRTUAL_WIDTH * scale) / 2;
}

function getCenteredOffsetY() {
  return (canvas.height - VIRTUAL_HEIGHT * scale) / 2;
}

function clampPan() {
  const boardW = VIRTUAL_WIDTH * scale;
  const boardH = VIRTUAL_HEIGHT * scale;

  const centeredX = getCenteredOffsetX();
  const centeredY = getCenteredOffsetY();

  let currentOffsetX = centeredX + panX;
  let currentOffsetY = centeredY + panY;

  const minOffsetX = Math.min(canvas.width - PAN_MARGIN - boardW, PAN_MARGIN);
  const maxOffsetX = Math.max(canvas.width - PAN_MARGIN - boardW, PAN_MARGIN);

  const minOffsetY = Math.min(canvas.height - PAN_MARGIN - boardH, PAN_MARGIN);
  const maxOffsetY = Math.max(canvas.height - PAN_MARGIN - boardH, PAN_MARGIN);

  if (currentOffsetX < minOffsetX) {
    panX += minOffsetX - currentOffsetX;
  }

  if (currentOffsetX > maxOffsetX) {
    panX += maxOffsetX - currentOffsetX;
  }

  currentOffsetY = centeredY + panY;

  if (currentOffsetY < minOffsetY) {
    panY += minOffsetY - currentOffsetY;
  }

  if (currentOffsetY > maxOffsetY) {
    panY += maxOffsetY - currentOffsetY;
  }
}

function updateCamera() {
  zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  scale = baseScale * zoom;

  clampPan();

  offsetX = getCenteredOffsetX() + panX;
  offsetY = getCenteredOffsetY() + panY;

  updateZoomLabel();
  positionMaterialLayer();
}

function fitView() {
  zoom = 1;
  panX = 0;
  panY = 0;

  updateCamera();
  requestRedraw();

  setStatus("View disesuaikan ke layar.");
}

function getScreenPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function screenToVirtual(screenX, screenY) {
  return {
    x: (screenX - offsetX) / scale,
    y: (screenY - offsetY) / scale
  };
}

function getVisibleCenterVirtual() {
  const center = screenToVirtual(canvas.width / 2, canvas.height / 2);

  return {
    x: clamp(center.x, 0, VIRTUAL_WIDTH),
    y: clamp(center.y, 0, VIRTUAL_HEIGHT)
  };
}

function zoomAtScreenPoint(factor, screenX, screenY) {
  const before = screenToVirtual(screenX, screenY);

  zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
  scale = baseScale * zoom;

  const centeredX = getCenteredOffsetX();
  const centeredY = getCenteredOffsetY();

  panX = screenX - centeredX - before.x * scale;
  panY = screenY - centeredY - before.y * scale;

  updateCamera();
  requestRedraw();
}

function zoomAtCenter(factor) {
  zoomAtScreenPoint(factor, canvas.width / 2, canvas.height / 2);
}

function startPan(pointerId, event) {
  isPanning = true;
  panPointerId = pointerId;
  lastPanScreen = getScreenPosition(event);

  setStatus("Geser board dengan drag.");
}

function updatePan(event) {
  if (!isPanning || panPointerId !== event.pointerId || !lastPanScreen) return;

  const screen = getScreenPosition(event);

  panX += screen.x - lastPanScreen.x;
  panY += screen.y - lastPanScreen.y;

  lastPanScreen = screen;

  updateCamera();
  requestRedraw();
}

function finishPan(pointerId) {
  if (!isPanning || panPointerId !== pointerId) return false;

  isPanning = false;
  panPointerId = null;
  lastPanScreen = null;

  updateToolUI();

  return true;
}

function emitStrokeProgress(stroke, force = false) {
  if (!stroke) return;

  const now = Date.now();

  if (!force && now - lastStrokeProgressEmit < STROKE_PROGRESS_INTERVAL) {
    return;
  }

  lastStrokeProgressEmit = now;

  socket.emit("stroke-progress", stroke);
}

function emitStrokeCancel(stroke) {
  if (!stroke) return;

  socket.emit("stroke-cancel", {
    roomId,
    id: stroke.id
  });
}

function closeShapeMenu() {
  shapeMenu.classList.remove("open");
}

function toggleShapeMenu() {
  shapeMenu.classList.toggle("open");
}

function setTool(nextTool) {
  tool = nextTool;

  if (!SHAPE_TOOLS.includes(nextTool)) {
    closeShapeMenu();
  }

  updateToolUI();
}

function updateToolUI() {
  const buttons = [
    [panTool, "pan"],
    [selectTool, "select"],
    [penTool, "pen"],
    [eraserTool, "eraser"],
    [textTool, "text"],
    [imageTool, "image"],
    [materialTool, "material"],
    [lineTool, "line"],
    [rectTool, "rect"],
    [circleTool, "circle"]
  ];

  buttons.forEach(([button, value]) => {
    button.classList.toggle("active", tool === value);
  });

  shapeMenuBtn.classList.toggle("active", SHAPE_TOOLS.includes(tool));

  const shapeLabels = {
    line: "Line",
    rect: "Rectangle",
    circle: "Circle"
  };

  shapeMenuBtn.textContent = SHAPE_TOOLS.includes(tool)
    ? shapeLabels[tool]
    : "Shape";

  canvas.classList.toggle("pan-cursor", tool === "pan");
  canvas.classList.toggle("select-cursor", tool === "select");
  canvas.classList.toggle("eraser-cursor", tool === "eraser");
  canvas.classList.toggle("text-cursor", tool === "text");
  canvas.classList.toggle("image-cursor", tool === "image");
  canvas.classList.toggle("material-cursor", tool === "material");

  const label = {
    pan: "Mode: Pan",
    select: "Mode: Select",
    pen: "Mode: Pen",
    eraser: "Mode: Eraser",
    text: "Mode: Text",
    image: "Mode: Image",
    material: "Mode: Material",
    line: "Mode: Line",
    rect: "Mode: Rectangle",
    circle: "Mode: Circle"
  };

  setStatus(label[tool] || "Ready");
}

function updateTeacherControls() {
  const teacher = role === "teacher";

  clearBtn.disabled = !teacher;
  splitBtn.disabled = !teacher;
  lockBtn.disabled = !teacher;

  clearBtn.title = teacher ? "" : "Hanya guru yang dapat clear board.";
  splitBtn.title = teacher ? "" : "Hanya guru yang dapat split board.";
  lockBtn.title = teacher ? "" : "Hanya guru yang dapat lock board.";
}

function updateLockUI() {
  lockBtn.textContent = locked ? "Unlock Board" : "Lock Board";

  if (locked && role !== "teacher" && tool !== "pan") {
    setStatus("Board dikunci oleh guru.");
  } else if (!locked) {
    updateToolUI();
  }
}

function updateSplitUI() {
  splitBtn.textContent = splitMode ? "Unsplit Board" : "Split Board";
}

function resizeCanvas() {
  const boardArea = document.querySelector(".board-area");

  canvas.width = boardArea.clientWidth;
  canvas.height = boardArea.clientHeight;

  const scaleX = canvas.width / VIRTUAL_WIDTH;
  const scaleY = canvas.height / VIRTUAL_HEIGHT;

  baseScale = Math.min(scaleX, scaleY);

  updateCamera();
  requestRedraw();
}

function hasVisibleMaterial() {
  return Boolean(currentMaterial && materialVisible);
}

function clearScreenOnly(
  renderCtx = ctx,
  s = scale,
  ox = offsetX,
  oy = offsetY,
  includeOutside = true
) {
  renderCtx.clearRect(0, 0, canvas.width, canvas.height);

  const boardX = ox;
  const boardY = oy;
  const boardW = VIRTUAL_WIDTH * s;
  const boardH = VIRTUAL_HEIGHT * s;

  const isMainCanvas = renderCtx === ctx;
  const materialIsShowing = isMainCanvas && hasVisibleMaterial();

  if (includeOutside) {
    renderCtx.fillStyle = "#e5e7eb";

    if (materialIsShowing) {
      renderCtx.fillRect(0, 0, canvas.width, Math.max(0, boardY));
      renderCtx.fillRect(
        0,
        boardY + boardH,
        canvas.width,
        Math.max(0, canvas.height - (boardY + boardH))
      );
      renderCtx.fillRect(0, boardY, Math.max(0, boardX), boardH);
      renderCtx.fillRect(
        boardX + boardW,
        boardY,
        Math.max(0, canvas.width - (boardX + boardW)),
        boardH
      );
    } else {
      renderCtx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  if (!materialIsShowing) {
    renderCtx.fillStyle = "#ffffff";
    renderCtx.fillRect(boardX, boardY, boardW, boardH);
  }

  renderCtx.strokeStyle = "#111827";
  renderCtx.lineWidth = Math.max(1, 2 * s);
  renderCtx.strokeRect(boardX, boardY, boardW, boardH);
}

function drawSplitLine(renderCtx = ctx, s = scale, ox = offsetX, oy = offsetY) {
  if (!splitMode) return;

  renderCtx.save();
  renderCtx.beginPath();
  renderCtx.moveTo(ox + (VIRTUAL_WIDTH / 2) * s, oy);
  renderCtx.lineTo(
    ox + (VIRTUAL_WIDTH / 2) * s,
    oy + VIRTUAL_HEIGHT * s
  );
  renderCtx.strokeStyle = "#ef4444";
  renderCtx.lineWidth = Math.max(1, 2 * s);
  renderCtx.setLineDash([10 * s, 10 * s]);
  renderCtx.stroke();
  renderCtx.restore();
}

function drawLockedOverlay() {
  if (!locked) return;

  ctx.save();

  ctx.fillStyle = "rgba(17, 24, 39, 0.08)";
  ctx.fillRect(
    offsetX,
    offsetY,
    VIRTUAL_WIDTH * scale,
    VIRTUAL_HEIGHT * scale
  );

  ctx.fillStyle = "#111827";
  ctx.font = `${18 * scale}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText(
    "BOARD LOCKED",
    offsetX + (VIRTUAL_WIDTH * scale) / 2,
    offsetY + 34 * scale
  );

  ctx.restore();
}

function toVirtualPosition(event) {
  const screen = getScreenPosition(event);

  return {
    x: (screen.x - offsetX) / scale,
    y: (screen.y - offsetY) / scale
  };
}

function isInsideBoard(x, y) {
  return x >= 0 && x <= VIRTUAL_WIDTH && y >= 0 && y <= VIRTUAL_HEIGHT;
}

function getStrokeColor(stroke) {
  return stroke.color || (stroke.role === "teacher" ? DEFAULT_TEACHER_COLOR : DEFAULT_STUDENT_COLOR);
}

function getCachedImage(src) {
  if (!src) return null;

  if (imageCache[src] && imageCache[src].loaded) {
    return imageCache[src].image;
  }

  if (!imageCache[src]) {
    const image = new Image();

    imageCache[src] = {
      image,
      loaded: false,
      error: false
    };

    image.onload = () => {
      imageCache[src].loaded = true;
      requestRedraw();
    };

    image.onerror = () => {
      imageCache[src].error = true;
      requestRedraw();
    };

    image.src = src;
  }

  return null;
}

function drawFreehandStroke(renderCtx, stroke, s, ox, oy) {
  const pts = stroke.points;

  if (!pts || pts.length === 0) return;

  const strokeColor = getStrokeColor(stroke);
  const strokeSize = Math.max(1, (stroke.size || 3) * s);

  renderCtx.save();

  renderCtx.strokeStyle = strokeColor;
  renderCtx.fillStyle = strokeColor;
  renderCtx.lineWidth = strokeSize;
  renderCtx.lineCap = "round";
  renderCtx.lineJoin = "round";

  if (pts.length === 1) {
    renderCtx.beginPath();
    renderCtx.arc(
      ox + pts[0].x * s,
      oy + pts[0].y * s,
      strokeSize / 2,
      0,
      Math.PI * 2
    );
    renderCtx.fill();
    renderCtx.restore();
    return;
  }

  renderCtx.beginPath();

  renderCtx.moveTo(
    ox + pts[0].x * s,
    oy + pts[0].y * s
  );

  if (pts.length === 2) {
    renderCtx.lineTo(
      ox + pts[1].x * s,
      oy + pts[1].y * s
    );
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const current = pts[i];
      const next = pts[i + 1];

      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;

      renderCtx.quadraticCurveTo(
        ox + current.x * s,
        oy + current.y * s,
        ox + midX * s,
        oy + midY * s
      );
    }

    const last = pts[pts.length - 1];

    renderCtx.lineTo(
      ox + last.x * s,
      oy + last.y * s
    );
  }

  renderCtx.stroke();
  renderCtx.restore();
}

function drawShapeStroke(renderCtx, stroke, s, ox, oy) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return;

  const a = pts[0];
  const b = pts[1];

  renderCtx.save();

  renderCtx.strokeStyle = getStrokeColor(stroke);
  renderCtx.lineWidth = Math.max(1, (stroke.size || 3) * s);
  renderCtx.lineCap = "round";
  renderCtx.lineJoin = "round";

  renderCtx.beginPath();

  if (stroke.shape === "line") {
    renderCtx.moveTo(ox + a.x * s, oy + a.y * s);
    renderCtx.lineTo(ox + b.x * s, oy + b.y * s);
  }

  if (stroke.shape === "rect") {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);

    renderCtx.rect(ox + x * s, oy + y * s, w * s, h * s);
  }

  if (stroke.shape === "circle") {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;

    renderCtx.ellipse(
      ox + cx * s,
      oy + cy * s,
      rx * s,
      ry * s,
      0,
      0,
      Math.PI * 2
    );
  }

  renderCtx.stroke();
  renderCtx.restore();
}

function drawTextStroke(renderCtx, stroke, s, ox, oy) {
  const pts = stroke.points;
  if (!pts || pts.length < 1) return;

  const text = String(stroke.text || "");
  if (!text.trim()) return;

  const p = pts[0];
  const fontSize = stroke.fontSize || 28;

  renderCtx.save();
  renderCtx.fillStyle = getStrokeColor(stroke);
  renderCtx.font = `${fontSize * s}px Arial`;
  renderCtx.textBaseline = "top";

  const lines = text.split("\n").slice(0, 8);
  const lineHeight = fontSize * 1.25;

  lines.forEach((line, index) => {
    renderCtx.fillText(
      line,
      ox + p.x * s,
      oy + (p.y + index * lineHeight) * s
    );
  });

  renderCtx.restore();
}

function drawImageStroke(renderCtx, stroke, s, ox, oy) {
  const pts = stroke.points;
  if (!pts || pts.length < 1) return;

  const p = pts[0];
  const width = stroke.width || 240;
  const height = stroke.height || 160;

  const x = ox + p.x * s;
  const y = oy + p.y * s;
  const w = width * s;
  const h = height * s;

  const image = getCachedImage(stroke.src);

  renderCtx.save();

  if (image) {
    renderCtx.drawImage(image, x, y, w, h);
  } else {
    renderCtx.fillStyle = "#f3f4f6";
    renderCtx.fillRect(x, y, w, h);

    renderCtx.strokeStyle = "#9ca3af";
    renderCtx.lineWidth = Math.max(1, 2 * s);
    renderCtx.strokeRect(x, y, w, h);

    renderCtx.fillStyle = "#374151";
    renderCtx.font = `${14 * s}px Arial`;
    renderCtx.fillText("Loading image...", x + 12 * s, y + 20 * s);
  }

  renderCtx.restore();
}

function drawStrokeOn(renderCtx, stroke, s = scale, ox = offsetX, oy = offsetY) {
  if (stroke.type === "shape") {
    drawShapeStroke(renderCtx, stroke, s, ox, oy);
    return;
  }

  if (stroke.type === "text") {
    drawTextStroke(renderCtx, stroke, s, ox, oy);
    return;
  }

  if (stroke.type === "image") {
    drawImageStroke(renderCtx, stroke, s, ox, oy);
    return;
  }

  drawFreehandStroke(renderCtx, stroke, s, ox, oy);
}

function drawRemoteCursors() {
  Object.values(remoteCursors).forEach((cursor) => {
    ctx.save();

    const x = offsetX + cursor.x * scale;
    const y = offsetY + cursor.y * scale;

    const cursorColor = cursor.role === "teacher" ? "#111827" : "#2563eb";

    ctx.fillStyle = cursorColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 16, y + 6);
    ctx.lineTo(x + 7, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "12px Arial";
    ctx.fillStyle = cursorColor;

    const label = `${cursor.username} (${cursor.role === "teacher" ? "Guru" : "Siswa"})`;
    const labelWidth = ctx.measureText(label).width + 12;

    ctx.fillRect(x + 12, y + 14, labelWidth, 22);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 18, y + 29);

    ctx.restore();
  });
}

function redrawAll() {
  clearScreenOnly();

  strokes.forEach((stroke) => drawStrokeOn(ctx, stroke));
  Object.values(activeRemoteStrokes).forEach((stroke) => drawStrokeOn(ctx, stroke));
  Object.values(activeStrokes).forEach((stroke) => drawStrokeOn(ctx, stroke));
  Object.values(activeShapes).forEach((stroke) => drawStrokeOn(ctx, stroke));

  drawSelectionBox();
  drawSplitLine();
  drawLockedOverlay();
  drawRemoteCursors();
}

function requestRedraw() {
  if (redrawPending) return;

  redrawPending = true;

  requestAnimationFrame(() => {
    redrawAll();
    redrawPending = false;
  });
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0 && dy === 0) {
    return distance(point, a);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)
    )
  );

  const projected = {
    x: a.x + t * dx,
    y: a.y + t * dy
  };

  return distance(point, projected);
}

function getShapeSegments(stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return [];

  const a = pts[0];
  const b = pts[1];

  if (stroke.shape === "line") {
    return [[a, b]];
  }

  if (stroke.shape === "rect") {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);

    const p1 = { x: x1, y: y1 };
    const p2 = { x: x2, y: y1 };
    const p3 = { x: x2, y: y2 };
    const p4 = { x: x1, y: y2 };

    return [
      [p1, p2],
      [p2, p3],
      [p3, p4],
      [p4, p1]
    ];
  }

  if (stroke.shape === "circle") {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;

    const segments = [];
    const steps = 48;

    for (let i = 0; i < steps; i++) {
      const t1 = (i / steps) * Math.PI * 2;
      const t2 = ((i + 1) / steps) * Math.PI * 2;

      segments.push([
        {
          x: cx + Math.cos(t1) * rx,
          y: cy + Math.sin(t1) * ry
        },
        {
          x: cx + Math.cos(t2) * rx,
          y: cy + Math.sin(t2) * ry
        }
      ]);
    }

    return segments;
  }

  return [];
}

function getVirtualTextBox(stroke) {
  const p = stroke.points && stroke.points[0];
  if (!p) return null;

  const text = String(stroke.text || "");
  const fontSize = stroke.fontSize || 28;
  const lines = text.split("\n").slice(0, 8);

  const maxLength = Math.max(...lines.map((line) => line.length), 1);
  const width = maxLength * fontSize * 0.62;
  const height = lines.length * fontSize * 1.25;

  return {
    x: p.x,
    y: p.y,
    width,
    height
  };
}

function getSelectedStroke() {
  return strokes.find((stroke) => stroke.id === selectedStrokeId) || null;
}

function getStrokeBounds(stroke) {
  if (!stroke) return null;

  if (stroke.type === "text") {
    const box = getVirtualTextBox(stroke);
    if (!box) return null;

    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    };
  }

  if (stroke.type === "image") {
    const p = stroke.points && stroke.points[0];
    if (!p) return null;

    return {
      x: p.x,
      y: p.y,
      width: stroke.width || 240,
      height: stroke.height || 160
    };
  }

  const pts = stroke.points || [];

  if (pts.length === 0) return null;

  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;

  pts.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  const padding = Math.max(6, (stroke.size || 3) * 2);

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2
  };
}

function drawSelectionBox() {
  const stroke = getSelectedStroke();
  const bounds = getStrokeBounds(stroke);

  if (!bounds) return;

  const x = offsetX + bounds.x * scale;
  const y = offsetY + bounds.y * scale;
  const w = bounds.width * scale;
  const h = bounds.height * scale;

  ctx.save();

  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x, y, w, h);

  ctx.setLineDash([]);
  ctx.fillStyle = "#10b981";

  const handleSize = 8;

  const handles = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h]
  ];

  handles.forEach(([hx, hy]) => {
    ctx.fillRect(
      hx - handleSize / 2,
      hy - handleSize / 2,
      handleSize,
      handleSize
    );
  });

  ctx.restore();
}

function canEraseLocal(stroke) {
  return role === "teacher" || stroke.username === username;
}

function strokeHitTest(stroke, point, radius) {
  if (stroke.type === "image") {
    const bounds = getStrokeBounds(stroke);
    if (!bounds) return false;

    return (
      point.x >= bounds.x - radius &&
      point.x <= bounds.x + bounds.width + radius &&
      point.y >= bounds.y - radius &&
      point.y <= bounds.y + bounds.height + radius
    );
  }

  if (stroke.type === "text") {
    const box = getVirtualTextBox(stroke);
    if (!box) return false;

    return (
      point.x >= box.x - radius &&
      point.x <= box.x + box.width + radius &&
      point.y >= box.y - radius &&
      point.y <= box.y + box.height + radius
    );
  }

  if (stroke.type === "shape") {
    const threshold = radius + (stroke.size || 3) / 2;
    const segments = getShapeSegments(stroke);

    return segments.some(([a, b]) => {
      return distancePointToSegment(point, a, b) <= threshold;
    });
  }

  const pts = stroke.points || [];

  if (pts.length === 0) return false;

  const threshold = radius + (stroke.size || 3) / 2;

  if (pts.length === 1) {
    return distance(point, pts[0]) <= threshold;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const d = distancePointToSegment(point, pts[i], pts[i + 1]);

    if (d <= threshold) {
      return true;
    }
  }

  return false;
}

function findSelectableStrokeAt(pos) {
  const radius = Math.max(8, Number(sizeSlider.value) * 2);

  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];

    if (!canEraseLocal(stroke)) continue;

    if (strokeHitTest(stroke, pos, radius)) {
      return stroke;
    }
  }

  return null;
}

function moveStrokeBy(stroke, dx, dy) {
  if (!stroke || !Array.isArray(stroke.points)) return;

  stroke.points = stroke.points.map((point) => ({
    x: point.x + dx,
    y: point.y + dy
  }));
}

function clampStrokeInsideBoard(stroke) {
  const bounds = getStrokeBounds(stroke);

  if (!bounds) return;

  let dx = 0;
  let dy = 0;

  if (bounds.x < 0) dx = -bounds.x;
  if (bounds.y < 0) dy = -bounds.y;

  if (bounds.x + bounds.width > VIRTUAL_WIDTH) {
    dx = VIRTUAL_WIDTH - (bounds.x + bounds.width);
  }

  if (bounds.y + bounds.height > VIRTUAL_HEIGHT) {
    dy = VIRTUAL_HEIGHT - (bounds.y + bounds.height);
  }

  if (dx !== 0 || dy !== 0) {
    moveStrokeBy(stroke, dx, dy);
  }
}

function startSelectionDrag(pointerId, pos, stroke) {
  selectedStrokeId = stroke ? stroke.id : null;

  if (!stroke) {
    draggingSelection = null;
    requestRedraw();
    return;
  }

  draggingSelection = {
    pointerId,
    lastPos: pos,
    moved: false
  };

  requestRedraw();
}

function updateSelectionDrag(pointerId, pos) {
  if (!draggingSelection) return;
  if (draggingSelection.pointerId !== pointerId) return;

  const stroke = getSelectedStroke();

  if (!stroke) return;

  const dx = pos.x - draggingSelection.lastPos.x;
  const dy = pos.y - draggingSelection.lastPos.y;

  moveStrokeBy(stroke, dx, dy);
  clampStrokeInsideBoard(stroke);

  draggingSelection.lastPos = pos;
  draggingSelection.moved = true;

  requestRedraw();
}

function finishSelectionDrag(pointerId) {
  if (!draggingSelection) return false;
  if (draggingSelection.pointerId !== pointerId) return false;

  const stroke = getSelectedStroke();

  if (stroke && draggingSelection.moved) {
    socket.emit("stroke-update", stroke);
  }

  draggingSelection = null;

  requestRedraw();

  return true;
}

function eraseAt(pos) {
  const eraserRadius = Math.max(10, Number(sizeSlider.value) * 3);
  let removed = false;

  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];

    if (!canEraseLocal(stroke)) continue;

    if (strokeHitTest(stroke, pos, eraserRadius)) {
      const strokeId = stroke.id;

      strokes.splice(i, 1);

      socket.emit("erase-stroke", {
        roomId,
        strokeId
      });

      if (selectedStrokeId === strokeId) {
        selectedStrokeId = null;
      }

      removed = true;
      break;
    }
  }

  if (removed) {
    requestRedraw();
  }
}

function createTextAt(pos) {
  const text = window.prompt("Masukkan teks");

  if (!text || !text.trim()) {
    setStatus("Text dibatalkan.");
    return;
  }

  const stroke = {
    id: uid(),
    roomId,
    username,
    role,
    type: "text",
    tool: "text",
    text,
    color,
    size,
    fontSize: Math.max(16, Number(sizeSlider.value) * 5 + 14),
    points: [pos],
    createdAt: Date.now()
  };

  strokes.push(stroke);

  socket.emit("stroke-add", stroke);

  requestRedraw();
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("File yang dipilih bukan gambar."));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Gagal membaca file gambar."));
    };

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => {
        reject(new Error("Gagal memproses gambar."));
      };

      image.onload = () => {
        const maxDimension = 1400;
        const ratio = Math.min(
          1,
          maxDimension / image.naturalWidth,
          maxDimension / image.naturalHeight
        );

        const width = Math.max(1, Math.round(image.naturalWidth * ratio));
        const height = Math.max(1, Math.round(image.naturalHeight * ratio));

        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");

        tempCanvas.width = width;
        tempCanvas.height = height;

        tempCtx.fillStyle = "#ffffff";
        tempCtx.fillRect(0, 0, width, height);
        tempCtx.drawImage(image, 0, 0, width, height);

        const src = tempCanvas.toDataURL("image/jpeg", 0.82);

        resolve({
          src,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          compressedWidth: width,
          compressedHeight: height
        });
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function getImageDisplaySize(naturalWidth, naturalHeight) {
  const maxWidth = VIRTUAL_WIDTH * 0.45;
  const maxHeight = VIRTUAL_HEIGHT * 0.55;

  const ratio = Math.min(
    1,
    maxWidth / naturalWidth,
    maxHeight / naturalHeight
  );

  return {
    width: Math.max(60, naturalWidth * ratio),
    height: Math.max(40, naturalHeight * ratio)
  };
}

async function addImageFileToBoard(file) {
  try {
    setStatus("Memproses gambar...");

    const imageData = await compressImageFile(file);

    if (imageData.src.length > 6_500_000) {
      alert("Ukuran gambar masih terlalu besar. Coba pilih gambar yang lebih kecil.");
      setStatus("Gambar terlalu besar.");
      return;
    }

    const displaySize = getImageDisplaySize(
      imageData.naturalWidth,
      imageData.naturalHeight
    );

    const center = getVisibleCenterVirtual();

    const x = clamp(
      center.x - displaySize.width / 2,
      0,
      VIRTUAL_WIDTH - displaySize.width
    );

    const y = clamp(
      center.y - displaySize.height / 2,
      0,
      VIRTUAL_HEIGHT - displaySize.height
    );

    const stroke = {
      id: uid(),
      roomId,
      username,
      role,
      type: "image",
      tool: "image",
      src: imageData.src,
      width: displaySize.width,
      height: displaySize.height,
      points: [{ x, y }],
      createdAt: Date.now()
    };

    strokes.push(stroke);
    selectedStrokeId = stroke.id;

    socket.emit("stroke-add", stroke);

    setTool("select");
    requestRedraw();

    setStatus("Gambar berhasil ditambahkan.");
  } catch (error) {
    alert(error.message);
    setStatus("Gagal menambahkan gambar.");
  } finally {
    imageInput.value = "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.onload = () => resolve(reader.result);

    reader.readAsDataURL(file);
  });
}

async function uploadMaterialFile(file) {
  try {
    if (!file) return;

    const allowed =
      file.type === "application/pdf" ||
      file.type === "application/vnd.ms-powerpoint" ||
      file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      file.name.toLowerCase().endsWith(".pdf") ||
      file.name.toLowerCase().endsWith(".ppt") ||
      file.name.toLowerCase().endsWith(".pptx");

    if (!allowed) {
      alert("Hanya file PDF, PPT, atau PPTX yang bisa diupload.");
      return;
    }

    if (file.size > 18 * 1024 * 1024) {
      alert("File terlalu besar. Maksimal sekitar 18MB.");
      return;
    }

    setStatus("Mengupload materi...");

    const dataUrl = await readFileAsDataUrl(file);

    const response = await fetch("/api/materials/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        roomId,
        username,
        role,
        filename: file.name,
        dataUrl
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Gagal upload materi.");
    }

    materials = result.materials || [];
    setCurrentMaterial(result.material, true);

    sidePanel.classList.add("open");
    renderMaterialList();

    setStatus("Materi berhasil diupload.");
  } catch (error) {
    alert(error.message);
    setStatus("Gagal upload materi.");
  } finally {
    materialInput.value = "";
  }
}

function absoluteUrl(relativeUrl) {
  return new URL(relativeUrl, window.location.origin).toString();
}

function getMaterialViewerUrl(material) {
  if (!material) return "";

  const url = absoluteUrl(material.url);

  const name = String(material.filename || "").toLowerCase();
  const mime = String(material.mimeType || "").toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return material.url;
  }

  if (name.endsWith(".ppt") || name.endsWith(".pptx") || mime.includes("powerpoint")) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  }

  return material.url;
}

function setCurrentMaterial(material, visible = true) {
  currentMaterial = material || null;
  materialVisible = Boolean(material && visible);

  renderMaterialViewer();
  renderMaterialList();
  requestRedraw();
}

function renderMaterialViewer() {
  if (!currentMaterial || !materialVisible) {
    materialLayer.classList.add("hidden");
    materialBadge.classList.add("hidden");
    materialFrame.removeAttribute("src");
    materialOpenLink.href = "#";
    return;
  }

  materialLayer.classList.remove("hidden");
  materialBadge.classList.remove("hidden");

  materialName.textContent = currentMaterial.filename || "Material";
  materialOpenLink.href = currentMaterial.url;
  materialOpenBtn.dataset.url = currentMaterial.url;

  const viewerUrl = getMaterialViewerUrl(currentMaterial);

  materialFrame.src = viewerUrl;

  const lowerName = String(currentMaterial.filename || "").toLowerCase();

  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) {
    materialFallback.classList.remove("hidden");
    materialFallbackText.textContent =
      "Preview PPT/PPTX memakai Office Web Viewer. Jika belum tampil, klik Open Material.";
  } else {
    materialFallback.classList.add("hidden");
  }

  positionMaterialLayer();
}

function positionMaterialLayer() {
  if (!materialStage) return;

  materialStage.style.left = `${offsetX}px`;
  materialStage.style.top = `${offsetY}px`;
  materialStage.style.width = `${VIRTUAL_WIDTH * scale}px`;
  materialStage.style.height = `${VIRTUAL_HEIGHT * scale}px`;
}

function renderMaterialList() {
  materialList.innerHTML = "";

  if (!materials || materials.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-material";
    empty.textContent = "Belum ada materi.";
    materialList.appendChild(empty);
    return;
  }

  materials
    .slice()
    .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
    .forEach((material) => {
      const item = document.createElement("div");
      item.className = "material-item";

      if (currentMaterial && currentMaterial.id === material.id) {
        item.classList.add("active");
      }

      const info = document.createElement("div");
      info.className = "material-info";

      const title = document.createElement("strong");
      title.textContent = material.filename || "Material";

      const meta = document.createElement("span");
      meta.textContent = `${Math.max(1, Math.round((material.sizeBytes || 0) / 1024))} KB`;

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "material-actions";

      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.textContent = "Show";
      showBtn.addEventListener("click", async () => {
        const response = await fetch("/api/materials/set-current", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            roomId,
            materialId: material.id
          })
        });

        const result = await response.json();

        if (!response.ok) {
          alert(result.error || "Gagal membuka materi.");
          return;
        }

        setCurrentMaterial(result.material, true);
      });

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => {
        window.open(material.url, "_blank");
      });

      actions.appendChild(showBtn);
      actions.appendChild(openBtn);

      item.appendChild(info);
      item.appendChild(actions);

      materialList.appendChild(item);
    });
}

function startFreehandStroke(pointerId, pos) {
  activeStrokes[pointerId] = {
    id: uid(),
    roomId,
    username,
    role,
    type: "freehand",
    tool: "pen",
    color,
    size,
    points: [pos],
    createdAt: Date.now()
  };

  emitStrokeProgress(activeStrokes[pointerId], true);
}

function addFreehandPoint(pointerId, pos) {
  const stroke = activeStrokes[pointerId];

  if (!stroke) return;

  const lastPoint = stroke.points[stroke.points.length - 1];

  if (distance(lastPoint, pos) < 0.7) return;

  stroke.points.push(pos);
}

function finishFreehandStroke(pointerId) {
  const stroke = activeStrokes[pointerId];

  if (!stroke) return;

  delete activeStrokes[pointerId];

  if (stroke.points.length < 2) {
    emitStrokeCancel(stroke);
    requestRedraw();
    return;
  }

  strokes.push(stroke);

  socket.emit("stroke-add", stroke);

  requestRedraw();
}

function startShape(pointerId, pos, shape) {
  activeShapes[pointerId] = {
    id: uid(),
    roomId,
    username,
    role,
    type: "shape",
    tool: shape,
    shape,
    color,
    size,
    points: [pos, pos],
    createdAt: Date.now()
  };

  emitStrokeProgress(activeShapes[pointerId], true);
}

function updateShape(pointerId, pos) {
  const shapeStroke = activeShapes[pointerId];

  if (!shapeStroke) return;

  shapeStroke.points[1] = pos;
}

function finishShape(pointerId) {
  const shapeStroke = activeShapes[pointerId];

  if (!shapeStroke) return;

  delete activeShapes[pointerId];

  const a = shapeStroke.points[0];
  const b = shapeStroke.points[1];

  if (distance(a, b) < 3) {
    emitStrokeCancel(shapeStroke);
    requestRedraw();
    return;
  }

  strokes.push(shapeStroke);

  socket.emit("stroke-add", shapeStroke);

  requestRedraw();
}

function emitCursor(pos) {
  const now = Date.now();

  if (now - lastCursorEmit < CURSOR_INTERVAL) return;

  lastCursorEmit = now;

  socket.emit("cursor-move", {
    x: pos.x,
    y: pos.y
  });
}

function stopPointer(event) {
  const pointerId = event.pointerId;

  try {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  } catch (error) {
    // aman diabaikan
  }

  if (finishPan(pointerId)) {
    delete activePointers[pointerId];
    return;
  }

  if (finishSelectionDrag(pointerId)) {
    delete activePointers[pointerId];
    return;
  }

  delete activePointers[pointerId];

  if (activeErasers[pointerId]) {
    delete activeErasers[pointerId];
    return;
  }

  finishFreehandStroke(pointerId);
  finishShape(pointerId);
}

function handlePointerLeave(event) {
  socket.emit("cursor-leave");
  stopPointer(event);
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  closeShapeMenu();

  if (tool === "pan") {
    activePointers[event.pointerId] = true;

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // aman diabaikan
    }

    startPan(event.pointerId, event);
    return;
  }

  if (tool === "image") {
    imageInput.click();
    return;
  }

  if (tool === "material") {
    materialInput.click();
    return;
  }

  if (locked && role !== "teacher") {
    setStatus("Board sedang dikunci oleh guru.");
    return;
  }

  const pos = toVirtualPosition(event);

  if (!isInsideBoard(pos.x, pos.y)) return;

  activePointers[event.pointerId] = true;

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // aman diabaikan
  }

  if (tool === "select") {
    const selected = findSelectableStrokeAt(pos);
    startSelectionDrag(event.pointerId, pos, selected);
    return;
  }

  if (tool === "text") {
    createTextAt(pos);
    delete activePointers[event.pointerId];
    return;
  }

  if (tool === "eraser") {
    activeErasers[event.pointerId] = true;
    eraseAt(pos);
    return;
  }

  if (tool === "line" || tool === "rect" || tool === "circle") {
    startShape(event.pointerId, pos, tool);
    requestRedraw();
    return;
  }

  startFreehandStroke(event.pointerId, pos);
  requestRedraw();
});

canvas.addEventListener("pointermove", (event) => {
  event.preventDefault();

  if (isPanning && panPointerId === event.pointerId) {
    updatePan(event);
    return;
  }

  const pos = toVirtualPosition(event);

  if (isInsideBoard(pos.x, pos.y)) {
    emitCursor(pos);
  }

  if (!activePointers[event.pointerId]) return;

  if (locked && role !== "teacher") return;

  if (!isInsideBoard(pos.x, pos.y)) {
    stopPointer(event);
    return;
  }

  if (draggingSelection && draggingSelection.pointerId === event.pointerId) {
    updateSelectionDrag(event.pointerId, pos);
    return;
  }

  if (activeErasers[event.pointerId]) {
    eraseAt(pos);
    return;
  }

  if (activeShapes[event.pointerId]) {
    updateShape(event.pointerId, pos);

    if (activeShapes[event.pointerId]) {
      emitStrokeProgress(activeShapes[event.pointerId]);
    }

    requestRedraw();
    return;
  }

  addFreehandPoint(event.pointerId, pos);

  if (activeStrokes[event.pointerId]) {
    emitStrokeProgress(activeStrokes[event.pointerId]);
  }

  requestRedraw();
});

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", handlePointerLeave);
canvas.addEventListener("pointercancel", handlePointerLeave);
canvas.addEventListener("pointerout", handlePointerLeave);

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();

    const screen = getScreenPosition(event);
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

    zoomAtScreenPoint(factor, screen.x, screen.y);
  },
  { passive: false }
);

toolbarToggleBtn.addEventListener("click", () => {
  floatingToolbar.classList.toggle("open");
});

sidePanelToggleBtn.addEventListener("click", () => {
  sidePanel.classList.toggle("open");
});

sidePanelCloseBtn.addEventListener("click", () => {
  sidePanel.classList.remove("open");
});

panTool.addEventListener("click", () => setTool("pan"));
selectTool.addEventListener("click", () => setTool("select"));
penTool.addEventListener("click", () => setTool("pen"));
eraserTool.addEventListener("click", () => setTool("eraser"));
textTool.addEventListener("click", () => setTool("text"));

imageTool.addEventListener("click", () => {
  setTool("image");
  imageInput.click();
});

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  addImageFileToBoard(file);
});

materialTool.addEventListener("click", () => {
  setTool("material");
  materialInput.click();
});

materialUploadBtn.addEventListener("click", () => {
  materialInput.click();
});

materialInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];

  if (!file) return;

  uploadMaterialFile(file);
});

materialOpenBtn.addEventListener("click", () => {
  if (!currentMaterial) return;

  window.open(currentMaterial.url, "_blank");
});

materialHideBtn.addEventListener("click", async () => {
  materialVisible = false;
  renderMaterialViewer();
  requestRedraw();

  try {
    await fetch("/api/materials/clear-current", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ roomId })
    });
  } catch (error) {
    // tetap aman walau gagal
  }
});

shapeMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleShapeMenu();
});

lineTool.addEventListener("click", () => {
  setTool("line");
  closeShapeMenu();
});

rectTool.addEventListener("click", () => {
  setTool("rect");
  closeShapeMenu();
});

circleTool.addEventListener("click", () => {
  setTool("circle");
  closeShapeMenu();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".shape-tool-group")) {
    closeShapeMenu();
  }
});

zoomOutBtn.addEventListener("click", () => {
  zoomAtCenter(1 / ZOOM_STEP);
});

zoomInBtn.addEventListener("click", () => {
  zoomAtCenter(ZOOM_STEP);
});

fitViewBtn.addEventListener("click", () => {
  fitView();
});

colorPicker.addEventListener("input", (event) => {
  color = event.target.value;
});

sizeSlider.addEventListener("input", (event) => {
  size = Number(event.target.value);
  sizeLabel.textContent = size;
});

undoBtn.addEventListener("click", () => {
  socket.emit("undo", { roomId });
});

redoBtn.addEventListener("click", () => {
  socket.emit("redo", { roomId });
});

function loadImageForExport(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const cached = imageCache[src];

    if (cached && cached.loaded) {
      resolve(cached.image);
      return;
    }

    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function drawStrokeOnExport(renderCtx, stroke) {
  if (stroke.type !== "image") {
    drawStrokeOn(renderCtx, stroke, 1, 0, 0);
    return;
  }

  const p = stroke.points && stroke.points[0];
  if (!p) return;

  const image = await loadImageForExport(stroke.src);

  if (image) {
    renderCtx.drawImage(
      image,
      p.x,
      p.y,
      stroke.width || 240,
      stroke.height || 160
    );
    return;
  }

  drawStrokeOn(renderCtx, stroke, 1, 0, 0);
}

exportBtn.addEventListener("click", async () => {
  const exportCanvas = document.createElement("canvas");
  const exportCtx = exportCanvas.getContext("2d");

  exportCanvas.width = VIRTUAL_WIDTH;
  exportCanvas.height = VIRTUAL_HEIGHT;

  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

  for (const stroke of strokes) {
    await drawStrokeOnExport(exportCtx, stroke);
  }

  if (splitMode) {
    drawSplitLine(exportCtx, 1, 0, 0);
  }

  const link = document.createElement("a");
  link.download = `${roomId}-virtual-board.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();

  setStatus("Board berhasil diekspor ke PNG.");
});

clearBtn.addEventListener("click", () => {
  if (role !== "teacher") {
    alert("Hanya guru yang dapat menghapus seluruh board.");
    return;
  }

  const confirmed = confirm("Hapus semua coretan di board ini?");
  if (!confirmed) return;

  socket.emit("clear", roomId);
});

splitBtn.addEventListener("click", () => {
  if (role !== "teacher") {
    alert("Hanya guru yang dapat mengatur split board.");
    return;
  }

  splitMode = !splitMode;

  socket.emit("split-board", {
    roomId,
    splitMode
  });
});

lockBtn.addEventListener("click", () => {
  if (role !== "teacher") {
    alert("Hanya guru yang dapat mengunci board.");
    return;
  }

  locked = !locked;

  socket.emit("lock-board", {
    roomId,
    locked
  });
});

backBtn.addEventListener("click", () => {
  socket.emit("cursor-leave");
  window.location.href = "/";
});

window.addEventListener("keydown", (event) => {
  if (isTypingTarget()) return;

  const key = event.key.toLowerCase();

  if (event.code === "Space" && !event.repeat) {
    event.preventDefault();

    if (tool !== "pan") {
      previousToolBeforeSpace = tool;
      setTool("pan");
    }

    return;
  }

  if (key === "h") setTool("pan");
  if (key === "v") setTool("select");
  if (key === "p") setTool("pen");
  if (key === "e") setTool("eraser");
  if (key === "t") setTool("text");

  if (key === "i") {
    setTool("image");
    imageInput.click();
  }

  if (key === "m") {
    setTool("material");
    materialInput.click();
  }

  if (key === "l") setTool("line");
  if (key === "r") setTool("rect");
  if (key === "c") setTool("circle");

  if (key === "0") {
    fitView();
  }

  if (key === "=" || key === "+") {
    zoomAtCenter(ZOOM_STEP);
  }

  if (key === "-" || key === "_") {
    zoomAtCenter(1 / ZOOM_STEP);
  }

  if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
    event.preventDefault();
    socket.emit("undo", { roomId });
  }

  if (
    ((event.ctrlKey || event.metaKey) && key === "y") ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "z")
  ) {
    event.preventDefault();
    socket.emit("redo", { roomId });
  }
});

window.addEventListener("keyup", (event) => {
  if (isTypingTarget()) return;

  if (event.code === "Space" && previousToolBeforeSpace) {
    event.preventDefault();

    setTool(previousToolBeforeSpace);
    previousToolBeforeSpace = null;
  }
});

socket.emit("join-room", {
  roomId,
  username,
  role
});

socket.on("board-state", (data) => {
  strokes = Array.isArray(data.strokes) ? data.strokes : [];
  splitMode = Boolean(data.splitMode);
  locked = Boolean(data.locked);
  materials = Array.isArray(data.materials) ? data.materials : [];

  if (data.currentMaterial) {
    setCurrentMaterial(data.currentMaterial, true);
  } else {
    setCurrentMaterial(null, false);
  }

  updateSplitUI();
  updateLockUI();
  renderMaterialList();
  requestRedraw();
});

socket.on("material-list", (data) => {
  materials = Array.isArray(data.materials) ? data.materials : materials;

  if (data.currentMaterial) {
    setCurrentMaterial(data.currentMaterial, true);
  }

  renderMaterialList();
});

socket.on("material-set", (data) => {
  materials = Array.isArray(data.materials) ? data.materials : materials;
  setCurrentMaterial(data.material, true);
  renderMaterialList();
  setStatus("Materi pembelajaran diperbarui.");
});

socket.on("material-clear", () => {
  setCurrentMaterial(null, false);
  setStatus("Materi disembunyikan.");
});

socket.on("stroke-progress", (stroke) => {
  activeRemoteStrokes[stroke.id] = stroke;
  requestRedraw();
});

socket.on("stroke-cancel", (data) => {
  delete activeRemoteStrokes[data.id];
  requestRedraw();
});

socket.on("stroke-add", (stroke) => {
  delete activeRemoteStrokes[stroke.id];

  const exists = strokes.some((item) => item.id === stroke.id);

  if (!exists) {
    strokes.push(stroke);
  }

  requestRedraw();
});

socket.on("stroke-remove", (data) => {
  delete activeRemoteStrokes[data.strokeId];

  strokes = strokes.filter((stroke) => stroke.id !== data.strokeId);

  if (selectedStrokeId === data.strokeId) {
    selectedStrokeId = null;
  }

  requestRedraw();
});

socket.on("stroke-update", (updatedStroke) => {
  delete activeRemoteStrokes[updatedStroke.id];

  const index = strokes.findIndex((stroke) => stroke.id === updatedStroke.id);

  if (index === -1) {
    strokes.push(updatedStroke);
  } else {
    strokes[index] = updatedStroke;
  }

  requestRedraw();
});

socket.on("clear", () => {
  strokes = [];
  selectedStrokeId = null;

  Object.keys(activeRemoteStrokes).forEach((id) => {
    delete activeRemoteStrokes[id];
  });

  requestRedraw();
});

socket.on("split-board", (data) => {
  splitMode = Boolean(data.splitMode);
  updateSplitUI();
  requestRedraw();
});

socket.on("lock-board", (data) => {
  locked = Boolean(data.locked);
  updateLockUI();
  requestRedraw();
});

socket.on("room-users", (users) => {
  userList.innerHTML = "";

  users.forEach((user) => {
    const li = document.createElement("li");
    li.className = user.role === "teacher" ? "user-teacher" : "user-student";
    li.textContent = `${user.username} (${user.role === "teacher" ? "Guru" : "Siswa"})`;
    userList.appendChild(li);
  });
});

socket.on("cursor-move", (cursor) => {
  remoteCursors[cursor.id] = cursor;
  requestRedraw();
});

socket.on("cursor-leave", (cursor) => {
  delete remoteCursors[cursor.id];
  requestRedraw();
});

socket.on("room-deleted", (data) => {
  alert(`Room "${data.roomId}" sudah dihapus oleh admin.`);
  window.location.href = "/";
});

window.addEventListener("resize", resizeCanvas);

window.addEventListener("beforeunload", () => {
  socket.emit("cursor-leave");
});

updateTeacherControls();
updateToolUI();
updateSplitUI();
updateLockUI();
resizeCanvas();
renderMaterialList();