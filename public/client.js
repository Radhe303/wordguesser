const socket = io({
  transports: ['websocket', 'polling']
});

// Screen Elements
const gameSelectScreen = document.getElementById('game-select-screen');
const setupScreen = document.getElementById('setup-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const gameOverScreen = document.getElementById('game-over-screen');

// Game Select Elements
const selectMindReader = document.getElementById('select-mind-reader');
const backToGamesBtn = document.getElementById('back-to-games-btn');

// Inputs & Buttons
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('start-btn');
const guessInput = document.getElementById('guess-input');
const submitGuessBtn = document.getElementById('submit-guess-btn');

// Displays
const displayRoomCode = document.getElementById('display-room-code');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const hostControls = document.getElementById('host-controls');
const waitingMsg = document.getElementById('waiting-msg');
const errorMsg = document.getElementById('error-msg');
const livesDisplay = document.getElementById('lives-display');
const timerDisplay = document.getElementById('timer-display');
const submissionStatus = document.getElementById('submission-status');
const usedWordsList = document.getElementById('used-words-list');
const livePlayerChips = document.getElementById('live-player-chips');
const guessesGrid = document.getElementById('guesses-grid');
const matchStatusMsg = document.getElementById('match-status-msg');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMsg = document.getElementById('game-over-msg');
const finalGuessesGrid = document.getElementById('final-guesses-grid');

let currentRoomId = null;
let currentPlayers = [];

function showScreen(screen) {
  [gameSelectScreen, setupScreen, lobbyScreen, gameScreen, resultScreen, gameOverScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// Navigation Events
selectMindReader.addEventListener('click', () => {
  showScreen(setupScreen);
});

backToGamesBtn.addEventListener('click', () => {
  showScreen(gameSelectScreen);
});

function showError(msg) {
  errorMsg.textContent = msg;
  setTimeout(() => { errorMsg.textContent = ''; }, 4000);
}

// 1. Create Room
createBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showError('⚠️ Please enter your name first.');
  socket.emit('create_room', name);
});

// 2. Join Room
joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name || !code) return showError('⚠️ Enter both your name and a 4-letter room code.');
  socket.emit('join_room', { roomId: code, playerName: name });
});

// 3. Start Game (Host)
startBtn.addEventListener('click', () => {
  if (currentRoomId) socket.emit('start_game', currentRoomId);
});

// 4. Submit Guess
submitGuessBtn.addEventListener('click', sendGuess);
guessInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendGuess();
});

function sendGuess() {
  const guess = guessInput.value.trim();
  if (!guess) return;

  socket.emit('submit_guess', { roomId: currentRoomId, guess });
  guessInput.value = '';
  guessInput.disabled = true;
  submitGuessBtn.disabled = true;
  submissionStatus.textContent = '✅ Word submitted! Waiting for teammates...';
}

// --- SOCKET EVENT HANDLERS ---

socket.on('error_message', (msg) => {
  showError(msg);
  guessInput.disabled = false;
  submitGuessBtn.disabled = false;
});

socket.on('room_created', ({ roomId, players, isHost }) => {
  currentRoomId = roomId;
  currentPlayers = players;
  displayRoomCode.textContent = roomId;
  renderPlayerList(players, socket.id);
  
  if (isHost) {
    hostControls.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
  }
  showScreen(lobbyScreen);
});

socket.on('room_updated', ({ roomId, players, hostId }) => {
  currentRoomId = roomId;
  currentPlayers = players;
  displayRoomCode.textContent = roomId;
  renderPlayerList(players, hostId);

  if (socket.id === hostId) {
    hostControls.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
  } else {
    hostControls.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
  }
  showScreen(lobbyScreen);
});

function renderPlayerList(players, hostId) {
  playerCount.textContent = players.length;
  playerList.innerHTML = players.map(p => {
    const isHost = p.id === hostId;
    const isSelf = p.id === socket.id;
    return `
      <li class="player-chip ${isSelf ? 'is-self' : ''}">
        ${isHost ? '<span class="host-icon">👑</span>' : '👤'}
        <span>${p.name}${isSelf ? ' (You)' : ''}</span>
      </li>
    `;
  }).join('');
}

// Round Start
socket.on('round_start', ({ lives, usedWords, timer }) => {
  showScreen(gameScreen);
  livesDisplay.textContent = `${lives} Lives`;
  timerDisplay.textContent = timer;
  submissionStatus.textContent = '';
  guessInput.value = '';
  guessInput.disabled = false;
  submitGuessBtn.disabled = false;

  renderLiveProgress(0, currentPlayers.length);

  if (usedWords && usedWords.length > 0) {
    usedWordsList.innerHTML = usedWords.map(w => `<span class="tag">${w.toUpperCase()}</span>`).join('');
  } else {
    usedWordsList.textContent = 'None yet (First round)';
  }
});

// Timer Tick
socket.on('timer_tick', (timeLeft) => {
  timerDisplay.textContent = timeLeft;
});

// Live Submission Progress
socket.on('update_submitted_count', ({ submittedCount, totalPlayers }) => {
  renderLiveProgress(submittedCount, totalPlayers);
});

function renderLiveProgress(submittedCount, totalPlayers) {
  submissionStatus.textContent = guessInput.disabled 
    ? `✅ Word submitted! (${submittedCount}/${totalPlayers} players ready)`
    : `Waiting for inputs... (${submittedCount}/${totalPlayers} ready)`;
}

// Round Result
socket.on('round_result', ({ matched, results, livesRemaining, usedWords }) => {
  showScreen(resultScreen);
  matchStatusMsg.textContent = '❌ Words did not match! Lost 1 life.';
  matchStatusMsg.style.background = '#7f1d1d';
  matchStatusMsg.style.color = '#fca5a5';

  guessesGrid.innerHTML = results.map(r => `
    <div class="guess-card">
      <div class="player-name">👤 ${r.name}</div>
      <div class="word">${r.guess.toUpperCase()}</div>
    </div>
  `).join('');
});

// Game Over (Win or Lose)
socket.on('game_over', ({ win, word, results }) => {
  showScreen(gameOverScreen);
  if (win) {
    gameOverTitle.textContent = '🎉 VICTORY!';
    gameOverTitle.style.color = '#4ade80';
    gameOverMsg.textContent = `Everyone guessed the exact same word: "${word.toUpperCase()}"!`;
    gameOverMsg.style.background = '#14532d';
  } else {
    gameOverTitle.textContent = '💀 GAME OVER';
    gameOverTitle.style.color = '#f87171';
    gameOverMsg.textContent = 'You ran out of lives!';
    gameOverMsg.style.background = '#7f1d1d';
  }

  finalGuessesGrid.innerHTML = results.map(r => `
    <div class="guess-card">
      <div class="player-name">👤 ${r.name}</div>
      <div class="word">${r.guess.toUpperCase()}</div>
    </div>
  `).join('');
});