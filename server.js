const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024
});

app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, "data");

const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const IOT_FILE = path.join(DATA_DIR, "iot-devices.json");
const MATERIALS_DIR = path.join(DATA_DIR, "materials");

const SAVE_DELAY = 300;
const MAX_STROKES_PER_ROOM = 10000;
const MAX_IMAGE_DATA_URL_LENGTH = 6_500_000;
const MAX_MATERIAL_DATA_URL_LENGTH = 24_000_000;
const IOT_OFFLINE_AFTER_MS = 15000;

const rooms = {};
const iotDevices = {};

let saveTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(MATERIALS_DIR)) {
    fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  }
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function safeRoomId(roomId) {
  return sanitizeFilePart(roomId || "default") || "default";
}

function materialRoomDir(roomId) {
  return path.join(MATERIALS_DIR, safeRoomId(roomId));
}

function ensureMaterialRoomDir(roomId) {
  const dir = materialRoomDir(roomId);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

function toPersistableRooms() {
  const persisted = {};

  Object.entries(rooms).forEach(([roomId, room]) => {
    persisted[roomId] = {
      splitMode: Boolean(room.splitMode),
      locked: Boolean(room.locked),
      strokes: Array.isArray(room.strokes) ? room.strokes : [],
      redoStack: Array.isArray(room.redoStack) ? room.redoStack : [],
      materials: Array.isArray(room.materials) ? room.materials : [],
      currentMaterialId: room.currentMaterialId || null,
      currentMaterialPage: Number(room.currentMaterialPage) || 1
    };
  });

  return persisted;
}

function toPersistableIotDevices() {
  const persisted = {};

  Object.entries(iotDevices).forEach(([deviceId, device]) => {
    persisted[deviceId] = {
      ...device
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

function saveIotToDisk() {
  try {
    ensureDataDir();

    const tempFile = `${IOT_FILE}.tmp`;
    const payload = JSON.stringify(toPersistableIotDevices(), null, 2);

    fs.writeFileSync(tempFile, payload, "utf8");
    fs.renameSync(tempFile, IOT_FILE);

    console.log("IoT tersimpan ke", IOT_FILE);
  } catch (error) {
    console.error("Gagal menyimpan IoT:", error.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveRoomsToDisk();
    saveIotToDisk();
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
        redoStack: Array.isArray(room.redoStack) ? room.redoStack : [],
        materials: Array.isArray(room.materials) ? room.materials : [],
        currentMaterialId: room.currentMaterialId || null,
        currentMaterialPage: Number(room.currentMaterialPage) || 1
      };
    });

    console.log("Board berhasil dimuat dari", DATA_FILE);
  } catch (error) {
    console.error("Gagal memuat board:", error.message);
  }
}

function loadIotFromDisk() {
  try {
    ensureDataDir();

    if (!fs.existsSync(IOT_FILE)) return;

    const raw = fs.readFileSync(IOT_FILE, "utf8");
    const parsed = JSON.parse(raw);

    Object.entries(parsed).forEach(([deviceId, device]) => {
      iotDevices[deviceId] = {
        ...device,
        online: false
      };
    });

    console.log("IoT berhasil dimuat dari", IOT_FILE);
  } catch (error) {
    console.error("Gagal memuat IoT:", error.message);
  }
}

function createRoomIfNotExists(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      splitMode: false,
      locked: false,
      strokes: [],
      redoStack: [],
      materials: [],
      currentMaterialId: null,
      currentMaterialPage: 1
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

  const allowedTypes = ["freehand", "shape", "text", "image"];
  const type = allowedTypes.includes(rawStroke.type)
    ? rawStroke.type
    : "freehand";

  const allowedTools = ["pen", "line", "rect", "circle", "text", "image"];
  const tool = allowedTools.includes(rawStroke.tool)
    ? rawStroke.tool
    : "pen";

  const allowedShapes = ["line", "rect", "circle"];
  const shape = allowedShapes.includes(rawStroke.shape)
    ? rawStroke.shape
    : null;

  const text = String(rawStroke.text || "").slice(0, 500);

  const rawSrc = String(rawStroke.src || "");
  const src =
    rawSrc.length <= MAX_IMAGE_DATA_URL_LENGTH
      ? rawSrc
      : "";

  const materialId = rawStroke.materialId ? String(rawStroke.materialId) : null;
  const pageNumber = Math.max(1, Number(rawStroke.pageNumber) || 1);

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
    src,
    materialId,
    pageNumber,
    color: String(
      rawStroke.color ||
      (socket.role === "teacher" ? "#111827" : "#2563eb")
    ),
    size: Math.max(1, Math.min(40, Number(rawStroke.size) || 3)),
    fontSize: Math.max(10, Math.min(96, Number(rawStroke.fontSize) || 28)),
    width: Math.max(1, Math.min(1280, Number(rawStroke.width) || 240)),
    height: Math.max(1, Math.min(720, Number(rawStroke.height) || 160)),
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

  if (stroke.type === "image") {
    return (
      typeof stroke.src === "string" &&
      stroke.src.startsWith("data:image/") &&
      stroke.points.length >= 1 &&
      stroke.width > 0 &&
      stroke.height > 0
    );
  }

  return false;
}

function trimRoomIfNeeded(room) {
  if (!Array.isArray(room.strokes)) room.strokes = [];

  if (room.strokes.length > MAX_STROKES_PER_ROOM) {
    room.strokes = room.strokes.slice(-MAX_STROKES_PER_ROOM);
  }
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Format file tidak valid.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function getExtensionFromMime(mimeType, filename = "") {
  const lowerName = String(filename).toLowerCase();

  if (lowerName.endsWith(".pdf")) return ".pdf";
  if (lowerName.endsWith(".ppt")) return ".ppt";
  if (lowerName.endsWith(".pptx")) return ".pptx";

  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "application/vnd.ms-powerpoint") return ".ppt";

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return ".pptx";
  }

  return "";
}

function isAllowedMaterialType(mimeType, filename) {
  const ext = getExtensionFromMime(mimeType, filename);

  return [".pdf", ".ppt", ".pptx"].includes(ext);
}

function getMaterialUrl(roomId, storedName) {
  return `/materials/${encodeURIComponent(safeRoomId(roomId))}/${encodeURIComponent(storedName)}`;
}

function getCurrentMaterial(roomId) {
  const room = rooms[roomId];

  if (!room || !room.currentMaterialId) return null;

  return room.materials.find((m) => m.id === room.currentMaterialId) || null;
}

/* MATERIAL FILE SERVE */

app.get("/materials/:roomId/:fileName", (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  const fileName = sanitizeFilePart(req.params.fileName);

  const filePath = path.join(MATERIALS_DIR, roomId, fileName);
  const resolved = path.resolve(filePath);
  const allowedRoot = path.resolve(path.join(MATERIALS_DIR, roomId));

  if (!resolved.startsWith(allowedRoot)) {
    return res.status(403).send("Forbidden");
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).send("File not found");
  }

  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".pdf") {
    res.setHeader("Content-Type", "application/pdf");
  }

  if (ext === ".ppt") {
    res.setHeader("Content-Type", "application/vnd.ms-powerpoint");
  }

  if (ext === ".pptx") {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  }

  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.sendFile(resolved);
});

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
  const imageCount = strokes.filter((s) => s.type === "image").length;

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
    imageCount,
    materialCount: Array.isArray(room.materials) ? room.materials.length : 0,
    currentMaterialId: room.currentMaterialId || null,
    currentMaterialPage: Number(room.currentMaterialPage) || 1,
    iotDevices: Object.values(iotDevices).filter((d) => d.roomId === roomId).length,
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
    iotFile: IOT_FILE,
    materialsDir: MATERIALS_DIR,
    dataFileExists: fs.existsSync(DATA_FILE),
    iotFileExists: fs.existsSync(IOT_FILE),
    roomCount: Object.keys(rooms).length,
    iotDeviceCount: Object.keys(iotDevices).length
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

  res.json({ rooms: summaries });
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
    strokes: rooms[roomId].strokes,
    materials: rooms[roomId].materials,
    currentMaterial: getCurrentMaterial(roomId),
    currentMaterialPage: Number(rooms[roomId].currentMaterialPage) || 1
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

  io.to(roomId).emit("room-deleted", { roomId });

  res.json({
    ok: true,
    message: `Room ${roomId} berhasil dihapus.`
  });
});

app.post("/api/admin/save", requireAdmin, (req, res) => {
  saveRoomsToDisk();
  saveIotToDisk();

  res.json({
    ok: true,
    message: "Data board dan IoT berhasil disimpan manual."
  });
});

/* MATERIAL API */

app.post("/api/materials/upload", (req, res) => {
  try {
    const roomId = String(req.body.roomId || "default").trim();
    const username = String(req.body.username || "User").trim();
    const role = req.body.role === "teacher" ? "teacher" : "student";

    createRoomIfNotExists(roomId);

    const filename = String(req.body.filename || "material");
    const dataUrl = String(req.body.dataUrl || "");

    if (!dataUrl || dataUrl.length > MAX_MATERIAL_DATA_URL_LENGTH) {
      return res.status(400).json({
        error: "File terlalu besar atau tidak valid."
      });
    }

    const { mimeType, buffer } = dataUrlToBuffer(dataUrl);

    if (!isAllowedMaterialType(mimeType, filename)) {
      return res.status(400).json({
        error: "Hanya file PDF, PPT, atau PPTX yang diperbolehkan."
      });
    }

    const ext = getExtensionFromMime(mimeType, filename);
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    const cleanBaseName = sanitizeFilePart(path.basename(filename, path.extname(filename))) || "material";
    const storedName = `${id}-${cleanBaseName}${ext}`;

    const dir = ensureMaterialRoomDir(roomId);
    const filePath = path.join(dir, storedName);

    fs.writeFileSync(filePath, buffer);

    const material = {
      id,
      roomId,
      filename,
      storedName,
      mimeType,
      sizeBytes: buffer.length,
      url: getMaterialUrl(roomId, storedName),
      uploadedBy: username,
      uploadedRole: role,
      uploadedAt: Date.now()
    };

    rooms[roomId].materials.push(material);
    rooms[roomId].currentMaterialId = material.id;
    rooms[roomId].currentMaterialPage = 1;

    scheduleSave();

    io.to(roomId).emit("material-list", {
      materials: rooms[roomId].materials,
      currentMaterialId: rooms[roomId].currentMaterialId,
      currentMaterialPage: rooms[roomId].currentMaterialPage,
      currentMaterial: material
    });

    io.to(roomId).emit("material-set", {
      material,
      materials: rooms[roomId].materials,
      pageNumber: 1
    });

    res.json({
      ok: true,
      material,
      materials: rooms[roomId].materials,
      currentMaterialPage: 1
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Gagal upload materi."
    });
  }
});

app.post("/api/materials/set-current", (req, res) => {
  const roomId = String(req.body.roomId || "default").trim();
  const materialId = String(req.body.materialId || "");

  createRoomIfNotExists(roomId);

  const material = rooms[roomId].materials.find((m) => m.id === materialId);

  if (!material) {
    return res.status(404).json({
      error: "Materi tidak ditemukan."
    });
  }

  rooms[roomId].currentMaterialId = material.id;
  rooms[roomId].currentMaterialPage = 1;

  scheduleSave();

  io.to(roomId).emit("material-set", {
    material,
    materials: rooms[roomId].materials,
    pageNumber: 1
  });

  res.json({
    ok: true,
    material,
    materials: rooms[roomId].materials,
    pageNumber: 1
  });
});

app.post("/api/materials/set-page", (req, res) => {
  const roomId = String(req.body.roomId || "default").trim();
  const materialId = String(req.body.materialId || "");
  const pageNumber = Math.max(1, Number(req.body.pageNumber) || 1);

  createRoomIfNotExists(roomId);

  const material = rooms[roomId].materials.find((m) => m.id === materialId);

  if (!material) {
    return res.status(404).json({
      error: "Materi tidak ditemukan."
    });
  }

  rooms[roomId].currentMaterialId = material.id;
  rooms[roomId].currentMaterialPage = pageNumber;

  scheduleSave();

  io.to(roomId).emit("material-page-set", {
    materialId,
    pageNumber
  });

  res.json({
    ok: true,
    materialId,
    pageNumber
  });
});

app.post("/api/materials/clear-current", (req, res) => {
  const roomId = String(req.body.roomId || "default").trim();

  createRoomIfNotExists(roomId);

  rooms[roomId].currentMaterialId = null;
  rooms[roomId].currentMaterialPage = 1;

  scheduleSave();

  io.to(roomId).emit("material-clear");

  res.json({ ok: true });
});

/* IOT HELPERS */

function checkIotToken(req) {
  const expected = process.env.IOT_DEVICE_TOKEN || "";
  const given = req.headers["x-device-token"] || req.body.token || "";

  if (!expected) return true;

  return given === expected;
}

function isDeviceOnline(device) {
  if (!device || !device.lastSeen) return false;

  return Date.now() - Number(device.lastSeen) <= IOT_OFFLINE_AFTER_MS;
}

function getIotDeviceSummary(device) {
  const online = isDeviceOnline(device);

  return {
    ...device,
    online,
    ageMs: device.lastSeen ? Date.now() - Number(device.lastSeen) : null
  };
}

function getAllIotSummaries() {
  return Object.values(iotDevices)
    .map(getIotDeviceSummary)
    .sort((a, b) => {
      const aa = Number(a.lastSeen) || 0;
      const bb = Number(b.lastSeen) || 0;
      return bb - aa;
    });
}

function broadcastIotUpdate(device) {
  const summary = getIotDeviceSummary(device);

  io.emit("iot-devices-update", {
    devices: getAllIotSummaries()
  });

  if (summary.roomId) {
    io.to(summary.roomId).emit("iot-status", summary);
  }
}

/* IOT DEVICE API */

app.post("/api/iot/heartbeat", (req, res) => {
  if (!checkIotToken(req)) {
    return res.status(401).json({
      error: "Token IoT salah."
    });
  }

  const deviceId = String(req.body.deviceId || "").trim();

  if (!deviceId) {
    return res.status(400).json({
      error: "deviceId wajib diisi."
    });
  }

  const roomId = String(req.body.roomId || "default").trim();
  const name = String(req.body.name || deviceId).trim();

  createRoomIfNotExists(roomId);

  const existing = iotDevices[deviceId] || {};

  const device = {
    ...existing,
    deviceId,
    roomId,
    name,
    firmware: String(req.body.firmware || existing.firmware || ""),
    ip: String(req.body.ip || existing.ip || ""),
    mac: String(req.body.mac || existing.mac || ""),
    rssi: Number(req.body.rssi || 0),
    uptimeMs: Number(req.body.uptimeMs || 0),
    freeHeap: Number(req.body.freeHeap || 0),
    state: typeof req.body.state === "object" && req.body.state ? req.body.state : existing.state || {},
    lastSeen: Date.now(),
    firstSeen: existing.firstSeen || Date.now(),
    lastAck: existing.lastAck || null,
    lastCommandResult: existing.lastCommandResult || null,
    pendingCommand: existing.pendingCommand || null
  };

  const command = device.pendingCommand || null;

  if (command) {
    device.lastCommandDeliveredAt = Date.now();
    device.pendingCommand = null;
  }

  iotDevices[deviceId] = device;

  scheduleSave();
  broadcastIotUpdate(device);

  res.json({
    ok: true,
    serverTime: Date.now(),
    device: getIotDeviceSummary(device),
    command
  });
});

app.post("/api/iot/ack", (req, res) => {
  if (!checkIotToken(req)) {
    return res.status(401).json({
      error: "Token IoT salah."
    });
  }

  const deviceId = String(req.body.deviceId || "").trim();

  if (!deviceId || !iotDevices[deviceId]) {
    return res.status(404).json({
      error: "Device tidak ditemukan."
    });
  }

  const device = iotDevices[deviceId];

  device.lastAck = {
    commandId: String(req.body.commandId || ""),
    command: String(req.body.command || ""),
    ok: Boolean(req.body.ok),
    message: String(req.body.message || ""),
    at: Date.now()
  };

  device.lastCommandResult = device.lastAck;

  if (typeof req.body.state === "object" && req.body.state) {
    device.state = req.body.state;
  }

  device.lastSeen = Date.now();

  scheduleSave();
  broadcastIotUpdate(device);

  res.json({
    ok: true,
    device: getIotDeviceSummary(device)
  });
});

/* IOT ADMIN API */

app.get("/api/admin/iot/devices", requireAdmin, (req, res) => {
  res.json({
    devices: getAllIotSummaries()
  });
});

app.post("/api/admin/iot/:deviceId/control", requireAdmin, (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();

  const device = iotDevices[deviceId];

  if (!device) {
    return res.status(404).json({
      error: "Device tidak ditemukan."
    });
  }

  const command = String(req.body.command || "").trim();
  const payload =
    typeof req.body.payload === "object" && req.body.payload
      ? req.body.payload
      : {};

  if (!command) {
    return res.status(400).json({
      error: "Command wajib diisi."
    });
  }

  const pendingCommand = {
    id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
    command,
    payload,
    createdAt: Date.now()
  };

  device.pendingCommand = pendingCommand;
  device.lastCommandQueuedAt = Date.now();

  scheduleSave();
  broadcastIotUpdate(device);

  res.json({
    ok: true,
    device: getIotDeviceSummary(device),
    pendingCommand
  });
});

app.post("/api/admin/iot/:deviceId/bind", requireAdmin, (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();

  const device = iotDevices[deviceId];

  if (!device) {
    return res.status(404).json({
      error: "Device tidak ditemukan."
    });
  }

  const roomId = String(req.body.roomId || device.roomId || "default").trim();
  const name = String(req.body.name || device.name || deviceId).trim();

  createRoomIfNotExists(roomId);

  device.roomId = roomId;
  device.name = name;
  device.updatedAt = Date.now();

  scheduleSave();
  broadcastIotUpdate(device);

  res.json({
    ok: true,
    device: getIotDeviceSummary(device)
  });
});

app.delete("/api/admin/iot/:deviceId", requireAdmin, (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();

  if (!iotDevices[deviceId]) {
    return res.status(404).json({
      error: "Device tidak ditemukan."
    });
  }

  delete iotDevices[deviceId];

  scheduleSave();

  io.emit("iot-devices-update", {
    devices: getAllIotSummaries()
  });

  res.json({
    ok: true
  });
});

/* SOCKET.IO */

loadRoomsFromDisk();
loadIotFromDisk();

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
      locked: rooms[roomId].locked,
      materials: rooms[roomId].materials,
      currentMaterialId: rooms[roomId].currentMaterialId,
      currentMaterialPage: Number(rooms[roomId].currentMaterialPage) || 1,
      currentMaterial: getCurrentMaterial(roomId)
    });

    socket.emit("iot-devices-update", {
      devices: getAllIotSummaries()
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

    io.to(roomId).emit("stroke-remove", { strokeId });
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

setInterval(() => {
  io.emit("iot-devices-update", {
    devices: getAllIotSummaries()
  });
}, 5000);

function shutdown() {
  console.log("Menyimpan board sebelum server berhenti...");

  saveRoomsToDisk();
  saveIotToDisk();

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