const socket = io({
  transports: ['websocket', 'polling']
});

// Screens
const gameSelectScreen = document.getElementById('game-select-screen');
const setupScreen = document.getElementById('setup-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const fakeArtistScreen = document.getElementById('fake-artist-screen');
const faVotingScreen = document.getElementById('fa-voting-screen');
const impostorGuessScreen = document.getElementById('impostor-guess-screen');
const resultScreen = document.getElementById('result-screen');

// Game Select
const selectMindReader = document.getElementById('select-mind-reader');
const selectFakeArtist = document.getElementById('select-fake-artist');
const backToGamesBtn = document.getElementById('back-to-games-btn');

// Common Controls
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('start-btn');
const displayRoomCode = document.getElementById('display-room-code');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const hostControls = document.getElementById('host-controls');
const waitingMsg = document.getElementById('waiting-msg');
const errorMsg = document.getElementById('error-msg');

// Mind Reader Controls
const guessInput = document.getElementById('guess-input');
const submitGuessBtn = document.getElementById('submit-guess-btn');
const livesDisplay = document.getElementById('lives-display');
const timerDisplay = document.getElementById('timer-display');
const submissionStatus = document.getElementById('submission-status');
const usedWordsList = document.getElementById('used-words-list');

// Fake Artist Canvas & Tools
const roleDisplay = document.getElementById('role-display');
const secretWordDisplay = document.getElementById('secret-word-display');
const currentTurnMsg = document.getElementById('current-turn-msg');
const faTurnTimer = document.getElementById('fa-turn-timer');
const canvas = document.getElementById('paint-canvas');
const ctx = canvas.getContext('2d');
const drawingControls = document.getElementById('drawing-controls');
const brushColor = document.getElementById('brush-color');
const brushSize = document.getElementById('brush-size');
const eraserBtn = document.getElementById('eraser-btn');
const undoBtn = document.getElementById('undo-btn');
const finishTurnBtn = document.getElementById('finish-turn-btn');

// Voting & Impostor Guess
const votingPlayersGrid = document.getElementById('voting-players-grid');
const skipVoteBtn = document.getElementById('skip-vote-btn');
const votingStatus = document.getElementById('voting-status');
const faRoundNum = document.getElementById('fa-round-num');
const impostorWordInput = document.getElementById('impostor-word-input');
const submitImpostorGuessBtn = document.getElementById('submit-impostor-guess-btn');

// Results
const matchStatusMsg = document.getElementById('match-status-msg');

let selectedGameType = 'mind_reader';
let currentRoomId = null;
let isMyTurnToDraw = false;
let isDrawing = false;
let isEraserActive = false;
let lastX = 0;
let lastY = 0;

function showScreen(screen) {
  [gameSelectScreen, setupScreen, lobbyScreen, gameScreen, fakeArtistScreen, faVotingScreen, impostorGuessScreen, resultScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

selectMindReader.addEventListener('click', () => { selectedGameType = 'mind_reader'; showScreen(setupScreen); });
selectFakeArtist.addEventListener('click', () => { selectedGameType = 'fake_artist'; showScreen(setupScreen); });
backToGamesBtn.addEventListener('click', () => { showScreen(gameSelectScreen); });

createBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showError('Please enter your name.');
  socket.emit('create_room', { playerName: name, gameType: selectedGameType });
});

joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name || !code) return showError('Enter both name and room code.');
  socket.emit('join_room', { roomId: code, playerName: name });
});

startBtn.addEventListener('click', () => {
  if (currentRoomId) socket.emit('start_game', currentRoomId);
});

function showError(msg) {
  errorMsg.textContent = msg;
  setTimeout(() => { errorMsg.textContent = ''; }, 4000);
}

// --- WHITEBOARD & TOOLBAR LOGIC ---
document.querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    e.target.classList.add('active');
    brushColor.value = e.target.dataset.color;
    isEraserActive = false;
    eraserBtn.style.background = '#334155';
  });
});

eraserBtn.addEventListener('click', () => {
  isEraserActive = !isEraserActive;
  eraserBtn.style.background = isEraserActive ? '#ef4444' : '#334155';
});

undoBtn.addEventListener('click', () => {
  if (isMyTurnToDraw) {
    socket.emit('undo_stroke', currentRoomId);
  }
});

finishTurnBtn.addEventListener('click', () => {
  if (isMyTurnToDraw) {
    socket.emit('finish_turn', currentRoomId);
  }
});

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

canvas.addEventListener('mousedown', startStroke);
canvas.addEventListener('mousemove', drawStroke);
canvas.addEventListener('mouseup', stopStroke);
canvas.addEventListener('touchstart', startStroke);
canvas.addEventListener('touchmove', drawStroke);
canvas.addEventListener('touchend', stopStroke);

function startStroke(e) {
  if (!isMyTurnToDraw) return;
  e.preventDefault();
  isDrawing = true;
  const pos = getCanvasCoords(e);
  lastX = pos.x;
  lastY = pos.y;
}

function drawStroke(e) {
  if (!isDrawing || !isMyTurnToDraw) return;
  e.preventDefault();
  const pos = getCanvasCoords(e);

  const strokeData = {
    playerId: socket.id,
    x1: lastX, y1: lastY,
    x2: pos.x, y2: pos.y,
    color: isEraserActive ? '#ffffff' : brushColor.value,
    size: isEraserActive ? 22 : brushSize.value
  };

  renderStrokeOnCanvas(strokeData);
  socket.emit('draw_stroke', { roomId: currentRoomId, stroke: strokeData });

  lastX = pos.x;
  lastY = pos.y;
}

function stopStroke(e) { isDrawing = false; }

function renderStrokeOnCanvas(stroke) {
  ctx.beginPath();
  ctx.moveTo(stroke.x1, stroke.y1);
  ctx.lineTo(stroke.x2, stroke.y2);
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// --- SOCKET LISTENERS ---
socket.on('error_message', (msg) => showError(msg));

socket.on('room_created', ({ roomId, players, isHost, gameType }) => {
  currentRoomId = roomId;
  displayRoomCode.textContent = roomId;
  renderPlayerList(players, socket.id);
  if (isHost) { hostControls.classList.remove('hidden'); waitingMsg.classList.add('hidden'); }
  showScreen(lobbyScreen);
});

socket.on('room_updated', ({ roomId, players, hostId }) => {
  currentRoomId = roomId;
  displayRoomCode.textContent = roomId;
  renderPlayerList(players, hostId);
  if (socket.id === hostId) { hostControls.classList.remove('hidden'); waitingMsg.classList.add('hidden'); }
  else { hostControls.classList.add('hidden'); waitingMsg.classList.remove('hidden'); }
  showScreen(lobbyScreen);
});

function renderPlayerList(players, hostId) {
  playerCount.textContent = players.length;
  playerList.innerHTML = players.map(p => `
    <li class="player-chip ${p.id === socket.id ? 'is-self' : ''}">
      ${p.id === hostId ? '👑' : '👤'} ${p.name}
    </li>
  `).join('');
}

// Mind Reader
submitGuessBtn.addEventListener('click', sendMindReaderGuess);
function sendMindReaderGuess() {
  const g = guessInput.value.trim();
  if (!g) return;
  socket.emit('submit_guess', { roomId: currentRoomId, guess: g });
  guessInput.value = '';
  guessInput.disabled = true;
  submitGuessBtn.disabled = true;
  submissionStatus.textContent = '✅ Guess submitted!';
}

socket.on('round_start', ({ lives, usedWords, timer }) => {
  showScreen(gameScreen);
  livesDisplay.textContent = `${lives} Lives`;
  timerDisplay.textContent = timer;
  guessInput.disabled = false;
  submitGuessBtn.disabled = false;
});

// Fake Artist Canvas Events
socket.on('fa_init_roles', ({ isImpostor, secretWord }) => {
  showScreen(fakeArtistScreen);
  roleDisplay.textContent = isImpostor ? '🕵️ Role: FAKE ARTIST' : '🎨 Role: REAL ARTIST';
  secretWordDisplay.textContent = `Word: ${secretWord}`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('fa_turn_start', ({ activePlayerId, activePlayerName, turnTimer, currentRound }) => {
  faTurnTimer.textContent = turnTimer;
  isMyTurnToDraw = (activePlayerId === socket.id);

  if (isMyTurnToDraw) {
    currentTurnMsg.innerHTML = `🌟 <strong>IT'S YOUR TURN TO DRAW!</strong>`;
    drawingControls.classList.remove('hidden');
  } else {
    currentTurnMsg.innerHTML = `✏️ <strong>${activePlayerName}</strong> is drawing...`;
    drawingControls.classList.add('hidden');
  }
});

socket.on('fa_timer_tick', (timeLeft) => { faTurnTimer.textContent = timeLeft; });

socket.on('render_stroke', (stroke) => { renderStrokeOnCanvas(stroke); });

socket.on('redraw_full_canvas', (drawingHistory) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawingHistory.forEach(stroke => renderStrokeOnCanvas(stroke));
});

// Voting Events
socket.on('fa_start_voting', ({ players, currentRound }) => {
  showScreen(faVotingScreen);
  faRoundNum.textContent = currentRound;
  votingStatus.textContent = 'Click on a player card to vote!';

  votingPlayersGrid.innerHTML = players.map(p => `
    <div class="vote-card" onclick="castFAVote('${p.id}', this)">
      <div class="avatar">👤</div>
      <div class="name">${p.name}</div>
    </div>
  `).join('');
});

window.castFAVote = function(targetId, el) {
  document.querySelectorAll('.vote-card').forEach(card => card.classList.remove('voted'));
  if (el) el.classList.add('voted');
  socket.emit('submit_fa_vote', { roomId: currentRoomId, votedPlayerId: targetId });
  votingStatus.textContent = '✅ Vote registered! Waiting for everyone...';
};

skipVoteBtn.addEventListener('click', () => {
  document.querySelectorAll('.vote-card').forEach(card => card.classList.remove('voted'));
  socket.emit('submit_fa_vote', { roomId: currentRoomId, votedPlayerId: 'SKIP' });
  votingStatus.textContent = '✅ Skipped vote! Waiting for everyone...';
});

socket.on('fa_vote_continue', ({ msg }) => {
  votingStatus.textContent = msg;
  setTimeout(() => { showScreen(fakeArtistScreen); }, 2500);
});

socket.on('fa_impostor_caught_guess', ({ impostorName }) => {
  if (roleDisplay.textContent.includes('FAKE ARTIST')) {
    showScreen(impostorGuessScreen);
  } else {
    showScreen(faVotingScreen);
    votingStatus.textContent = `🚨 Impostor (${impostorName}) was caught! Waiting for their word guess...`;
  }
});

submitImpostorGuessBtn.addEventListener('click', () => {
  const word = impostorWordInput.value.trim();
  if (word) {
    socket.emit('submit_impostor_word_guess', { roomId: currentRoomId, wordGuess: word });
  }
});

// Game Over
socket.on('game_over', ({ win, word, msg }) => {
  showScreen(resultScreen);
  matchStatusMsg.textContent = msg || (win ? '🎉 Victory!' : '💀 Game Over!');
  matchStatusMsg.style.background = win ? '#14532d' : '#7f1d1d';
  matchStatusMsg.style.color = '#ffffff';
});