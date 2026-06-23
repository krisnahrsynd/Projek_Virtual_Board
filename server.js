const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

function createRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      strokes: {}, // MAP instead of array
      history: [], // for undo
      redoStack: [],
      splitMode: false
    };
  }
}

function getRoomUsers(roomId) {
  if (!rooms[roomId]) return [];
  return Object.values(rooms[roomId].users);
}

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("join-room", ({ roomId, username, role }) => {
    createRoom(roomId);

    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = role;

    rooms[roomId].users[socket.id] = { username, role };

    socket.emit("board-state", {
      strokes: Object.values(rooms[roomId].strokes),
      splitMode: rooms[roomId].splitMode
    });

    io.to(roomId).emit("room-users", getRoomUsers(roomId));
  });

  // CREATE / UPDATE STROKE
  socket.on("stroke", (stroke) => {
    const room = rooms[stroke.roomId];
    if (!room) return;

    room.strokes[stroke.id] = stroke;
    room.history.push(stroke.id);

    io.to(stroke.roomId).emit("stroke", stroke);
  });

  // DELETE STROKE (ERASER)
  socket.on("erase", ({ roomId, strokeId }) => {
    const room = rooms[roomId];
    if (!room) return;

    delete room.strokes[strokeId];

    io.to(roomId).emit("erase", strokeId);
  });

  // UNDO
  socket.on("undo", (roomId) => {
    const room = rooms[roomId];
    if (!room || room.history.length === 0) return;

    const lastId = room.history.pop();
    const stroke = room.strokes[lastId];

    if (stroke) {
      delete room.strokes[lastId];
      room.redoStack.push(stroke);
      io.to(roomId).emit("erase", lastId);
    }
  });

  // REDO
  socket.on("redo", (roomId) => {
    const room = rooms[roomId];
    if (!room || room.redoStack.length === 0) return;

    const stroke = room.redoStack.pop();
    room.strokes[stroke.id] = stroke;
    room.history.push(stroke.id);

    io.to(roomId).emit("stroke", stroke);
  });

  socket.on("clear", (roomId) => {
    createRoom(roomId);

    rooms[roomId].strokes = {};
    rooms[roomId].history = [];
    rooms[roomId].redoStack = [];

    io.to(roomId).emit("clear");
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId].users[socket.id];
    io.to(roomId).emit("room-users", getRoomUsers(roomId));
  });
});

server.listen(3000, () => console.log("running"));