const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");

const SAVE_DELAY = 300;
const MAX_STROKES_PER_ROOM = 10000;

const rooms = {};

let saveTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }
}

function toPersistableRooms() {
  const persisted = {};

  Object.entries(rooms).forEach(([roomId, room]) => {
    persisted[roomId] = {
      splitMode: Boolean(room.splitMode),
      locked: Boolean(room.locked),
      strokes: Array.isArray(room.strokes) ? room.strokes : [],
      redoStack: Array.isArray(room.redoStack) ? room.redoStack : []
    };
  });

  return persisted;
}

function saveRoomsToDisk() {
  try {
    ensureDataDir();

    const tempFile = `${DATA_FILE}.tmp`;
    const payload = JSON.stringify(toPersistableRooms(), null, 2);

    fs.writeFileSync(tempFile, payload, "utf8");
    fs.renameSync(tempFile, DATA_FILE);

    console.log("Board tersimpan ke data/rooms.json");
  } catch (error) {
    console.error("Gagal menyimpan board:", error.message);
  }
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveRoomsToDisk();
    saveTimer = null;
  }, SAVE_DELAY);
}

function loadRoomsFromDisk() {
  try {
    ensureDataDir();

    if (!fs.existsSync(DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    Object.entries(parsed).forEach(([roomId, room]) => {
      rooms[roomId] = {
        users: {},
        splitMode: Boolean(room.splitMode),
        locked: Boolean(room.locked),
        strokes: Array.isArray(room.strokes) ? room.strokes : [],
        redoStack: Array.isArray(room.redoStack) ? room.redoStack : []
      };
    });

    console.log("Board berhasil dimuat dari data/rooms.json");
  } catch (error) {
    console.error("Gagal memuat board:", error.message);
  }
}

function createRoomIfNotExists(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      splitMode: false,
      locked: false,
      strokes: [],
      redoStack: []
    };

    scheduleSave();
  }
}

function getRoomUsers(roomId) {
  if (!rooms[roomId]) return [];
  return Object.values(rooms[roomId].users);
}

function isTeacher(socket) {
  return socket.role === "teacher";
}

function canModifyStroke(socket, stroke) {
  if (!stroke) return false;

  return (
    isTeacher(socket) ||
    stroke.ownerId === socket.id ||
    stroke.username === socket.username
  );
}

function sanitizePoint(point) {
  if (!point) return null;

  const x = Number(point.x);
  const y = Number(point.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function normalizeStroke(socket, rawStroke = {}) {
  const roomId = socket.roomId || rawStroke.roomId;

  const rawPoints = Array.isArray(rawStroke.points) ? rawStroke.points : [];

  const points = rawPoints
    .map(sanitizePoint)
    .filter(Boolean)
    .slice(0, 5000);

  const allowedTypes = ["freehand", "shape", "text"];
  const type = allowedTypes.includes(rawStroke.type)
    ? rawStroke.type
    : "freehand";

  const allowedTools = ["pen", "line", "rect", "circle", "text"];
  const tool = allowedTools.includes(rawStroke.tool)
    ? rawStroke.tool
    : "pen";

  const allowedShapes = ["line", "rect", "circle"];
  const shape = allowedShapes.includes(rawStroke.shape)
    ? rawStroke.shape
    : null;

  const text = String(rawStroke.text || "").slice(0, 500);

  return {
    id: String(rawStroke.id || Date.now() + "-" + Math.random()),
    roomId,
    ownerId: socket.id,
    username: socket.username,
    role: socket.role,
    type,
    tool,
    shape,
    text,
    color: String(
      rawStroke.color ||
      (socket.role === "teacher" ? "#111827" : "#2563eb")
    ),
    size: Math.max(1, Math.min(40, Number(rawStroke.size) || 3)),
    fontSize: Math.max(10, Math.min(96, Number(rawStroke.fontSize) || 28)),
    points,
    createdAt: Number(rawStroke.createdAt) || Date.now()
  };
}

function isValidStroke(stroke) {
  if (!stroke.roomId) return false;

  if (stroke.type === "freehand") {
    return stroke.points.length >= 2;
  }

  if (stroke.type === "shape") {
    return stroke.shape && stroke.points.length >= 2;
  }

  if (stroke.type === "text") {
    return stroke.text.trim().length > 0 && stroke.points.length >= 1;
  }

  return false;
}

function trimRoomIfNeeded(room) {
  if (!Array.isArray(room.strokes)) {
    room.strokes = [];
  }

  if (room.strokes.length > MAX_STROKES_PER_ROOM) {
    room.strokes = room.strokes.slice(-MAX_STROKES_PER_ROOM);
  }
}

loadRoomsFromDisk();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (data = {}) => {
    const roomId = String(data.roomId || "default").trim();
    const username = String(data.username || "User").trim();
    const role = data.role === "teacher" ? "teacher" : "student";

    createRoomIfNotExists(roomId);

    socket.join(roomId);

    socket.roomId = roomId;
    socket.username = username;
    socket.role = role;

    rooms[roomId].users[socket.id] = {
      id: socket.id,
      username,
      role
    };

    socket.emit("board-state", {
      strokes: rooms[roomId].strokes,
      splitMode: rooms[roomId].splitMode,
      locked: rooms[roomId].locked
    });

    io.to(roomId).emit("room-users", getRoomUsers(roomId));

    console.log(`${username} joined room ${roomId} as ${role}`);
  });

  socket.on("stroke-add", (rawStroke = {}) => {
    const roomId = socket.roomId || rawStroke.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    const stroke = normalizeStroke(socket, rawStroke);

    if (!isValidStroke(stroke)) return;

    room.strokes.push(stroke);
    room.redoStack = [];

    trimRoomIfNeeded(room);
    scheduleSave();

    socket.to(roomId).emit("stroke-add", stroke);
  });

  socket.on("erase-stroke", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    const strokeId = String(data.strokeId);

    const index = room.strokes.findIndex((stroke) => stroke.id === strokeId);

    if (index === -1) return;

    const stroke = room.strokes[index];

    if (!canModifyStroke(socket, stroke)) return;

    room.strokes.splice(index, 1);
    scheduleSave();

    io.to(roomId).emit("stroke-remove", {
      strokeId
    });
  });

  socket.on("undo", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    let index = -1;

    for (let i = room.strokes.length - 1; i >= 0; i--) {
      const stroke = room.strokes[i];

      if (canModifyStroke(socket, stroke)) {
        index = i;
        break;
      }
    }

    if (index === -1) return;

    const [removedStroke] = room.strokes.splice(index, 1);

    room.redoStack.push(removedStroke);

    scheduleSave();

    io.to(roomId).emit("stroke-remove", {
      strokeId: removedStroke.id
    });
  });

  socket.on("redo", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    let index = -1;

    for (let i = room.redoStack.length - 1; i >= 0; i--) {
      const stroke = room.redoStack[i];

      if (canModifyStroke(socket, stroke)) {
        index = i;
        break;
      }
    }

    if (index === -1) return;

    const [stroke] = room.redoStack.splice(index, 1);

    room.strokes.push(stroke);

    trimRoomIfNeeded(room);
    scheduleSave();

    io.to(roomId).emit("stroke-add", stroke);
  });

  socket.on("clear", (roomIdFromClient) => {
    const roomId = socket.roomId || roomIdFromClient;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].strokes = [];
    rooms[roomId].redoStack = [];

    scheduleSave();

    io.to(roomId).emit("clear");
  });

  socket.on("split-board", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].splitMode = Boolean(data.splitMode);

    scheduleSave();

    io.to(roomId).emit("split-board", {
      splitMode: rooms[roomId].splitMode
    });
  });

  socket.on("lock-board", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].locked = Boolean(data.locked);

    scheduleSave();

    io.to(roomId).emit("lock-board", {
      locked: rooms[roomId].locked
    });
  });

  socket.on("cursor-move", (data = {}) => {
    const roomId = socket.roomId;

    if (!roomId) return;

    const x = Number(data.x);
    const y = Number(data.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    socket.to(roomId).emit("cursor-move", {
      id: socket.id,
      username: socket.username,
      role: socket.role,
      x,
      y
    });
  });

  socket.on("cursor-leave", () => {
    const roomId = socket.roomId;

    if (!roomId) return;

    socket.to(roomId).emit("cursor-leave", {
      id: socket.id
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;

    if (roomId && rooms[roomId]) {
      delete rooms[roomId].users[socket.id];

      socket.to(roomId).emit("cursor-leave", {
        id: socket.id
      });

      io.to(roomId).emit("room-users", getRoomUsers(roomId));
    }

    console.log("User disconnected:", socket.id);
  });
});

function shutdown() {
  console.log("Menyimpan board sebelum server berhenti...");
  saveRoomsToDisk();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(process.env.PORT || 3000, () => {
  console.log("Server berjalan di port", process.env.PORT || 3000);
});