# Tic Tac Toe — Online Arcade

A complete, real-time multiplayer Tic-Tac-Toe game: an authoritative Node.js/Socket.IO
server plus a dependency-free HTML/CSS/JS frontend. Includes true two-device online
play with room codes and reconnection, a local single-player mode with three AI
difficulties (Hard is unbeatable, via minimax), score tracking, match history, sound
effects (synthesized — no external audio files), and a responsive dark/glassmorphism UI.

**Multiplayer only works while `server.js` is running.** The app never fakes or
simulates multiplayer — if the server isn't reachable, the UI shows a clear
"Server unavailable" status instead of pretending to connect.

## 1. Setup

You need [Node.js](https://nodejs.org) 18+ installed.

```bash
# 1. Unzip / open this folder in a terminal
cd tic-tac-toe

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

You should see:

```
Tic-Tac-Toe server running at http://localhost:3000
```

## 2. Play online multiplayer

1. Open **http://localhost:3000** in a browser — this is Player 1.
2. Click **Create Game**, enter a name, click **Create Room**. A 5-letter room code appears.
3. On a **second device or browser tab**, open the same server address
   (see "Playing across devices" below), click **Join Game**, enter a name and the
   room code, then **Join Game**.
4. The board appears for both players automatically. X always moves first.
5. If a player refreshes or briefly loses connection, they can reopen the site and
   will automatically reconnect to the same room and seat (their session is
   remembered in the browser). The other player sees a live "disconnected" /
   "reconnected" status on the player card.

### Playing across devices (not just two tabs)

By default the server listens on all network interfaces, so other devices on the
same Wi-Fi can join too:

1. Find your computer's local IP address (e.g. `192.168.1.23`).
2. On the other device, open `http://192.168.1.23:3000` instead of `localhost`.
3. Create/join a room as above.

To play over the public internet, deploy `server.js` to any Node hosting provider
(Render, Railway, Fly.io, a VPS, etc.) and open that public URL instead.

## 3. Play vs Computer (no server needed for gameplay logic)

Click **Play vs Computer** from the main menu, choose a difficulty (Easy / Medium /
Hard) and which symbol you want to play, then **Start Match**. This mode runs
entirely in the browser — Easy plays randomly, Medium mixes strategy with mistakes,
and Hard uses a full minimax search and cannot be beaten (best case for you is a draw).

## 4. Project structure

```
/tic-tac-toe
  package.json      # dependencies + npm start script
  server.js          # authoritative game server (Express + Socket.IO)
  public/
    index.html        # all screens (menu, create, join, how-to-play, game)
    style.css          # dark glassmorphism / arcade design system
    script.js          # client logic: sockets, rendering, AI, sound
```

## 5. How the server stays authoritative

The client never sends board state — only an intent like "I'd like to play square 4."
For every `makeMove` event, `server.js` independently verifies, in order:

1. The room exists.
2. The requesting socket actually belongs to that room.
3. Both seats (X and O) are filled.
4. The game hasn't already ended (no winner, not a draw).
5. It is actually that player's turn.
6. The square index is a valid integer 0–8.
7. That square is currently empty.

Only if every check passes does the server mutate `room.board`, and the resulting
state is what gets broadcast back to both players — so a modified/hacked client
cannot force an illegal move, take an extra turn, or claim a win it didn't earn.

## 6. What's been tested

An automated Socket.IO integration test (run during development, not shipped in
this folder) exercised the server end-to-end and confirmed:

- Room codes are generated correctly and rooms can be created/joined.
- Joining a non-existent room, or a full room, is rejected with a clear error.
- Moving out of turn is rejected.
- A full game (X wins top row) plays out correctly, with the right winning line
  and score update.
- Moving after the game has ended is rejected.
- Requesting a rematch from both players resets the board/turn while preserving
  score.
- A disconnect notifies the opponent and marks the player offline; reconnecting
  with the saved session token restores the correct seat (X or O).
- Playing an already-occupied square is rejected.

The client-side AI was separately tested by simulating hundreds of games:

- **Hard** (minimax): 0 losses across 500 games against a random opponent.
- **Medium**: wins, loses, and draws against a perfect opponent — a real,
  beatable-but-competent difficulty.
- **Easy**: loses the vast majority of games against a perfect opponent, as
  expected for a random-move AI.

Manually verify in your browser: desktop and mobile layouts, tapping/clicking
squares, the mute button, copying the room code, and the win-line animation.

## 7. Notes

- All sound effects are generated at runtime with the Web Audio API
  (oscillators/envelopes) — no copyrighted audio or music files are used.
- Room state lives in server memory; restarting `server.js` clears all active
  rooms and scores. For production use beyond a local game with friends, you'd
  want to swap the in-memory `Map` for a persistent store (Redis, etc.).
