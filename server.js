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
      strokes: []
    };
  }
}

function getRoomUsers(roomId) {
  if (!rooms[roomId]) return [];
  return Object.values(rooms[roomId].users);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (data) => {
    const { roomId, username, role } = data;

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
      splitMode: rooms[roomId].splitMode
    });

    io.to(roomId).emit("room-users", getRoomUsers(roomId));

    console.log(`${username} joined room ${roomId} as ${role}`);
  });

  socket.on("draw", (data) => {
    const { roomId } = data;

    createRoomIfNotExists(roomId);

    rooms[roomId].strokes.push(data);

    socket.to(roomId).emit("draw", data);
  });

  socket.on("clear", (roomId) => {
    createRoomIfNotExists(roomId);

    rooms[roomId].strokes = [];

    io.to(roomId).emit("clear");
  });

  socket.on("split-board", (data) => {
    const { roomId, splitMode } = data;

    createRoomIfNotExists(roomId);

    rooms[roomId].splitMode = splitMode;

    io.to(roomId).emit("split-board", {
      splitMode
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;

    if (roomId && rooms[roomId]) {
      delete rooms[roomId].users[socket.id];

      io.to(roomId).emit("room-users", getRoomUsers(roomId));

      if (Object.keys(rooms[roomId].users).length === 0) {
        // Coretan tetap disimpan selama server hidup
        // Jangan delete room dulu agar state board tidak langsung hilang
      }
    }

    console.log("User disconnected:", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server berjalan di port", process.env.PORT || 3000);
});