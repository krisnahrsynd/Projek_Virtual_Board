const socket = io();

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "default";
const username = params.get("user") || "User";
const role = params.get("role") || "student";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const clearBtn = document.getElementById("clearBtn");
const backBtn = document.getElementById("backBtn");

const userList = document.getElementById("userList");

let strokes = {};
let currentStroke = null;

const activePointers = {};

let tool = "pen"; // pen | eraser
let size = 3;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 60;
  redraw();
}

window.addEventListener("resize", resize);
resize();

function drawStroke(stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.stroke();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  Object.values(strokes).forEach(drawStroke);
}

function startStroke(x, y) {
  currentStroke = {
    id: uid(),
    roomId,
    username,
    role,
    tool,
    color: tool === "eraser" ? "#ffffff" : "#000",
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

  strokes[currentStroke.id] = currentStroke;

  socket.emit("stroke", currentStroke);

  currentStroke = null;
}

canvas.addEventListener("pointerdown", (e) => {
  activePointers[e.pointerId] = true;

  startStroke(e.clientX, e.clientY);
});

canvas.addEventListener("pointermove", (e) => {
  if (!activePointers[e.pointerId]) return;

  addPoint(e.clientX, e.clientY);

  redraw();
});

function stop(e) {
  delete activePointers[e.pointerId];
  endStroke();
}

canvas.addEventListener("pointerup", stop);
canvas.addEventListener("pointerleave", stop);
canvas.addEventListener("pointercancel", stop);

socket.emit("join-room", { roomId, username, role });

socket.on("board-state", (data) => {
  strokes = {};
  (data.strokes || []).forEach(s => {
    strokes[s.id] = s;
  });
  redraw();
});

socket.on("stroke", (stroke) => {
  strokes[stroke.id] = stroke;
  redraw();
});

socket.on("erase", (id) => {
  delete strokes[id];
  redraw();
});

socket.on("clear", () => {
  strokes = {};
  redraw();
});

clearBtn.addEventListener("click", () => {
  socket.emit("clear", roomId);
});

backBtn.addEventListener("click", () => {
  window.location.href = "/";
});

// TOOL SHORTCUT (optional upgrade)
window.addEventListener("keydown", (e) => {
  if (e.key === "e") tool = "eraser";
  if (e.key === "p") tool = "pen";

  if (e.key === "z") socket.emit("undo", roomId);
  if (e.key === "y") socket.emit("redo", roomId);
});