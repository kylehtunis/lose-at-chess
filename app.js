const ENGINE_MOVE_DELAY_MS = 100;
const PIECE_THEME = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PHASE = { CONFIG: 'config', SETUP: 'setup', ENGINE: 'engine', COMPLETE: 'complete' };

const state = {
  phase: PHASE.CONFIG,
  setupMovesPerSide: 10,
  enginePhaseStartPly: null,
  gameId: 0,
  evals: [],
  fenHistory: [],
  allFens: [],
  viewPly: null,
  timelineEvals: null,
};

const game = new Chess();
const engine = new Engine();
let board = null;

const el = {
  configPanel: document.getElementById('config-panel'),
  setupMovesInput: document.getElementById('setup-moves'),
  startBtn: document.getElementById('start-btn'),
  gameArea: document.getElementById('game-area'),
  phaseLabel: document.getElementById('phase-label'),
  moveCounter: document.getElementById('move-counter'),
  turnLabel: document.getElementById('turn-label'),
  moveList: document.getElementById('move-list'),
  evalBar: document.getElementById('eval-bar'),
  evalFill: document.getElementById('eval-fill'),
  evalLabel: document.getElementById('eval-label'),
  evalBarWrap: document.getElementById('eval-bar-wrap'),
  evalTimeline: document.getElementById('eval-timeline'),
  evalLoading: document.getElementById('eval-loading'),
  evalProgress: document.getElementById('eval-progress'),
  resultOverlay: document.getElementById('result-overlay'),
  resultTitle: document.getElementById('result-title'),
  resultDetail: document.getElementById('result-detail'),
  playAgainBtn: document.getElementById('play-again-btn'),
  dismissResultBtn: document.getElementById('dismiss-result-btn'),
};

function colorName(color) {
  return color === 'w' ? 'White' : 'Black';
}

function setupMovesRemaining(color) {
  const played = game.history().filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === color).length;
  return Math.max(0, state.setupMovesPerSide - played);
}

function setupPhaseIsOver() {
  return game.history().length >= state.setupMovesPerSide * 2;
}

// --- Eval formatting ---

function formatEval(ev) {
  if (!ev) return '?';
  if (ev.type === 'mate') {
    return ev.value > 0 ? `M${ev.value}` : `M${ev.value}`;
  }
  const pawns = ev.value / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

function evalToWhiteAdvantage(ev) {
  if (!ev) return 0;
  if (ev.type === 'mate') return ev.value > 0 ? 10 : -10;
  return Math.max(-10, Math.min(10, ev.value / 100));
}

function normalizeEvalToWhite(ev, sideToMove) {
  if (!ev) return null;
  if (sideToMove === 'w') return ev;
  return { type: ev.type, value: -ev.value };
}

function renderEvalBar(ev) {
  if (!ev) return;
  const advantage = evalToWhiteAdvantage(ev);
  const whitePct = 50 + (advantage / 10) * 50;
  el.evalFill.style.height = `${whitePct}%`;
  el.evalLabel.textContent = formatEval(ev);
  el.evalLabel.style.top = whitePct < 50 ? '4px' : '';
  el.evalLabel.style.bottom = whitePct >= 50 ? '4px' : '';
  el.evalLabel.style.color = whitePct >= 50 ? '#1a1a1a' : '#ececf1';
}

// --- Board interaction (setup phase only) ---

function onDragStart(_source, piece) {
  if (state.phase !== PHASE.SETUP) return false;
  return piece.charAt(0) === game.turn();
}

function onDrop(source, target) {
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  recordFen();
  afterMove();
}

function onSnapEnd() {
  board.position(game.fen());
}

function recordFen() {
  state.fenHistory.push(game.fen());
}

// --- Game flow ---

function startGame() {
  const moves = parseInt(el.setupMovesInput.value, 10);
  if (!Number.isInteger(moves) || moves < 1) return;

  state.gameId += 1;
  state.setupMovesPerSide = moves;
  state.enginePhaseStartPly = null;
  state.phase = PHASE.SETUP;
  state.evals = [];
  state.fenHistory = [];
  state.allFens = [];
  state.viewPly = null;
  state.timelineEvals = null;
  game.reset();
  board.start();
  el.moveList.innerHTML = '';
  el.evalBarWrap.hidden = true;
  el.evalTimeline.hidden = true;

  el.configPanel.hidden = true;
  el.gameArea.hidden = false;
  el.resultOverlay.hidden = true;
  updateInfoBar();
}

function afterMove() {
  renderHistory();

  if (game.game_over()) {
    finishGame();
    return;
  }

  if (state.phase === PHASE.SETUP && setupPhaseIsOver()) {
    beginEnginePhase();
    return;
  }

  updateInfoBar();
  if (state.phase === PHASE.ENGINE) scheduleEngineMove();
}

function beginEnginePhase() {
  state.phase = PHASE.ENGINE;
  state.enginePhaseStartPly = game.history().length;

  el.evalBarWrap.hidden = false;
  el.evalFill.style.height = '50%';
  el.evalLabel.textContent = '0.0';

  renderHistory();
  updateInfoBar();
  scheduleEngineMove();
}

function scheduleEngineMove() {
  const gameId = state.gameId;
  setTimeout(async () => {
    if (gameId !== state.gameId || state.phase !== PHASE.ENGINE) return;
    const result = await engine.bestMove(game.fen());
    if (gameId !== state.gameId || state.phase !== PHASE.ENGINE) return;
    applyUciMove(result.move, result.eval);
  }, ENGINE_MOVE_DELAY_MS);
}

function applyUciMove(uci, ev) {
  const move = game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  if (move === null) {
    console.error('Engine returned an illegal move:', uci, game.fen());
    return;
  }
  const normalized = normalizeEvalToWhite(ev, game.turn());
  state.evals.push(normalized);
  renderEvalBar(normalized);
  board.position(game.fen());
  afterMove();
}

async function finishGame() {
  state.phase = PHASE.COMPLETE;
  buildAllFens();
  state.viewPly = state.allFens.length - 1;
  updateInfoBar();
  showResult();
  renderHistory();
  await buildEvalTimeline();
}

function buildAllFens() {
  const fens = [START_FEN];
  const tempGame = new Chess();
  const history = game.history();
  for (let i = 0; i < history.length; i++) {
    tempGame.load(fens[i]);
    tempGame.move(history[i]);
    fens.push(tempGame.fen());
  }
  state.allFens = fens;
}

// --- Game review (post-game navigation) ---

function navigateTo(ply) {
  if (state.phase !== PHASE.COMPLETE) return;
  const maxPly = state.allFens.length - 1;
  ply = Math.max(0, Math.min(ply, maxPly));
  state.viewPly = ply;
  board.position(state.allFens[ply], false);
  updateHighlight();
  updateReviewEvalBar();
  updateTimelineMarker();
}

function updateReviewEvalBar() {
  if (!state.timelineEvals) return;
  const ply = state.viewPly;
  if (ply === 0) {
    renderEvalBar({ type: 'cp', value: 0 });
  } else {
    const ev = state.timelineEvals[ply - 1];
    if (ev) renderEvalBar(ev);
  }
}

function updateHighlight() {
  let activeSpan = null;
  el.moveList.querySelectorAll('.move-san').forEach(span => {
    const isActive = parseInt(span.dataset.ply, 10) === state.viewPly;
    span.classList.toggle('active', isActive);
    if (isActive) activeSpan = span;
  });
  if (activeSpan) {
    activeSpan.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function updateTimelineMarker() {
  if (!state.timelineEvals) return;
  renderTimeline(state.timelineEvals, state.viewPly);
}

// --- Eval timeline (post-game) ---

async function buildEvalTimeline() {
  const gameId = state.gameId;
  const allFens = state.allFens.slice(1);

  el.evalTimeline.hidden = false;
  el.evalLoading.hidden = false;
  el.evalProgress.textContent = '';
  const evalCanvas = document.getElementById('eval-canvas');
  evalCanvas.style.display = 'none';

  const fullEvals = [];
  const engineOffset = state.enginePhaseStartPly ?? Infinity;

  for (let i = 0; i < allFens.length; i++) {
    if (gameId !== state.gameId) return;

    if (i >= engineOffset && state.evals[i - engineOffset]) {
      fullEvals.push(state.evals[i - engineOffset]);
    } else {
      el.evalProgress.textContent = `(${i + 1}/${allFens.length})`;
      const ev = await engine.evaluate(allFens[i]);
      if (gameId !== state.gameId) return;
      const fenParts = allFens[i].split(' ');
      fullEvals.push(normalizeEvalToWhite(ev, fenParts[1]));
    }
  }

  if (gameId !== state.gameId) return;
  state.timelineEvals = fullEvals;
  el.evalLoading.hidden = true;
  evalCanvas.style.display = '';
  requestAnimationFrame(() => {
    renderTimeline(fullEvals, state.viewPly);
    updateReviewEvalBar();
  });
}

function renderTimeline(evals, markerPly) {
  const canvas = document.getElementById('eval-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);

  const padding = { top: 20, right: 16, bottom: 28, left: 40 };
  const w = cssW - padding.left - padding.right;
  const h = cssH - padding.top - padding.bottom;
  const maxPawns = 10;

  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(0, 0, cssW, cssH);

  const midY = padding.top + h / 2;
  ctx.strokeStyle = '#55556a';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, midY);
  ctx.lineTo(padding.left + w, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (state.enginePhaseStartPly !== null && state.enginePhaseStartPly > 0) {
    const dividerX = padding.left + (state.enginePhaseStartPly - 0.5) / (evals.length - 1) * w;
    ctx.strokeStyle = 'rgba(224, 164, 88, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dividerX, padding.top);
    ctx.lineTo(dividerX, padding.top + h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#e0a458';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('engine', dividerX, padding.top - 6);
  }

  if (evals.length < 2) return;

  // Fill above (white advantage area).
  ctx.beginPath();
  evals.forEach((ev, i) => {
    const x = padding.left + (i / (evals.length - 1)) * w;
    const adv = evalToWhiteAdvantage(ev);
    const y = midY - (adv / maxPawns) * (h / 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.save();
  ctx.clip();
  const above = ctx.createLinearGradient(0, padding.top, 0, midY);
  above.addColorStop(0, 'rgba(240, 240, 240, 0.25)');
  above.addColorStop(1, 'rgba(240, 240, 240, 0.05)');
  ctx.fillStyle = above;
  ctx.lineTo(padding.left + w, midY);
  ctx.lineTo(padding.left, midY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Fill below (black advantage area).
  ctx.beginPath();
  evals.forEach((ev, i) => {
    const x = padding.left + (i / (evals.length - 1)) * w;
    const adv = evalToWhiteAdvantage(ev);
    const y = midY - (adv / maxPawns) * (h / 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.save();
  ctx.clip();
  const below = ctx.createLinearGradient(0, midY, 0, padding.top + h);
  below.addColorStop(0, 'rgba(68, 68, 68, 0.05)');
  below.addColorStop(1, 'rgba(68, 68, 68, 0.25)');
  ctx.fillStyle = below;
  ctx.lineTo(padding.left + w, midY);
  ctx.lineTo(padding.left, midY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Eval line.
  ctx.beginPath();
  evals.forEach((ev, i) => {
    const x = padding.left + (i / (evals.length - 1)) * w;
    const adv = evalToWhiteAdvantage(ev);
    const y = midY - (adv / maxPawns) * (h / 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#e0a458';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Position marker.
  if (markerPly != null && markerPly >= 1 && markerPly <= evals.length) {
    const mi = markerPly - 1;
    const mx = padding.left + (mi / (evals.length - 1)) * w;
    const madv = evalToWhiteAdvantage(evals[mi]);
    const my = midY - (madv / maxPawns) * (h / 2);

    ctx.strokeStyle = '#ececf1';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(mx, padding.top);
    ctx.lineTo(mx, padding.top + h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e0a458';
    ctx.fill();
    ctx.strokeStyle = '#1e1e24';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Axis labels.
  ctx.fillStyle = '#9a9aa8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('+10', padding.left - 6, padding.top);
  ctx.fillText('0', padding.left - 6, midY);
  ctx.fillText('-10', padding.left - 6, padding.top + h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('1', padding.left, padding.top + h + 6);
  const lastMove = Math.ceil(evals.length / 2);
  ctx.fillText(String(lastMove), padding.left + w, padding.top + h + 6);
  const midMove = Math.ceil(lastMove / 2);
  ctx.fillText(String(midMove), padding.left + w / 2, padding.top + h + 6);
}

// --- Rendering ---

function updateInfoBar() {
  const turn = game.turn();
  switch (state.phase) {
    case PHASE.SETUP:
      el.phaseLabel.textContent = 'Setup phase';
      el.moveCounter.textContent =
        `Remaining: White ${setupMovesRemaining('w')} / Black ${setupMovesRemaining('b')}`;
      el.turnLabel.textContent = `${colorName(turn)} to move`;
      break;
    case PHASE.ENGINE:
      el.phaseLabel.textContent = 'Engine phase';
      el.moveCounter.textContent = 'Engine is playing both sides';
      el.turnLabel.textContent = `${colorName(turn)} thinking...`;
      break;
    case PHASE.COMPLETE:
      el.phaseLabel.textContent = 'Game over';
      el.moveCounter.textContent = '';
      el.turnLabel.textContent = '';
      break;
  }
}

function renderHistory() {
  const history = game.history();
  const isReviewable = state.phase === PHASE.COMPLETE;
  el.moveList.innerHTML = '';

  history.forEach((san, ply) => {
    if (ply === state.enginePhaseStartPly) {
      const divider = document.createElement('li');
      divider.className = 'phase-divider';
      divider.textContent = 'Engine takes over';
      el.moveList.appendChild(divider);
    }

    const movePly = ply + 1;

    if (ply % 2 === 0) {
      const li = document.createElement('li');
      li.value = Math.floor(ply / 2) + 1;
      const span = document.createElement('span');
      span.textContent = san;
      span.className = 'move-san';
      span.dataset.ply = movePly;
      if (isReviewable) {
        span.classList.add('clickable');
        if (movePly === state.viewPly) span.classList.add('active');
        span.addEventListener('click', () => navigateTo(movePly));
      }
      li.appendChild(span);
      el.moveList.appendChild(li);
    } else {
      const li = el.moveList.lastElementChild;
      const spacer = document.createTextNode('  ');
      li.appendChild(spacer);
      const span = document.createElement('span');
      span.textContent = san;
      span.className = 'move-san';
      span.dataset.ply = movePly;
      if (isReviewable) {
        span.classList.add('clickable');
        if (movePly === state.viewPly) span.classList.add('active');
        span.addEventListener('click', () => navigateTo(movePly));
      }
      li.appendChild(span);
    }
  });

  el.moveList.parentElement.scrollTop = el.moveList.parentElement.scrollHeight;
}

function showResult() {
  const loserColor = game.turn();
  if (game.in_checkmate()) {
    el.resultTitle.textContent = `${colorName(loserColor)} wins!`;
    el.resultDetail.textContent =
      `${colorName(loserColor)} was checkmated, which is exactly what they wanted.`;
  } else {
    let reason = 'The game is a draw.';
    if (game.in_stalemate()) reason = 'Stalemate. Nobody managed to lose.';
    else if (game.in_threefold_repetition()) reason = 'Draw by threefold repetition.';
    else if (game.insufficient_material()) reason = 'Draw by insufficient material.';
    else if (game.in_draw()) reason = 'Draw by the fifty-move rule.';
    el.resultTitle.textContent = 'Draw';
    el.resultDetail.textContent = reason;
  }
  el.resultOverlay.hidden = false;
}

function dismissResult() {
  el.resultOverlay.hidden = true;
}

function resetToConfig() {
  engine.stop();
  state.gameId += 1;
  state.phase = PHASE.CONFIG;
  el.resultOverlay.hidden = true;
  el.gameArea.hidden = true;
  el.configPanel.hidden = false;
  el.evalBarWrap.hidden = true;
  el.evalTimeline.hidden = true;
}

// --- Init ---

board = Chessboard('board', {
  draggable: true,
  position: 'start',
  pieceTheme: PIECE_THEME,
  onDragStart,
  onDrop,
  onSnapEnd,
});

el.startBtn.addEventListener('click', startGame);
el.playAgainBtn.addEventListener('click', resetToConfig);
el.dismissResultBtn.addEventListener('click', dismissResult);
el.resultOverlay.addEventListener('click', (e) => {
  if (e.target === el.resultOverlay) dismissResult();
});

document.addEventListener('keydown', (e) => {
  if (state.phase !== PHASE.COMPLETE || state.viewPly == null) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    navigateTo(state.viewPly - 1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    navigateTo(state.viewPly + 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    navigateTo(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    navigateTo(state.allFens.length - 1);
  }
});

window.addEventListener('resize', () => board.resize());
