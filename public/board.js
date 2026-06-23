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

// Variabel untuk melacak banyak sentuhan (multi-touch) sekaligus
const activePointers = {}; 

let splitMode = false;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let strokes = [];

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

function drawSplitLine() {
  if (!splitMode) return;

  ctx.beginPath();
  ctx.moveTo(offsetX + (VIRTUAL_WIDTH / 2) * scale, offsetY);
  ctx.lineTo(
    offsetX + (VIRTUAL_WIDTH / 2) * scale,
    offsetY + VIRTUAL_HEIGHT * scale
  );
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLineOnScreen(x1, y1, x2, y2, drawRole) {
  ctx.beginPath();

  ctx.moveTo(offsetX + x1 * scale, offsetY + y1 * scale);
  ctx.lineTo(offsetX + x2 * scale, offsetY + y2 * scale);

  ctx.strokeStyle = drawRole === "teacher" ? "black" : "blue";
  ctx.lineWidth = (drawRole === "teacher" ? 4 : 2) * scale;
  ctx.lineCap = "round";
  ctx.stroke();
}

function redrawAll() {
  clearScreenOnly();

  strokes.forEach((stroke) => {
    drawLineOnScreen(
      stroke.x1,
      stroke.y1,
      stroke.x2,
      stroke.y2,
      stroke.role
    );
  });

  drawSplitLine();
}

function drawLine(x1, y1, x2, y2, drawRole, emit = true) {
  const stroke = {
    roomId,
    username,
    role: drawRole,
    x1,
    y1,
    x2,
    y2
  };

  strokes.push(stroke);

  redrawAll();

  if (emit) {
    socket.emit("draw", stroke);
  }
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

socket.emit("join-room", {
  roomId,
  username,
  role
});

socket.on("board-state", (data) => {
  strokes = data.strokes || [];
  splitMode = data.splitMode || false;

  splitBtn.textContent = splitMode ? "Unsplit Board" : "Split Board";

  redrawAll();
});

// === LOGIKA MULTI-TOUCH DIMULAI DI SINI ===

canvas.addEventListener("pointerdown", (event) => {
  const pos = toVirtualPosition(event);

  // Pastikan sentuhan berada di dalam area board
  if (!isInsideBoard(pos.x, pos.y)) return;

  // Simpan posisi awal untuk jari/stylus dengan ID tertentu
  activePointers[event.pointerId] = { x: pos.x, y: pos.y };
});

canvas.addEventListener("pointermove", (event) => {
  // Hanya proses jika jari/stylus ini sedang aktif menekan
  if (!activePointers[event.pointerId]) return;

  const pos = toVirtualPosition(event);

  // Jika jari keluar batas board, hentikan coretan untuk jari ini
  if (!isInsideBoard(pos.x, pos.y)) {
    delete activePointers[event.pointerId];
    return;
  }

  // Ambil posisi terakhir untuk jari ini
  const lastPos = activePointers[event.pointerId];

  // Gambar garis
  drawLine(lastPos.x, lastPos.y, pos.x, pos.y, role, true);

  // Perbarui posisi terakhir jari ini
  activePointers[event.pointerId] = { x: pos.x, y: pos.y };
});

// Fungsi untuk menghapus pointer saat dilepas/keluar
function stopPointer(event) {
  delete activePointers[event.pointerId];
}

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", stopPointer);
canvas.addEventListener("pointercancel", stopPointer);
canvas.addEventListener("pointerout", stopPointer);

// === LOGIKA MULTI-TOUCH SELESAI ===

socket.on("draw", (data) => {
  drawLine(data.x1, data.y1, data.x2, data.y2, data.role, false);
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

socket.on("split-board", (data) => {
  splitMode = data.splitMode;
  splitBtn.textContent = splitMode ? "Unsplit Board" : "Split Board";
  redrawAll();
});

socket.on("room-users", (users) => {
  userList.innerHTML = "";

  users.forEach((user) => {
    const li = document.createElement("li");
    li.textContent = `${user.username} (${user.role === "teacher" ? "Guru" : "Siswa"})`;
    userList.appendChild(li);
  });
});

backBtn.addEventListener("click", () => {
  window.location.href = "/";
});