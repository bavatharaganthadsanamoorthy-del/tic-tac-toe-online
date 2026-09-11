"use strict";

/* ============================================================================
   Small DOM helpers
   ========================================================================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================================
   Sound engine — everything synthesized with WebAudio oscillators.
   No external/copyrighted audio assets are used anywhere.
   ========================================================================== */
const Sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem("ttt_muted") === "1";

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, duration, { type = "sine", delay = 0, volume = 0.18 } = {}) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const startTime = c.currentTime + delay;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  return {
    isMuted: () => muted,
    setMuted(v) {
      muted = v;
      localStorage.setItem("ttt_muted", v ? "1" : "0");
    },
    unlock() { ensureCtx(); },
    click() { tone(520, 0.08, { type: "square", volume: 0.08 }); },
    placeX() { tone(660, 0.14, { type: "triangle", volume: 0.16 }); },
    placeO() { tone(392, 0.16, { type: "sine", volume: 0.16 }); },
    invalid() { tone(180, 0.12, { type: "sawtooth", volume: 0.1 }); },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(f, 0.28, { delay: i * 0.09, type: "triangle", volume: 0.17 })
      );
    },
    draw() {
      tone(300, 0.22, { volume: 0.14 });
      tone(240, 0.3, { delay: 0.12, volume: 0.14 });
    },
    join() {
      tone(440, 0.12, { volume: 0.15 });
      tone(660, 0.18, { delay: 0.1, volume: 0.15 });
    },
    disconnect() {
      tone(400, 0.16, { volume: 0.13 });
      tone(260, 0.22, { delay: 0.1, volume: 0.13 });
    },
  };
})();

/* ============================================================================
   Screen navigation
   ========================================================================== */
function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) {
    Sound.unlock();
    Sound.click();
    showScreen(navBtn.dataset.nav);
  }
});

/* ============================================================================
   Toast
   ========================================================================== */
let toastTimer = null;
function showToast(message, { danger = false, duration = 2600 } = {}) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("toast--danger", danger);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

/* ============================================================================
   Win-line geometry (for the SVG overlay drawn across winning cells)
   ========================================================================== */
const LINE_COORDS = {
  "0,1,2": [50, 50, 250, 50],
  "3,4,5": [50, 150, 250, 150],
  "6,7,8": [50, 250, 250, 250],
  "0,3,6": [50, 50, 50, 250],
  "1,4,7": [150, 50, 150, 250],
  "2,5,8": [250, 50, 250, 250],
  "0,4,8": [35, 35, 265, 265],
  "2,4,6": [265, 35, 35, 265],
};

function drawWinLine(line) {
  const svg = $("#winLine");
  const el = $("#winLineEl");
  if (!line) {
    svg.classList.remove("show");
    return;
  }
  const coords = LINE_COORDS[line.join(",")];
  if (!coords) return;
  el.setAttribute("x1", coords[0]);
  el.setAttribute("y1", coords[1]);
  el.setAttribute("x2", coords[2]);
  el.setAttribute("y2", coords[3]);
  svg.classList.add("show");
}

/* ============================================================================
   Shared board rendering
   Both online multiplayer and the AI mode funnel through this renderer, given
   a plain state object: { board, turn, winner, winningLine, isDraw, scores,
   names: {X,O}, statuses: {X,O} (optional), mySymbol (optional) }
   ========================================================================== */
const cells = $$(".cell");
let prevBoardSnapshot = Array(9).fill(null);
let roundResultHandled = false;

function renderState(state, { interactive, onCellClick, showRoomPill, roomCode }) {
  // Board cells
  state.board.forEach((val, i) => {
    const cell = cells[i];
    const wasEmpty = prevBoardSnapshot[i] === null;
    cell.textContent = val === "X" ? "\u2715" : val === "O" ? "\u25EF" : "";
    cell.classList.toggle("filled", !!val);
    cell.classList.remove("x", "o");
    if (val) cell.classList.add(val.toLowerCase());
    if (val && wasEmpty) {
      cell.classList.remove("pop");
      // restart animation
      void cell.offsetWidth;
      cell.classList.add("pop");
    }
    cell.classList.remove("win-cell");
  });

  const gameOver = !!(state.winner || state.isDraw);
  cells.forEach((cell, i) => {
    const filled = !!state.board[i];
    cell.disabled = !interactive || filled || gameOver;
  });

  if (state.winningLine) {
    state.winningLine.forEach((i) => cells[i].classList.add("win-cell"));
    drawWinLine(state.winningLine);
  } else {
    drawWinLine(null);
  }

  // Scoreboard
  $("#scoreX").textContent = state.scores.X;
  $("#scoreO").textContent = state.scores.O;
  $("#scoreDraws").textContent = state.scores.draws;

  // Player names & status
  $("#playerNameX").textContent = state.names.X || "Player X";
  $("#playerNameO").textContent = state.names.O || "Player O";
  $("#playerCardX").classList.toggle("is-active", state.turn === "X" && !gameOver);
  $("#playerCardO").classList.toggle("is-active", state.turn === "O" && !gameOver);

  if (state.statuses) {
    const sx = $("#playerStatusX");
    const so = $("#playerStatusO");
    sx.classList.remove("online", "offline");
    so.classList.remove("online", "offline");
    if (state.statuses.X != null) sx.classList.add(state.statuses.X ? "online" : "offline");
    if (state.statuses.O != null) so.classList.add(state.statuses.O ? "online" : "offline");
  }

  // Turn indicator
  const indicator = $("#turnIndicator");
  if (state.waitingForOpponent) {
    indicator.innerHTML = "Waiting for opponent to join\u2026";
  } else if (state.winner) {
    indicator.innerHTML = `<strong class="${state.winner.toLowerCase()}">${state.winner}</strong> wins!`;
  } else if (state.isDraw) {
    indicator.innerHTML = "It's a draw!";
  } else {
    const whoText = state.mySymbol
      ? state.turn === state.mySymbol
        ? "Your turn"
        : "Opponent's turn"
      : `${state.turn}'s turn`;
    indicator.innerHTML = `<strong class="${state.turn.toLowerCase()}">${state.turn === "X" ? "\u2715" : "\u25EF"}</strong> ${whoText}`;
  }

  // Room pill
  $("#roomPill").classList.toggle("hidden", !showRoomPill);
  if (showRoomPill) $("#roomPillCode").textContent = roomCode;

  prevBoardSnapshot = state.board.slice();

  // Attach click handling (idempotent replace)
  cells.forEach((cell, i) => {
    cell.onclick = () => {
      if (cell.disabled) return;
      onCellClick(i);
    };
  });
}

function pushHistoryChip(result) {
  const history = $("#history");
  const chip = document.createElement("span");
  chip.className =
    "history__chip " +
    (result === "draw" ? "history__chip--draw" : `history__chip--${result.toLowerCase()}`);
  chip.textContent = result === "draw" ? "\u2013" : result;
  history.appendChild(chip);
  // Keep the strip from growing forever
  while (history.children.length > 20) history.removeChild(history.firstChild);
}

function showOverlay({ result, subtitle, showRematch, rematchState }) {
  const overlay = $("#overlay");
  const resultEl = $("#overlayResult");
  resultEl.className = "overlay__result " + (result === "draw" ? "draw" : result.toLowerCase());
  resultEl.textContent = result === "draw" ? "It's a Draw" : `${result} Wins!`;
  $("#overlaySub").textContent = subtitle || "";
  $("#rematchBtn").classList.toggle("hidden", !showRematch);
  $("#rematchStatus").classList.add("hidden");
  overlay.classList.remove("hidden");
}
function hideOverlay() {
  $("#overlay").classList.add("hidden");
}

function maybeHandleRoundEnd(state) {
  if (roundResultHandled) return;
  if (state.winner) {
    roundResultHandled = true;
    Sound.win();
    pushHistoryChip(state.winner);
  } else if (state.isDraw) {
    roundResultHandled = true;
    Sound.draw();
    pushHistoryChip("draw");
  }
}

/* ============================================================================
   Local AI engine (Play vs Computer) — pure client-side minimax
   ========================================================================== */
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function evaluateBoard(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((v) => v !== null)) return { winner: null, line: null, draw: true };
  return { winner: null, line: null, draw: false };
}

function findWinningMove(board, symbol) {
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    const copy = board.slice();
    copy[i] = symbol;
    if (evaluateBoard(copy).winner === symbol) return i;
  }
  return null;
}

function minimax(board, isMaximizing, aiSymbol, humanSymbol, depth) {
  const result = evaluateBoard(board);
  if (result.winner === aiSymbol) return { score: 10 - depth };
  if (result.winner === humanSymbol) return { score: depth - 10 };
  if (result.draw) return { score: 0 };

  const symbol = isMaximizing ? aiSymbol : humanSymbol;
  let best = null;
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    const copy = board.slice();
    copy[i] = symbol;
    const { score } = minimax(copy, !isMaximizing, aiSymbol, humanSymbol, depth + 1);
    if (best === null || (isMaximizing ? score > best.score : score < best.score)) {
      best = { score, index: i };
    }
  }
  return best || { score: 0, index: null };
}

function getAiMove(board, difficulty, aiSymbol, humanSymbol) {
  const empty = board.map((v, i) => (v === null ? i : null)).filter((v) => v !== null);
  if (empty.length === 0) return null;

  if (difficulty === "easy") {
    return empty[Math.floor(Math.random() * empty.length)];
  }

  const winMove = findWinningMove(board, aiSymbol);
  const blockMove = findWinningMove(board, humanSymbol);

  if (difficulty === "medium") {
    if (winMove !== null) return winMove;
    if (blockMove !== null && Math.random() < 0.7) return blockMove;
    if (Math.random() < 0.5) return minimax(board, true, aiSymbol, humanSymbol, 0).index;
    return empty[Math.floor(Math.random() * empty.length)];
  }

  // hard
  if (winMove !== null) return winMove;
  if (blockMove !== null) return blockMove;
  return minimax(board, true, aiSymbol, humanSymbol, 0).index;
}

/* ============================================================================
   AI mode controller
   ========================================================================== */
const AiGame = (() => {
  let board, turn, winner, winningLine, isDraw;
  let scores = { X: 0, O: 0, draws: 0 };
  let humanSymbol = "X";
  let aiSymbol = "O";
  let difficulty = "medium";
  let active = false;

  function reset() {
    board = Array(9).fill(null);
    turn = "X";
    winner = null;
    winningLine = null;
    isDraw = false;
    roundResultHandled = false;
    prevBoardSnapshot = Array(9).fill(null);
    hideOverlay();
    render();
    if (turn === aiSymbol) setTimeout(aiTurn, 450);
  }

  function start(diff, symbol) {
    difficulty = diff;
    humanSymbol = symbol;
    aiSymbol = symbol === "X" ? "O" : "X";
    active = true;
    reset();
  }

  function render() {
    renderState(
      {
        board,
        turn,
        winner,
        winningLine,
        isDraw,
        scores,
        names: { X: humanSymbol === "X" ? "You" : "Computer", O: humanSymbol === "O" ? "You" : "Computer" },
        mySymbol: humanSymbol,
      },
      {
        interactive: turn === humanSymbol && !winner && !isDraw,
        onCellClick: handleHumanMove,
        showRoomPill: false,
      }
    );
    maybeHandleRoundEnd({ winner, isDraw });
    if (winner || isDraw) {
      setTimeout(() => {
        showOverlay({
          result: winner || "draw",
          subtitle: winner
            ? winner === humanSymbol
              ? "You win!"
              : "The computer wins this round."
            : "Nobody wins this round.",
          showRematch: true,
        });
      }, winner ? 500 : 300);
    }
  }

  function commitMove(index, symbol) {
    board[index] = symbol;
    symbol === "X" ? Sound.placeX() : Sound.placeO();
    const result = evaluateBoard(board);
    if (result.winner) {
      winner = result.winner;
      winningLine = result.line;
      scores[winner] += 1;
    } else if (result.draw) {
      isDraw = true;
      scores.draws += 1;
    } else {
      turn = turn === "X" ? "O" : "X";
    }
    render();
    if (!winner && !isDraw && turn === aiSymbol) {
      setTimeout(aiTurn, 500);
    }
  }

  function handleHumanMove(index) {
    if (turn !== humanSymbol || board[index] !== null || winner || isDraw) {
      Sound.invalid();
      return;
    }
    commitMove(index, humanSymbol);
  }

  function aiTurn() {
    if (winner || isDraw) return;
    const move = getAiMove(board, difficulty, aiSymbol, humanSymbol);
    if (move !== null) commitMove(move, aiSymbol);
  }

  function rematch() {
    reset();
  }

  function resetScore() {
    scores = { X: 0, O: 0, draws: 0 };
    $("#history").innerHTML = "";
    render();
  }

  return {
    start,
    rematch,
    resetScore,
    isActive: () => active,
    deactivate: () => { active = false; },
  };
})();

/* ============================================================================
   Online multiplayer controller
   ========================================================================== */
const OnlineGame = (() => {
  let socket = null;
  let roomCode = null;
  let mySymbol = null;
  let token = null;
  let active = false;
  let lastState = null;

  const SESSION_KEY = "ttt_session";

  function saveSession() {
    if (roomCode && token) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, token }));
    }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function connect() {
    socket = io({ autoConnect: true, reconnection: true });

    socket.on("connect", () => {
      setServerStatus("online");
      const saved = loadSession();
      if (saved && saved.roomCode && saved.token) {
        socket.emit("reconnectRoom", saved);
      }
    });

    socket.on("disconnect", () => setServerStatus("offline"));
    socket.on("connect_error", () => setServerStatus("offline"));

    socket.on("roomCreated", (payload) => {
      roomCode = payload.roomCode;
      mySymbol = payload.symbol;
      token = payload.token;
      saveSession();
      $("#roomCodeValue").textContent = roomCode;
      $("#createFormPanel").classList.add("hidden");
      $("#waitingPanel").classList.remove("hidden");
    });

    socket.on("joinError", ({ message }) => {
      const errEl = $("#joinError");
      if (errEl) {
        errEl.textContent = message;
        errEl.classList.remove("hidden");
      }
      clearSession();
    });

    socket.on("roomJoined", (payload) => {
      roomCode = payload.roomCode;
      mySymbol = payload.symbol;
      token = payload.token;
      saveSession();
      active = true;
      AiGame.deactivate();
      roundResultHandled = false;
      prevBoardSnapshot = Array(9).fill(null);
      $("#history").innerHTML = "";
      showScreen("game");
      applyState(payload.state);
      if (payload.reconnected) showToast("Reconnected to your game.");
    });

    socket.on("opponentJoined", (payload) => {
      Sound.join();
      showToast("Opponent joined \u2014 game on!");
      active = true;
      roundResultHandled = false;
      $("#history").innerHTML = "";
      showScreen("game");
      applyState(payload.state);
    });

    socket.on("opponentReconnected", (payload) => {
      showToast("Opponent reconnected.");
      applyState(payload.state);
    });

    socket.on("opponentDisconnected", (payload) => {
      Sound.disconnect();
      showToast("Opponent disconnected. They can reconnect with the same room code.", { danger: true, duration: 4000 });
      applyState(payload.state);
    });

    socket.on("gameState", (state) => applyState(state));

    socket.on("gameReset", (payload) => {
      roundResultHandled = false;
      prevBoardSnapshot = Array(9).fill(null);
      hideOverlay();
      applyState(payload.state);
    });

    socket.on("rematchStatus", ({ rematch }) => {
      const other = mySymbol === "X" ? "O" : "X";
      if (rematch[other] && !rematch[mySymbol]) {
        const statusEl = $("#rematchStatus");
        statusEl.textContent = "Your opponent wants a rematch.";
        statusEl.classList.remove("hidden");
      }
    });

    socket.on("errorMsg", ({ message }) => {
      Sound.invalid();
      showToast(message, { danger: true });
    });
  }

  function applyState(state) {
    lastState = state;
    const bothPresent = !!(state.players.X && state.players.O);
    renderState(
      {
        board: state.board,
        turn: state.turn,
        winner: state.winner,
        winningLine: state.winningLine,
        isDraw: state.isDraw,
        scores: state.scores,
        names: {
          X: state.players.X ? state.players.X.name : "Waiting\u2026",
          O: state.players.O ? state.players.O.name : "Waiting\u2026",
        },
        statuses: {
          X: state.players.X ? state.players.X.connected : null,
          O: state.players.O ? state.players.O.connected : null,
        },
        mySymbol,
        waitingForOpponent: !bothPresent,
      },
      {
        interactive: bothPresent && mySymbol === state.turn,
        onCellClick: handleCellClick,
        showRoomPill: true,
        roomCode,
      }
    );
    maybeHandleRoundEnd(state);
    if (state.winner || state.isDraw) {
      setTimeout(() => {
        showOverlay({
          result: state.winner || "draw",
          subtitle: state.winner
            ? state.winner === mySymbol
              ? "You win this round!"
              : "Your opponent wins this round."
            : "Board's full \u2014 nobody wins.",
          showRematch: true,
        });
      }, state.winner ? 500 : 300);
    }
  }

  function handleCellClick(index) {
    if (!lastState) return;
    if (lastState.turn !== mySymbol) {
      Sound.invalid();
      showToast("Wait for your turn.");
      return;
    }
    if (lastState.board[index] !== null) {
      Sound.invalid();
      return;
    }
    mySymbol === "X" ? Sound.placeX() : Sound.placeO();
    socket.emit("makeMove", { roomCode, index });
  }

  function createRoom(username) {
    if (!socket) connect();
    socket.emit("createRoom", { username });
  }

  function joinRoom(code, username) {
    if (!socket) connect();
    socket.emit("joinRoom", { roomCode: code, username });
  }

  function requestRematch() {
    socket.emit("requestRematch", { roomCode });
  }

  function leave() {
    if (socket) socket.emit("leaveRoom");
    clearSession();
    active = false;
    roomCode = null;
    mySymbol = null;
    token = null;
    lastState = null;
  }

  function isActive() {
    return active;
  }

  function tryResume() {
    connect();
  }

  return { createRoom, joinRoom, requestRematch, leave, isActive, tryResume };
})();

function setServerStatus(status) {
  const dot = $("#serverStatusDot");
  const text = $("#serverStatusText");
  dot.className = "dot dot--" + status;
  text.textContent =
    status === "online"
      ? "Server connected"
      : status === "offline"
      ? "Server unavailable \u2014 start server.js to play online"
      : "Connecting to server\u2026";
}

/* ============================================================================
   Wire up UI
   ========================================================================== */
function init() {
  // Sound toggle
  const soundBtn = $("#soundToggle");
  function refreshSoundIcon() {
    $("#iconSoundOn").hidden = Sound.isMuted();
    $("#iconSoundOff").hidden = !Sound.isMuted();
    soundBtn.title = Sound.isMuted() ? "Unmute sound" : "Mute sound";
  }
  refreshSoundIcon();
  soundBtn.addEventListener("click", () => {
    Sound.unlock();
    Sound.setMuted(!Sound.isMuted());
    refreshSoundIcon();
  });

  // Attempt server connection right away so the status pill is accurate.
  OnlineGame.tryResume();

  // ---- Create room ----
  $("#createRoomBtn").addEventListener("click", () => {
    Sound.unlock();
    const username = $("#createUsername").value.trim() || "Player 1";
    $("#createRoomBtn").disabled = true;
    OnlineGame.createRoom(username);
    setTimeout(() => ($("#createRoomBtn").disabled = false), 1200);
  });

  $("#copyRoomCodeBtn").addEventListener("click", () => {
    const code = $("#roomCodeValue").textContent;
    navigator.clipboard?.writeText(code).then(() => {
      const btn = $("#copyRoomCodeBtn");
      btn.classList.add("copied");
      showToast("Room code copied!");
      setTimeout(() => btn.classList.remove("copied"), 1200);
    }).catch(() => showToast("Couldn't copy \u2014 copy it manually."));
  });

  // ---- Join room ----
  $("#joinRoomCode").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  $("#joinRoomBtn").addEventListener("click", () => {
    Sound.unlock();
    const username = $("#joinUsername").value.trim() || "Player 2";
    const code = $("#joinRoomCode").value.trim();
    $("#joinError").classList.add("hidden");
    if (!code) {
      $("#joinError").textContent = "Enter a room code.";
      $("#joinError").classList.remove("hidden");
      return;
    }
    OnlineGame.joinRoom(code, username);
  });

  // ---- AI setup ----
  let selectedDifficulty = "medium";
  let selectedSymbol = "X";
  $("#difficultyRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    Sound.click();
    $$("#difficultyRow .choice").forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    selectedDifficulty = btn.dataset.diff;
  });
  $("#symbolRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    Sound.click();
    $$("#symbolRow .choice").forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    selectedSymbol = btn.dataset.symbol;
  });
  $("#startAiBtn").addEventListener("click", () => {
    Sound.unlock();
    OnlineGame.leave();
    $("#history").innerHTML = "";
    AiGame.start(selectedDifficulty, selectedSymbol);
    showScreen("game");
  });

  // ---- In-game actions ----
  $("#leaveGameBtn").addEventListener("click", () => {
    Sound.click();
    if (OnlineGame.isActive()) OnlineGame.leave();
    AiGame.deactivate();
    hideOverlay();
    showScreen("menu");
  });

  $("#menuFromOverlayBtn").addEventListener("click", () => {
    Sound.click();
    if (OnlineGame.isActive()) OnlineGame.leave();
    AiGame.deactivate();
    hideOverlay();
    showScreen("menu");
  });

  $("#rematchBtn").addEventListener("click", () => {
    Sound.click();
    if (OnlineGame.isActive()) {
      OnlineGame.requestRematch();
      $("#rematchBtn").disabled = true;
      $("#rematchStatus").textContent = "Waiting for opponent to accept\u2026";
      $("#rematchStatus").classList.remove("hidden");
      setTimeout(() => ($("#rematchBtn").disabled = false), 3000);
    } else {
      hideOverlay();
      AiGame.rematch();
    }
  });

  $("#newGameBtn").addEventListener("click", () => {
    Sound.click();
    if (OnlineGame.isActive()) {
      OnlineGame.requestRematch();
    } else {
      AiGame.rematch();
    }
  });

  $("#resetScoreBtn").addEventListener("click", () => {
    Sound.click();
    if (!OnlineGame.isActive()) AiGame.resetScore();
    else showToast("Scores reset when both players agree to a rematch series ending \u2014 for now, scores track this session.");
  });

  // Prevent double-tap zoom on the board specifically (extra safety on top of viewport meta)
  let lastTouch = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouch < 300 && e.target.closest(".board")) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
}

document.addEventListener("DOMContentLoaded", init);
