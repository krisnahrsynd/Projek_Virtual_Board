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

const penTool = document.getElementById("penTool");
const eraserTool = document.getElementById("eraserTool");
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

const activePointers = {};
const activeStrokes = {};
const activeErasers = {};

colorPicker.value = color;
sizeSlider.value = size;
sizeLabel.textContent = size;

function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function setStatus(text) {
  statusText.textContent = text;
}

function updateToolUI() {
  penTool.classList.toggle("active", tool === "pen");
  eraserTool.classList.toggle("active", tool === "eraser");

  canvas.classList.toggle("eraser-cursor", tool === "eraser");

  if (tool === "pen") {
    setStatus("Mode: Pen");
  } else {
    setStatus("Mode: Eraser");
  }
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

function clearScreenOnly() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    offsetX,
    offsetY,
    VIRTUAL_WIDTH * scale,
    VIRTUAL_HEIGHT * scale
  );

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    offsetX,
    offsetY,
    VIRTUAL_WIDTH * scale,
    VIRTUAL_HEIGHT * scale
  );
}

function drawSplitLine() {
  if (!splitMode) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(offsetX + (VIRTUAL_WIDTH / 2) * scale, offsetY);
  ctx.lineTo(
    offsetX + (VIRTUAL_WIDTH / 2) * scale,
    offsetY + VIRTUAL_HEIGHT * scale
  );
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.stroke();
  ctx.restore();
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

function drawStroke(stroke) {
  const pts = stroke.points;

  if (!pts || pts.length === 0) return;

  const strokeColor =
    stroke.color || (stroke.role === "teacher" ? DEFAULT_TEACHER_COLOR : DEFAULT_STUDENT_COLOR);

  const strokeSize = Math.max(1, (stroke.size || 3) * scale);

  ctx.save();

  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = strokeSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(
      offsetX + pts[0].x * scale,
      offsetY + pts[0].y * scale,
      strokeSize / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();

  ctx.moveTo(
    offsetX + pts[0].x * scale,
    offsetY + pts[0].y * scale
  );

  if (pts.length === 2) {
    ctx.lineTo(
      offsetX + pts[1].x * scale,
      offsetY + pts[1].y * scale
    );
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const current = pts[i];
      const next = pts[i + 1];

      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;

      ctx.quadraticCurveTo(
        offsetX + current.x * scale,
        offsetY + current.y * scale,
        offsetX + midX * scale,
        offsetY + midY * scale
      );
    }

    const last = pts[pts.length - 1];

    ctx.lineTo(
      offsetX + last.x * scale,
      offsetY + last.y * scale
    );
  }

  ctx.stroke();
  ctx.restore();
}

function redrawAll() {
  clearScreenOnly();

  strokes.forEach(drawStroke);
  Object.values(activeStrokes).forEach(drawStroke);

  drawSplitLine();
  drawLockedOverlay();
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

function canEraseLocal(stroke) {
  return role === "teacher" || stroke.username === username;
}

function strokeHitTest(stroke, point, radius) {
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

function startStroke(pointerId, pos) {
  activeStrokes[pointerId] = {
    id: uid(),
    roomId,
    username,
    role,
    tool: "pen",
    color,
    size,
    points: [pos],
    createdAt: Date.now()
  };
}

function addPoint(pointerId, pos) {
  const stroke = activeStrokes[pointerId];

  if (!stroke) return;

  const lastPoint = stroke.points[stroke.points.length - 1];

  if (distance(lastPoint, pos) < 0.7) return;

  stroke.points.push(pos);
}

function finishStroke(pointerId) {
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

  finishStroke(pointerId);
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

  if (tool === "eraser") {
    activeErasers[event.pointerId] = true;
    eraseAt(pos);
    return;
  }

  startStroke(event.pointerId, pos);
  requestRedraw();
});

canvas.addEventListener("pointermove", (event) => {
  event.preventDefault();

  if (!activePointers[event.pointerId]) return;

  if (locked && role !== "teacher") return;

  const pos = toVirtualPosition(event);

  if (!isInsideBoard(pos.x, pos.y)) {
    stopPointer(event);
    return;
  }

  if (activeErasers[event.pointerId]) {
    eraseAt(pos);
    return;
  }

  addPoint(event.pointerId, pos);
  requestRedraw();
});

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", stopPointer);
canvas.addEventListener("pointercancel", stopPointer);
canvas.addEventListener("pointerout", stopPointer);

penTool.addEventListener("click", () => {
  tool = "pen";
  updateToolUI();
});

eraserTool.addEventListener("click", () => {
  tool = "eraser";
  updateToolUI();
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
  window.location.href = "/";
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (key === "p") {
    tool = "pen";
    updateToolUI();
  }

  if (key === "e") {
    tool = "eraser";
    updateToolUI();
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

window.addEventListener("resize", resizeCanvas);

updateTeacherControls();
updateToolUI();
updateSplitUI();
updateLockUI();
resizeCanvas();