const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static('public'));

const rooms = {};

// Helper function to generate a 4-letter room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create Room (Host)
  socket.on('create_room', (playerName) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      hostId: socket.id,
      status: 'LOBBY', // LOBBY, PLAYING, GAME_OVER
      lives: 6,
      timer: 60,
      timerInterval: null,
      players: [{ id: socket.id, name: playerName, currentGuess: null }],
      usedWords: []
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players, isHost: true });
  });

  // Join Existing Room
  socket.on('join_room', ({ roomId, playerName }) => {
    const code = roomId.trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      return socket.emit('error_message', 'Room not found!');
    }
    if (room.status !== 'LOBBY') {
      return socket.emit('error_message', 'Game has already started!');
    }
    if (room.players.length >= 15) {
      return socket.emit('error_message', 'Room is full!');
    }

    room.players.push({ id: socket.id, name: playerName, currentGuess: null });
    socket.join(code);

    io.to(code).emit('room_updated', {
      roomId: code,
      players: room.players,
      hostId: room.hostId
    });
  });

  // Start Game (Host only)
  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;

    room.status = 'PLAYING';
    startNewRound(roomId);
  });

  // Submit Guess
  socket.on('submit_guess', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING') return;

    const normalizedGuess = guess.trim().toLowerCase();

    // Check if word was used in previous rounds
    if (room.usedWords.includes(normalizedGuess)) {
      return socket.emit('error_message', `"${guess}" was already used! Guess a new word.`);
    }

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.currentGuess = normalizedGuess;
    }

    // Check if ALL players have submitted their guess
    const allSubmitted = room.players.every(p => p.currentGuess !== null);
    if (allSubmitted) {
      clearInterval(room.timerInterval);
      evaluateRound(roomId);
    } else {
      // Notify everyone how many players have submitted
      io.to(roomId).emit('update_submitted_count', {
        submittedCount: room.players.filter(p => p.currentGuess !== null).length,
        totalPlayers: room.players.length
      });
    }
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          clearInterval(room.timerInterval);
          delete rooms[roomId];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id; // Assign new host
          }
          io.to(roomId).emit('room_updated', {
            roomId,
            players: room.players,
            hostId: room.hostId
          });
        }
        break;
      }
    }
  });
});

// Helper: Start 60s Timer Round
function startNewRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.players.forEach(p => p.currentGuess = null);
  room.timer = 60;

  io.to(roomId).emit('round_start', {
    lives: room.lives,
    usedWords: room.usedWords,
    timer: room.timer
  });

  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timer -= 1;
    io.to(roomId).emit('timer_tick', room.timer);

    if (room.timer <= 0) {
      clearInterval(room.timerInterval);
      evaluateRound(roomId);
    }
  }, 1000);
}

// Helper: Evaluate Guesses
function evaluateRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const validGuesses = room.players.map(p => p.currentGuess ? p.currentGuess : "NO GUESS");
  const firstWord = validGuesses[0];

  // Check if ALL submitted words match and nobody timed out empty
  const isMatch = validGuesses.every(word => word !== "NO GUESS" && word === firstWord);

  const roundResults = room.players.map(p => ({
    name: p.name,
    guess: p.currentGuess || "Timed Out"
  }));

  if (isMatch) {
    room.status = 'GAME_OVER';
    io.to(roomId).emit('game_over', { win: true, word: firstWord, results: roundResults });
  } else {
    room.lives -= 1;
    // Record non-empty guesses into usedWords array
    validGuesses.forEach(w => {
      if (w !== "NO GUESS" && !room.usedWords.includes(w)) {
        room.usedWords.push(w);
      }
    });

    if (room.lives <= 0) {
      room.status = 'GAME_OVER';
      io.to(roomId).emit('game_over', { win: false, results: roundResults });
    } else {
      io.to(roomId).emit('round_result', {
        matched: false,
        results: roundResults,
        livesRemaining: room.lives,
        usedWords: room.usedWords
      });

      // Auto start next round after 5-second reveal delay
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].lives > 0) {
          startNewRound(roomId);
        }
      }, 5000);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});