/**
 * server.js
 * Authoritative Tic-Tac-Toe multiplayer server.
 *
 * The server owns the truth: board state, turn order, win/draw detection,
 * and score. Clients only ever send an intent ("I want to play square 4"),
 * never a state. Every intent is re-validated here before anything changes,
 * so a modified/hacked client cannot cheat.
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// In-memory room store.
//
// rooms[code] = {
//   code, board: Array(9) of 'X'|'O'|null,
//   turn: 'X'|'O',
//   winner: 'X'|'O'|null,
//   winningLine: [i,i,i]|null,
//   isDraw: boolean,
//   scores: { X: n, O: n, draws: n },
//   players: {
//     X: { token, socketId, name, connected } | null,
//     O: { token, socketId, name, connected } | null
//   },
//   rematch: { X: bool, O: bool },
//   createdAt: number
// }
// ---------------------------------------------------------------------------
const rooms = new Map();

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // clean up abandoned rooms after 6h

function generateRoomCode() {
  let code;
  do {
    code = Array.from(
      { length: 5 },
      () => ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return crypto.randomBytes(16).toString("hex");
}

function freshBoard() {
  return Array(9).fill(null);
}

function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    board: freshBoard(),
    turn: "X",
    winner: null,
    winningLine: null,
    isDraw: false,
    scores: { X: 0, O: 0, draws: 0 },
    players: { X: null, O: null },
    rematch: { X: false, O: false },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];

function checkWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { winner: null, line: null, draw: true };
  }
  return null;
}

function sanitizeUsername(name) {
  if (typeof name !== "string") return "Player";
  const trimmed = name.trim().slice(0, 16);
  return trimmed.length ? trimmed : "Player";
}

function publicPlayers(room) {
  return {
    X: room.players.X
      ? { name: room.players.X.name, connected: room.players.X.connected }
      : null,
    O: room.players.O
      ? { name: room.players.O.name, connected: room.players.O.connected }
      : null,
  };
}

function publicState(room) {
  return {
    roomCode: room.code,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winningLine: room.winningLine,
    isDraw: room.isDraw,
    scores: room.scores,
    players: publicPlayers(room),
  };
}

function broadcastState(room) {
  io.to(room.code).emit("gameState", publicState(room));
}

function otherSymbol(sym) {
  return sym === "X" ? "O" : "X";
}

// Periodically sweep abandoned rooms (both seats empty, or too old & finished).
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const bothEmpty = !room.players.X && !room.players.O;
    const bothGone =
      (!room.players.X || !room.players.X.connected) &&
      (!room.players.O || !room.players.O.connected);
    if (bothEmpty || (bothGone && now - room.createdAt > ROOM_TTL_MS)) {
      rooms.delete(code);
    }
  }
}, 60 * 1000);

io.on("connection", (socket) => {
  // Track which room/symbol this socket currently occupies.
  let currentRoomCode = null;
  let currentSymbol = null;

  socket.on("createRoom", ({ username } = {}) => {
    const room = createRoom();
    const token = makeToken();
    const name = sanitizeUsername(username);

    room.players.X = { token, socketId: socket.id, name, connected: true };
    currentRoomCode = room.code;
    currentSymbol = "X";
    socket.join(room.code);

    socket.emit("roomCreated", {
      roomCode: room.code,
      symbol: "X",
      token,
      state: publicState(room),
    });
  });

  socket.on("joinRoom", ({ roomCode, username } = {}) => {
    const code = String(roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("joinError", { message: "That room code doesn't exist." });
      return;
    }

    // Find an open seat (prefer O, but allow rejoining an empty X seat too).
    let seat = null;
    if (!room.players.O) seat = "O";
    else if (!room.players.X) seat = "X";

    if (!seat) {
      socket.emit("joinError", { message: "That room is already full." });
      return;
    }

    const token = makeToken();
    const name = sanitizeUsername(username);
    room.players[seat] = { token, socketId: socket.id, name, connected: true };
    currentRoomCode = room.code;
    currentSymbol = seat;
    socket.join(room.code);

    socket.emit("roomJoined", {
      roomCode: room.code,
      symbol: seat,
      token,
      state: publicState(room),
    });

    // Let everyone (including the joiner, via room broadcast) know the room is live.
    broadcastState(room);
    socket.to(room.code).emit("opponentJoined", { state: publicState(room) });
  });

  socket.on("reconnectRoom", ({ roomCode, token } = {}) => {
    const code = String(roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("joinError", { message: "That room no longer exists." });
      return;
    }

    let seat = null;
    if (room.players.X && room.players.X.token === token) seat = "X";
    else if (room.players.O && room.players.O.token === token) seat = "O";

    if (!seat) {
      socket.emit("joinError", { message: "Could not reconnect to that room." });
      return;
    }

    room.players[seat].socketId = socket.id;
    room.players[seat].connected = true;
    currentRoomCode = room.code;
    currentSymbol = seat;
    socket.join(room.code);

    socket.emit("roomJoined", {
      roomCode: room.code,
      symbol: seat,
      token,
      state: publicState(room),
      reconnected: true,
    });
    socket.to(room.code).emit("opponentReconnected", { state: publicState(room) });
  });

  socket.on("makeMove", ({ roomCode, index } = {}) => {
    const code = String(roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("errorMsg", { message: "Room not found." });
      return;
    }
    if (currentRoomCode !== room.code || !currentSymbol) {
      socket.emit("errorMsg", { message: "You are not part of this room." });
      return;
    }
    if (!room.players.X || !room.players.O) {
      socket.emit("errorMsg", { message: "Waiting for both players to join." });
      return;
    }
    if (room.winner || room.isDraw) {
      socket.emit("errorMsg", { message: "This game has already ended." });
      return;
    }
    if (room.turn !== currentSymbol) {
      socket.emit("errorMsg", { message: "It is not your turn." });
      return;
    }
    if (
      typeof index !== "number" ||
      index < 0 ||
      index > 8 ||
      !Number.isInteger(index)
    ) {
      socket.emit("errorMsg", { message: "Invalid square." });
      return;
    }
    if (room.board[index] !== null) {
      socket.emit("errorMsg", { message: "That square is already taken." });
      return;
    }

    // All checks passed — commit the authoritative move.
    room.board[index] = currentSymbol;
    const result = checkWinner(room.board);

    if (result && result.winner) {
      room.winner = result.winner;
      room.winningLine = result.line;
      room.scores[result.winner] += 1;
    } else if (result && result.draw) {
      room.isDraw = true;
      room.scores.draws += 1;
    } else {
      room.turn = otherSymbol(currentSymbol);
    }

    broadcastState(room);
  });

  socket.on("requestRematch", ({ roomCode } = {}) => {
    const code = String(roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || currentRoomCode !== room.code || !currentSymbol) return;

    room.rematch[currentSymbol] = true;
    io.to(room.code).emit("rematchStatus", { rematch: room.rematch });

    if (room.rematch.X && room.rematch.O) {
      room.board = freshBoard();
      room.winner = null;
      room.winningLine = null;
      room.isDraw = false;
      room.turn = "X";
      room.rematch = { X: false, O: false };
      io.to(room.code).emit("gameReset", { state: publicState(room) });
    }
  });

  socket.on("leaveRoom", () => {
    handleDisconnect();
  });

  socket.on("disconnect", () => {
    handleDisconnect();
  });

  function handleDisconnect() {
    if (!currentRoomCode || !currentSymbol) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const player = room.players[currentSymbol];
    if (player && player.socketId === socket.id) {
      player.connected = false;
      socket.to(room.code).emit("opponentDisconnected", {
        symbol: currentSymbol,
        state: publicState(room),
      });
    }
    currentRoomCode = null;
    currentSymbol = null;
  }
});

server.listen(PORT, () => {
  console.log(`Tic-Tac-Toe server running at http://localhost:${PORT}`);
});
