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

const penTool = document.getElementById("penTool");
const eraserTool = document.getElementById("eraserTool");
const textTool = document.getElementById("textTool");
const lineTool = document.getElementById("lineTool");
const rectTool = document.getElementById("rectTool");
const circleTool = document.getElementById("circleTool");

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

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let strokes = [];
let splitMode = false;
let locked = false;

let tool = "pen";
let color = role === "teacher" ? DEFAULT_TEACHER_COLOR : DEFAULT_STUDENT_COLOR;
let size = role === "teacher" ? 4 : 3;

let redrawPending = false;
let lastCursorEmit = 0;

const CURSOR_INTERVAL = 35;

const activePointers = {};
const activeStrokes = {};
const activeShapes = {};
const activeErasers = {};
const remoteCursors = {};

colorPicker.value = color;
sizeSlider.value = size;
sizeLabel.textContent = size;

function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function setStatus(text) {
  statusText.textContent = text;
}

function setTool(nextTool) {
  tool = nextTool;
  updateToolUI();
}

function updateToolUI() {
  const buttons = [
    [penTool, "pen"],
    [eraserTool, "eraser"],
    [textTool, "text"],
    [lineTool, "line"],
    [rectTool, "rect"],
    [circleTool, "circle"]
  ];

  buttons.forEach(([button, value]) => {
    button.classList.toggle("active", tool === value);
  });

  canvas.classList.toggle("eraser-cursor", tool === "eraser");
  canvas.classList.toggle("text-cursor", tool === "text");

  const label = {
    pen: "Mode: Pen",
    eraser: "Mode: Eraser",
    text: "Mode: Text",
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

  if (locked && role !== "teacher") {
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

  scale = Math.min(scaleX, scaleY);

  offsetX = (canvas.width - VIRTUAL_WIDTH * scale) / 2;
  offsetY = (canvas.height - VIRTUAL_HEIGHT * scale) / 2;

  requestRedraw();
}

function clearScreenOnly(renderCtx = ctx, s = scale, ox = offsetX, oy = offsetY, includeOutside = true) {
  if (includeOutside) {
    renderCtx.clearRect(0, 0, canvas.width, canvas.height);

    renderCtx.fillStyle = "#e5e7eb";
    renderCtx.fillRect(0, 0, canvas.width, canvas.height);
  }

  renderCtx.fillStyle = "#ffffff";
  renderCtx.fillRect(ox, oy, VIRTUAL_WIDTH * s, VIRTUAL_HEIGHT * s);

  renderCtx.strokeStyle = "#111827";
  renderCtx.lineWidth = Math.max(1, 2 * s);
  renderCtx.strokeRect(ox, oy, VIRTUAL_WIDTH * s, VIRTUAL_HEIGHT * s);
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
  const rect = canvas.getBoundingClientRect();

  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;

  return {
    x: (screenX - offsetX) / scale,
    y: (screenY - offsetY) / scale
  };
}

function isInsideBoard(x, y) {
  return x >= 0 && x <= VIRTUAL_WIDTH && y >= 0 && y <= VIRTUAL_HEIGHT;
}

function getStrokeColor(stroke) {
  return stroke.color || (stroke.role === "teacher" ? DEFAULT_TEACHER_COLOR : DEFAULT_STUDENT_COLOR);
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

function drawStrokeOn(renderCtx, stroke, s = scale, ox = offsetX, oy = offsetY) {
  if (stroke.type === "shape") {
    drawShapeStroke(renderCtx, stroke, s, ox, oy);
    return;
  }

  if (stroke.type === "text") {
    drawTextStroke(renderCtx, stroke, s, ox, oy);
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
  Object.values(activeStrokes).forEach((stroke) => drawStrokeOn(ctx, stroke));
  Object.values(activeShapes).forEach((stroke) => drawStrokeOn(ctx, stroke));

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

function canEraseLocal(stroke) {
  return role === "teacher" || stroke.username === username;
}

function strokeHitTest(stroke, point, radius) {
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

  if (activeErasers[event.pointerId]) {
    eraseAt(pos);
    return;
  }

  if (activeShapes[event.pointerId]) {
    updateShape(event.pointerId, pos);
    requestRedraw();
    return;
  }

  addFreehandPoint(event.pointerId, pos);
  requestRedraw();
});

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", handlePointerLeave);
canvas.addEventListener("pointercancel", handlePointerLeave);
canvas.addEventListener("pointerout", handlePointerLeave);

penTool.addEventListener("click", () => setTool("pen"));
eraserTool.addEventListener("click", () => setTool("eraser"));
textTool.addEventListener("click", () => setTool("text"));
lineTool.addEventListener("click", () => setTool("line"));
rectTool.addEventListener("click", () => setTool("rect"));
circleTool.addEventListener("click", () => setTool("circle"));

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

exportBtn.addEventListener("click", () => {
  const exportCanvas = document.createElement("canvas");
  const exportCtx = exportCanvas.getContext("2d");

  exportCanvas.width = VIRTUAL_WIDTH;
  exportCanvas.height = VIRTUAL_HEIGHT;

  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

  strokes.forEach((stroke) => {
    drawStrokeOn(exportCtx, stroke, 1, 0, 0);
  });

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
  const key = event.key.toLowerCase();

  if (key === "p") setTool("pen");
  if (key === "e") setTool("eraser");
  if (key === "t") setTool("text");
  if (key === "l") setTool("line");
  if (key === "r") setTool("rect");
  if (key === "c") setTool("circle");

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

socket.emit("join-room", {
  roomId,
  username,
  role
});

socket.on("board-state", (data) => {
  strokes = Array.isArray(data.strokes) ? data.strokes : [];
  splitMode = Boolean(data.splitMode);
  locked = Boolean(data.locked);

  updateSplitUI();
  updateLockUI();
  requestRedraw();
});

socket.on("stroke-add", (stroke) => {
  const exists = strokes.some((item) => item.id === stroke.id);

  if (!exists) {
    strokes.push(stroke);
  }

  requestRedraw();
});

socket.on("stroke-remove", (data) => {
  strokes = strokes.filter((stroke) => stroke.id !== data.strokeId);
  requestRedraw();
});

socket.on("clear", () => {
  strokes = [];
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

window.addEventListener("resize", resizeCanvas);

window.addEventListener("beforeunload", () => {
  socket.emit("cursor-leave");
});

updateTeacherControls();
updateToolUI();
updateSplitUI();
updateLockUI();
resizeCanvas();