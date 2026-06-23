const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, "data");

const DATA_FILE = path.join(DATA_DIR, "rooms.json");

const SAVE_DELAY = 300;
const MAX_STROKES_PER_ROOM = 10000;

const rooms = {};

let saveTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

    console.log("Board tersimpan ke", DATA_FILE);
  } catch (error) {
    console.error("Gagal menyimpan board:", error.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveRoomsToDisk();
    saveTimer = null;
  }, SAVE_DELAY);
}

function loadRoomsFromDisk() {
  try {
    ensureDataDir();

    if (!fs.existsSync(DATA_FILE)) return;

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

    console.log("Board berhasil dimuat dari", DATA_FILE);
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

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

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
  if (!Array.isArray(room.strokes)) room.strokes = [];

  if (room.strokes.length > MAX_STROKES_PER_ROOM) {
    room.strokes = room.strokes.slice(-MAX_STROKES_PER_ROOM);
  }
}

/* ADMIN API */

function requireAdmin(req, res, next) {
  const expectedPin = process.env.ADMIN_PIN;
  const givenPin = req.headers["x-admin-pin"];

  if (!expectedPin) {
    return res.status(500).json({
      error: "ADMIN_PIN belum diset di environment variable."
    });
  }

  if (!givenPin || givenPin !== expectedPin) {
    return res.status(401).json({
      error: "PIN admin salah atau belum diisi."
    });
  }

  next();
}

function getLastActivity(room) {
  const strokes = Array.isArray(room.strokes) ? room.strokes : [];

  if (strokes.length === 0) return null;

  return Math.max(...strokes.map((stroke) => Number(stroke.createdAt) || 0));
}

function getRoomSummary(roomId, room) {
  const strokes = Array.isArray(room.strokes) ? room.strokes : [];
  const users = getRoomUsers(roomId);

  const freehandCount = strokes.filter((s) => s.type === "freehand").length;
  const shapeCount = strokes.filter((s) => s.type === "shape").length;
  const textCount = strokes.filter((s) => s.type === "text").length;

  return {
    roomId,
    activeUsers: users.length,
    teachers: users.filter((u) => u.role === "teacher").length,
    students: users.filter((u) => u.role === "student").length,
    splitMode: Boolean(room.splitMode),
    locked: Boolean(room.locked),
    strokes: strokes.length,
    freehandCount,
    shapeCount,
    textCount,
    lastActivity: getLastActivity(room)
  };
}

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/storage", requireAdmin, (req, res) => {
  res.json({
    dataDir: DATA_DIR,
    dataFile: DATA_FILE,
    dataFileExists: fs.existsSync(DATA_FILE),
    roomCount: Object.keys(rooms).length
  });
});

app.get("/api/admin/rooms", requireAdmin, (req, res) => {
  const summaries = Object.entries(rooms)
    .map(([roomId, room]) => getRoomSummary(roomId, room))
    .sort((a, b) => {
      const aa = a.lastActivity || 0;
      const bb = b.lastActivity || 0;
      return bb - aa;
    });

  res.json({
    rooms: summaries
  });
});

app.get("/api/admin/rooms/:roomId", requireAdmin, (req, res) => {
  const roomId = req.params.roomId;

  if (!rooms[roomId]) {
    return res.status(404).json({
      error: "Room tidak ditemukan."
    });
  }

  res.json({
    summary: getRoomSummary(roomId, rooms[roomId]),
    users: getRoomUsers(roomId),
    strokes: rooms[roomId].strokes
  });
});

app.post("/api/admin/rooms/:roomId/clear", requireAdmin, (req, res) => {
  const roomId = req.params.roomId;

  createRoomIfNotExists(roomId);

  rooms[roomId].strokes = [];
  rooms[roomId].redoStack = [];

  scheduleSave();

  io.to(roomId).emit("clear");

  res.json({
    ok: true,
    message: `Room ${roomId} berhasil dibersihkan.`
  });
});

app.post("/api/admin/rooms/:roomId/lock", requireAdmin, (req, res) => {
  const roomId = req.params.roomId;

  createRoomIfNotExists(roomId);

  rooms[roomId].locked = Boolean(req.body.locked);

  scheduleSave();

  io.to(roomId).emit("lock-board", {
    locked: rooms[roomId].locked
  });

  res.json({
    ok: true,
    locked: rooms[roomId].locked
  });
});

app.post("/api/admin/rooms/:roomId/split", requireAdmin, (req, res) => {
  const roomId = req.params.roomId;

  createRoomIfNotExists(roomId);

  rooms[roomId].splitMode = Boolean(req.body.splitMode);

  scheduleSave();

  io.to(roomId).emit("split-board", {
    splitMode: rooms[roomId].splitMode
  });

  res.json({
    ok: true,
    splitMode: rooms[roomId].splitMode
  });
});

app.delete("/api/admin/rooms/:roomId", requireAdmin, (req, res) => {
  const roomId = req.params.roomId;

  if (!rooms[roomId]) {
    return res.status(404).json({
      error: "Room tidak ditemukan."
    });
  }

  delete rooms[roomId];

  scheduleSave();

  io.to(roomId).emit("room-deleted", {
    roomId
  });

  res.json({
    ok: true,
    message: `Room ${roomId} berhasil dihapus.`
  });
});

app.post("/api/admin/save", requireAdmin, (req, res) => {
  saveRoomsToDisk();

  res.json({
    ok: true,
    message: "Data board berhasil disimpan manual."
  });
});

/* SOCKET.IO */

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

  socket.on("stroke-progress", (rawStroke = {}) => {
    const roomId = socket.roomId || rawStroke.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    const stroke = normalizeStroke(socket, rawStroke);

    socket.to(roomId).emit("stroke-progress", stroke);
  });

  socket.on("stroke-cancel", (data = {}) => {
    const roomId = socket.roomId || data.roomId;

    if (!roomId) return;

    socket.to(roomId).emit("stroke-cancel", {
      id: String(data.id || "")
    });
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

  socket.on("stroke-update", (rawStroke = {}) => {
    const roomId = socket.roomId || rawStroke.roomId;

    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    const strokeId = String(rawStroke.id || "");

    const index = room.strokes.findIndex((stroke) => stroke.id === strokeId);

    if (index === -1) return;

    const existingStroke = room.strokes[index];

    if (!canModifyStroke(socket, existingStroke)) return;

    const updatedStroke = normalizeStroke(socket, {
      ...existingStroke,
      ...rawStroke,
      id: existingStroke.id,
      roomId,
      ownerId: existingStroke.ownerId,
      username: existingStroke.username,
      role: existingStroke.role,
      createdAt: existingStroke.createdAt
    });

    updatedStroke.id = existingStroke.id;
    updatedStroke.roomId = roomId;
    updatedStroke.ownerId = existingStroke.ownerId;
    updatedStroke.username = existingStroke.username;
    updatedStroke.role = existingStroke.role;
    updatedStroke.createdAt = existingStroke.createdAt;

    if (!isValidStroke(updatedStroke)) return;

    room.strokes[index] = updatedStroke;

    scheduleSave();

    io.to(roomId).emit("stroke-update", updatedStroke);
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