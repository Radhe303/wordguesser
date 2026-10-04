const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

const WORD_BANK = [
  "Elephant", "Pizza", "Eiffel Tower", "Bicycle", "Guitar", 
  "Aeroplane", "Helicopter", "Penguin", "Sunflower", "Smartphone",
  "Cat", "Dog", "Ice Cream", "Tree", "Car", "Computer", "Taj Mahal", "Pyramid"
];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. CREATE ROOM
  socket.on('create_room', ({ playerName, gameType }) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      hostId: socket.id,
      gameType: gameType || 'mind_reader',
      status: 'LOBBY',
      players: [{ id: socket.id, name: playerName, currentGuess: null, vote: null }],
      
      // Mind Reader State
      lives: 6,
      timer: 60,
      timerInterval: null,
      usedWords: [],

      // Fake Artist State
      currentRound: 1,
      secretWord: '',
      impostorId: null,
      currentTurnIndex: 0,
      turnTimer: 30,
      turnInterval: null,
      drawingHistory: []
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players, isHost: true, gameType: rooms[roomId].gameType });
  });

  // 2. JOIN ROOM
  socket.on('join_room', ({ roomId, playerName }) => {
    const code = roomId.trim().toUpperCase();
    const room = rooms[code];

    if (!room) return socket.emit('error_message', 'Room not found!');
    if (room.status !== 'LOBBY') return socket.emit('error_message', 'Game already started!');
    if (room.players.length >= 15) return socket.emit('error_message', 'Room is full!');

    room.players.push({ id: socket.id, name: playerName, currentGuess: null, vote: null });
    socket.join(code);

    io.to(code).emit('room_updated', {
      roomId: code,
      players: room.players,
      hostId: room.hostId,
      gameType: room.gameType
    });
  });

  // 3. START GAME
  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;

    room.status = 'PLAYING';

    if (room.gameType === 'mind_reader') {
      startMindReaderRound(roomId);
    } else if (room.gameType === 'fake_artist') {
      startFakeArtistGame(roomId);
    }
  });

  // =========================================
  // --- MIND READER EVENTS ---
  // =========================================
  socket.on('submit_guess', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING' || room.gameType !== 'mind_reader') return;

    const normalizedGuess = guess.trim().toLowerCase();
    if (room.usedWords.includes(normalizedGuess)) {
      return socket.emit('error_message', `"${guess}" was already used! Guess a new word.`);
    }

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.currentGuess = normalizedGuess;

    const allSubmitted = room.players.every(p => p.currentGuess !== null);
    if (allSubmitted) {
      clearInterval(room.timerInterval);
      evaluateMindReaderRound(roomId);
    } else {
      io.to(roomId).emit('update_submitted_count', {
        submittedCount: room.players.filter(p => p.currentGuess !== null).length,
        totalPlayers: room.players.length
      });
    }
  });

  // =========================================
  // --- FAKE ARTIST EVENTS ---
  // =========================================
  socket.on('draw_stroke', ({ roomId, stroke }) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'fake_artist') return;
    
    room.drawingHistory.push(stroke);
    socket.to(roomId).emit('render_stroke', stroke);
  });

  socket.on('undo_stroke', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'fake_artist') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer && currentPlayer.id === socket.id) {
      for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
        if (room.drawingHistory[i].playerId === socket.id) {
          room.drawingHistory.splice(i, 1);
          break;
        }
      }
      io.to(roomId).emit('redraw_full_canvas', room.drawingHistory);
    }
  });

  socket.on('finish_turn', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'fake_artist') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer && currentPlayer.id === socket.id) {
      nextDrawingTurn(roomId);
    }
  });

  socket.on('submit_fa_vote', ({ roomId, votedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'fake_artist') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.vote = votedPlayerId;

    const allVoted = room.players.every(p => p.vote !== null);
    if (allVoted) {
      evaluateFAVotes(roomId);
    } else {
      io.to(roomId).emit('fa_vote_progress', {
        votedCount: room.players.filter(p => p.vote !== null).length,
        totalPlayers: room.players.length
      });
    }
  });

  socket.on('submit_impostor_word_guess', ({ roomId, wordGuess }) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'fake_artist') return;

    const isCorrect = wordGuess.trim().toLowerCase() === room.secretWord.toLowerCase();
    io.to(roomId).emit('game_over', {
      win: isCorrect,
      word: room.secretWord,
      msg: isCorrect 
        ? `🕵️ Impostor guessed the secret word "${room.secretWord.toUpperCase()}" correctly and WON!` 
        : `🎉 Real Artists WON! Impostor failed to guess "${room.secretWord.toUpperCase()}".`
    });
  });

  // DISCONNECT HANDLER
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          clearInterval(room.timerInterval);
          clearInterval(room.turnInterval);
          delete rooms[roomId];
        } else {
          if (room.hostId === socket.id) room.hostId = room.players[0].id;
          io.to(roomId).emit('room_updated', {
            roomId,
            players: room.players,
            hostId: room.hostId,
            gameType: room.gameType
          });
        }
        break;
      }
    }
  });
});

// --- MIND READER HELPERS ---
function startMindReaderRound(roomId) {
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
      evaluateMindReaderRound(roomId);
    }
  }, 1000);
}

function evaluateMindReaderRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const validGuesses = room.players.map(p => p.currentGuess ? p.currentGuess : "NO GUESS");
  const firstWord = validGuesses[0];
  const isMatch = validGuesses.every(w => w !== "NO GUESS" && w === firstWord);

  const results = room.players.map(p => ({ name: p.name, guess: p.currentGuess || "Timed Out" }));

  if (isMatch) {
    room.status = 'GAME_OVER';
    io.to(roomId).emit('game_over', { win: true, word: firstWord, results });
  } else {
    room.lives -= 1;
    validGuesses.forEach(w => {
      if (w !== "NO GUESS" && !room.usedWords.includes(w)) room.usedWords.push(w);
    });

    if (room.lives <= 0) {
      room.status = 'GAME_OVER';
      io.to(roomId).emit('game_over', { win: false, results });
    } else {
      io.to(roomId).emit('round_result', { matched: false, results, livesRemaining: room.lives, usedWords: room.usedWords });
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].lives > 0) startMindReaderRound(roomId);
      }, 5000);
    }
  }
}

// --- FAKE ARTIST HELPERS ---
function startFakeArtistGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.secretWord = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
  const impostorIndex = Math.floor(Math.random() * room.players.length);
  room.impostorId = room.players[impostorIndex].id;
  room.currentTurnIndex = 0;
  room.currentRound = 1;
  room.drawingHistory = [];

  room.players.forEach(p => {
    const isImpostor = p.id === room.impostorId;
    io.to(p.id).emit('fa_init_roles', {
      isImpostor,
      secretWord: isImpostor ? '???' : room.secretWord
    });
  });

  startDrawingTurn(roomId);
}

function startDrawingTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const activePlayer = room.players[room.currentTurnIndex];
  room.turnTimer = 30;

  io.to(roomId).emit('fa_turn_start', {
    activePlayerId: activePlayer.id,
    activePlayerName: activePlayer.name,
    turnTimer: room.turnTimer,
    currentRound: room.currentRound
  });

  clearInterval(room.turnInterval);
  room.turnInterval = setInterval(() => {
    room.turnTimer -= 1;
    io.to(roomId).emit('fa_timer_tick', room.turnTimer);

    if (room.turnTimer <= 0) {
      clearInterval(room.turnInterval);
      nextDrawingTurn(roomId);
    }
  }, 1000);
}

function nextDrawingTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  clearInterval(room.turnInterval);
  room.currentTurnIndex += 1;

  if (room.currentTurnIndex >= room.players.length) {
    room.currentTurnIndex = 0;
    startFAVotingPhase(roomId);
  } else {
    startDrawingTurn(roomId);
  }
}

function startFAVotingPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.players.forEach(p => p.vote = null);
  io.to(roomId).emit('fa_start_voting', {
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    currentRound: room.currentRound
  });
}

function evaluateFAVotes(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const voteCounts = {};
  room.players.forEach(p => {
    if (p.vote) {
      voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
    }
  });

  let highestVotes = 0;
  let votedTargetId = null;
  let isTie = false;

  for (const targetId in voteCounts) {
    if (voteCounts[targetId] > highestVotes) {
      highestVotes = voteCounts[targetId];
      votedTargetId = targetId;
      isTie = false;
    } else if (voteCounts[targetId] === highestVotes) {
      isTie = true;
    }
  }

  if (isTie || votedTargetId === "SKIP" || highestVotes <= Math.floor(room.players.length / 2)) {
    room.currentRound += 1;
    io.to(roomId).emit('fa_vote_continue', {
      msg: `No majority reached! Moving to Round ${room.currentRound}. Canvas preserved!`
    });
    setTimeout(() => { startDrawingTurn(roomId); }, 3000);
  } else if (votedTargetId === room.impostorId) {
    const impostorPlayer = room.players.find(p => p.id === room.impostorId);
    io.to(roomId).emit('fa_impostor_caught_guess', {
      impostorName: impostorPlayer ? impostorPlayer.name : 'Impostor'
    });
  } else {
    const innocent = room.players.find(p => p.id === votedTargetId);
    io.to(roomId).emit('game_over', {
      win: false,
      word: room.secretWord,
      msg: `💀 Game Over! The group falsely accused ${innocent ? innocent.name : 'an innocent player'}. The Impostor WON!`
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));