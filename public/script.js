const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const clearBtn = document.getElementById("clearBtn");

// Menggunakan object untuk melacak banyak sentuhan sekaligus
const activePointers = {};

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 50;
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

function getPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function drawLine(x1, y1, x2, y2, emit = true) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();

  if (emit) {
    socket.emit("draw", {
      x1,
      y1,
      x2,
      y2
    });
  }
}

// Tangkap posisi awal setiap jari yang menyentuh layar
canvas.addEventListener("pointerdown", (event) => {
  const pos = getPosition(event);
  activePointers[event.pointerId] = { x: pos.x, y: pos.y };
});

// Jalankan tracking garis terpisah untuk setiap pointerId (multi-touch)
canvas.addEventListener("pointermove", (event) => {
  // Hanya eksekusi jika pointerId tersebut sedang aktif (ditekan)
  if (!activePointers[event.pointerId]) return;

  const pos = getPosition(event);
  const lastPos = activePointers[event.pointerId];

  drawLine(lastPos.x, lastPos.y, pos.x, pos.y);

  // Perbarui posisi terakhir untuk jari spesifik ini
  activePointers[event.pointerId] = { x: pos.x, y: pos.y };
});

// Hapus data sentuhan saat jari diangkat atau keluar dari area papan
function stopPointer(event) {
  delete activePointers[event.pointerId];
}

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointerleave", stopPointer);
// Tambahan pointercancel dan pointerout agar tidak ada garis yang "nyangkut"
canvas.addEventListener("pointercancel", stopPointer);
canvas.addEventListener("pointerout", stopPointer);

socket.on("draw", (data) => {
  drawLine(data.x1, data.y1, data.x2, data.y2, false);
});

clearBtn.addEventListener("click", () => {
  socket.emit("clear");
});

socket.on("clear", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});