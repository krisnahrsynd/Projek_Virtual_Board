const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

function createRoomIfNotExists(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      splitMode: false,
      locked: false,
      strokes: [],
      redoStack: []
    };
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
  return isTeacher(socket) || stroke.username === socket.username;
}

function normalizeStroke(socket, rawStroke) {
  const roomId = socket.roomId || rawStroke.roomId;

  const points = Array.isArray(rawStroke.points)
    ? rawStroke.points
        .filter((p) => typeof p.x === "number" && typeof p.y === "number")
        .slice(0, 5000)
    : [];

  return {
    id: String(rawStroke.id || Date.now() + "-" + Math.random()),
    roomId,
    username: socket.username,
    role: socket.role,
    tool: rawStroke.tool || "pen",
    color: rawStroke.color || (socket.role === "teacher" ? "#111827" : "#2563eb"),
    size: Number(rawStroke.size) || (socket.role === "teacher" ? 4 : 3),
    points,
    createdAt: rawStroke.createdAt || Date.now()
  };
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (data) => {
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

  socket.on("stroke-add", (rawStroke) => {
    const roomId = socket.roomId || rawStroke.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    if (room.locked && !isTeacher(socket)) return;

    const stroke = normalizeStroke(socket, rawStroke);

    if (stroke.points.length < 2) return;

    room.strokes.push(stroke);
    room.redoStack = [];

    socket.to(roomId).emit("stroke-add", stroke);
  });

  socket.on("erase-stroke", (data) => {
    const roomId = socket.roomId || data.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];
    const strokeId = String(data.strokeId);

    const index = room.strokes.findIndex((stroke) => stroke.id === strokeId);
    if (index === -1) return;

    const stroke = room.strokes[index];

    if (!canModifyStroke(socket, stroke)) return;

    room.strokes.splice(index, 1);

    io.to(roomId).emit("stroke-remove", {
      strokeId
    });
  });

  socket.on("undo", (data = {}) => {
    const roomId = socket.roomId || data.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    let index = -1;

    for (let i = room.strokes.length - 1; i >= 0; i--) {
      const stroke = room.strokes[i];

      if (isTeacher(socket) || stroke.username === socket.username) {
        index = i;
        break;
      }
    }

    if (index === -1) return;

    const [removedStroke] = room.strokes.splice(index, 1);
    room.redoStack.push(removedStroke);

    io.to(roomId).emit("stroke-remove", {
      strokeId: removedStroke.id
    });
  });

  socket.on("redo", (data = {}) => {
    const roomId = socket.roomId || data.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    const room = rooms[roomId];

    let index = -1;

    for (let i = room.redoStack.length - 1; i >= 0; i--) {
      const stroke = room.redoStack[i];

      if (isTeacher(socket) || stroke.username === socket.username) {
        index = i;
        break;
      }
    }

    if (index === -1) return;

    const [stroke] = room.redoStack.splice(index, 1);
    room.strokes.push(stroke);

    io.to(roomId).emit("stroke-add", stroke);
  });

  socket.on("clear", (roomIdFromClient) => {
    const roomId = socket.roomId || roomIdFromClient;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].strokes = [];
    rooms[roomId].redoStack = [];

    io.to(roomId).emit("clear");
  });

  socket.on("split-board", (data) => {
    const roomId = socket.roomId || data.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].splitMode = Boolean(data.splitMode);

    io.to(roomId).emit("split-board", {
      splitMode: rooms[roomId].splitMode
    });
  });

  socket.on("lock-board", (data) => {
    const roomId = socket.roomId || data.roomId;
    if (!roomId) return;

    createRoomIfNotExists(roomId);

    if (!isTeacher(socket)) return;

    rooms[roomId].locked = Boolean(data.locked);

    io.to(roomId).emit("lock-board", {
      locked: rooms[roomId].locked
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;

    if (roomId && rooms[roomId]) {
      delete rooms[roomId].users[socket.id];
      io.to(roomId).emit("room-users", getRoomUsers(roomId));
    }

    console.log("User disconnected:", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server berjalan di port", process.env.PORT || 3000);
});