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

const roomLabel = document.getElementById("roomLabel");
const userLabel = document.getElementById("userLabel");
const roleLabel = document.getElementById("roleLabel");
const userList = document.getElementById("userList");

roomLabel.textContent = roomId;
userLabel.textContent = username;
roleLabel.textContent = role === "teacher" ? "Guru" : "Siswa";

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let strokes = [];
let currentStroke = null;

let tool = "pen";
let color = "#000000";
let size = 3;

const activePointers = {};
let splitMode = false;

let lastEmitTime = 0;
const EMIT_INTERVAL = 16;

function resizeCanvas() {
  const boardArea = document.querySelector(".board-area");

  canvas.width = boardArea.clientWidth;
  canvas.height = boardArea.clientHeight;

  const scaleX = canvas.width / VIRTUAL_WIDTH;
  const scaleY = canvas.height / VIRTUAL_HEIGHT;

  scale = Math.min(scaleX, scaleY);

  offsetX = (canvas.width - VIRTUAL_WIDTH * scale) / 2;
  offsetY = (canvas.height - VIRTUAL_HEIGHT * scale) / 2;

  redrawAll();
}

function clearScreenOnly() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "white";
  ctx.fillRect(offsetX, offsetY, VIRTUAL_WIDTH * scale, VIRTUAL_HEIGHT * scale);

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(offsetX, offsetY, VIRTUAL_WIDTH * scale, VIRTUAL_HEIGHT * scale);
}

function toVirtualPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left - offsetX) / scale,
    y: (event.clientY - rect.top - offsetY) / scale
  };
}

function isInsideBoard(x, y) {
  return x >= 0 && x <= VIRTUAL_WIDTH && y >= 0 && y <= VIRTUAL_HEIGHT;
}

function startStroke(x, y) {
  currentStroke = {
    roomId,
    username,
    role,
    tool,
    color,
    size,
    points: [{ x, y }]
  };
}

function addPoint(x, y) {
  if (!currentStroke) return;
  currentStroke.points.push({ x, y });
}

function endStroke() {
  if (!currentStroke) return;

  strokes.push(currentStroke);
  socket.emit("draw", currentStroke);
  currentStroke = null;
}

function drawStroke(stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(
    offsetX + pts[0].x * scale,
    offsetY + pts[0].y * scale
  );

  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(
      offsetX + pts[i].x * scale,
      offsetY + pts[i].y * scale
    );
  }

  ctx.strokeStyle = stroke.color || "black";
  ctx.lineWidth = (stroke.size || 3) * scale;
  ctx.lineCap = "round";
  ctx.stroke();
}

function redrawAll() {
  clearScreenOnly();

  strokes.forEach(drawStroke);

  if (currentStroke) drawStroke(currentStroke);
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

socket.emit("join-room", { roomId, username, role });

socket.on("board-state", (data) => {
  strokes = data.strokes || [];
  splitMode = data.splitMode || false;

  redrawAll();
});

canvas.addEventListener("pointerdown", (event) => {
  const pos = toVirtualPosition(event);
  if (!isInsideBoard(pos.x, pos.y)) return;

  activePointers[event.pointerId] = pos;
  startStroke(pos.x, pos.y);
});

canvas.addEventListener("pointermove", (event) => {
  if (!activePointers[event.pointerId]) return;

  const now = Date.now();
  const pos = toVirtualPosition(event);

  if (!isInsideBoard(pos.x, pos.y)) {
    delete activePointers[event.pointerId];
    endStroke();
    return;
  }

  addPoint(pos.x, pos.y);
  activePointers[event.pointerId] = pos;

  redrawAll();

  if (now - lastEmitTime > EMIT_INTERVAL) {
    lastEmitTime = now;
  }
});

function stopPointer(event) {
  delete activePointers[event.pointerId];
  endStroke();
}

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", stopPointer);
canvas.addEventListener("pointercancel", stopPointer);
canvas.addEventListener("pointerout", stopPointer);

socket.on("draw", (stroke) => {
  strokes.push(stroke);
  redrawAll();
});

clearBtn.addEventListener("click", () => {
  socket.emit("clear", roomId);
});

socket.on("clear", () => {
  strokes = [];
  redrawAll();
});

splitBtn.addEventListener("click", () => {
  splitMode = !splitMode;

  socket.emit("split-board", {
    roomId,
    splitMode
  });
});

socket.on("room-users", (users) => {
  userList.innerHTML = "";

  users.forEach((u) => {
    const li = document.createElement("li");
    li.textContent = `${u.username} (${u.role === "teacher" ? "Guru" : "Siswa"})`;
    userList.appendChild(li);
  });
});

backBtn.addEventListener("click", () => {
  window.location.href = "/";
});