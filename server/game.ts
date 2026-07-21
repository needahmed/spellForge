import type { Server, Socket } from 'socket.io';
import type { BoardTile } from '../shared/scoring';
import { isValidPath, pathToWord, scoreWord, MIN_WORD_LEN } from '../shared/scoring';
import type { AiDifficulty, PlayerInfo, PublicRoom, RoomState, RoundResult } from '../shared/types';
import { RUSH_COUNTDOWN_SECONDS, RUSH_GRACE_MS } from '../shared/rush';
import { freshTile, generateBoard, relocateLetterBoost, relocateWordBoost, shuffleBoard, spreadGems } from './board';
import { findRandomWord, findWordByDifficulty, getDictionary } from './dictionary';

const TOTAL_ROUNDS = 5;
const TURN_GAP_MS = 1800;         // pause after a word so everyone sees it
const BOARD_UPDATE_DELAY_MS = 900; // let the success flash play before tiles cascade
const RESULTS_PAUSE_MS = 6000;
const MAX_PLAYERS = 6;

// Socket.IO room that home-screen clients join to receive live public-lobby updates.
const LOBBY_CHANNEL = '__lobbies__';

const AI_PLAYER_ID = '__ai__';
const AI_NAME = 'SpellBot';
const AI_THINK_MS: Record<AiDifficulty, number> = { easy: 3500, medium: 2200, hard: 1200 };
const AI_DRAG_STEP_MS = 220;

const START_GEMS = 3;
const MAX_GEMS = 10;
const COST_SHUFFLE = 1;
const COST_SWAP = 3;
const COST_HINT = 4;
const COST_EXTEND = 1;
const EXTEND_SECONDS = 30;

interface Player {
  id: string;
  name: string;
  score: number;
  gems: number;
  played: boolean;
  word: string;
  roundPoints: number;
  connected: boolean;
  isAI: boolean;
}

interface Room {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'roundResults' | 'finished';
  players: Map<string, Player>;
  round: number;
  tiles: BoardTile[];
  turnOrder: string[];
  turnIdx: number;
  timer: ReturnType<typeof setTimeout> | null;
  boardTimer: ReturnType<typeof setTimeout> | null;
  isPvE: boolean;
  isPublic: boolean;
  aiDifficulty: AiDifficulty;
  // ── rush state (reset each turn) ──
  rushAvailable: boolean;      // a turn is active and has a rush lifecycle
  rushVotingOpen: boolean;     // grace period completed on the server
  rushVotes: Set<string>;      // IDs of waiting players who pressed
  rushActive: boolean;         // the server countdown is live
  rushSecondsRemaining: number;
  rushGraceTimer: ReturnType<typeof setTimeout> | null;
  rushTicker: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function activePlayerId(room: Room): string | null {
  if (room.phase !== 'playing') return null;
  return room.turnOrder[room.turnIdx] ?? null;
}

function roomState(room: Room): RoomState {
  const players: PlayerInfo[] = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    gems: p.gems,
    played: p.played,
    connected: p.connected,
    isAI: p.isAI || undefined,
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    activePlayerId: activePlayerId(room),
    tiles: room.tiles,
    isPvE: room.isPvE,
    isPublic: room.isPublic,
    aiDifficulty: room.aiDifficulty,
    rushAvailable: room.rushAvailable,
    rushVotingOpen: room.rushVotingOpen,
    rushVotes: [...room.rushVotes],
    rushActive: room.rushActive,
    rushSecondsRemaining: room.rushSecondsRemaining,
  };
}

function emptyRoom(overrides: Partial<Room> = {}): Room {
  return {
    code: '',
    hostId: '',
    phase: 'lobby',
    players: new Map(),
    round: 0,
    tiles: [],
    turnOrder: [],
    turnIdx: -1,
    timer: null,
    boardTimer: null,
    isPvE: false,
    isPublic: false,
    aiDifficulty: 'medium',
    rushAvailable: false,
    rushVotingOpen: false,
    rushVotes: new Set(),
    rushActive: false,
    rushSecondsRemaining: 0,
    rushGraceTimer: null,
    rushTicker: null,
    ...overrides,
  };
}

export function setupGame(io: Server) {
  io.on('connection', (socket: Socket) => {

    // ── room creation ────────────────────────────────────────────────────────
    socket.on('createRoom', (name: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const playerName = sanitizeName(name);
      if (!playerName) return cb({ ok: false, error: 'Enter a name first.' });
      const code = makeCode();
      const room = emptyRoom({ code, hostId: socket.id });
      room.players.set(socket.id, newPlayer(socket.id, playerName));
      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);
      cb({ ok: true, code });
      io.to(code).emit('roomState', roomState(room));
    });

    socket.on('startPvE', (name: unknown, difficulty: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const playerName = sanitizeName(name);
      if (!playerName) return cb({ ok: false, error: 'Enter a name first.' });
      const diff: AiDifficulty = ['easy', 'medium', 'hard'].includes(String(difficulty))
        ? (difficulty as AiDifficulty)
        : 'medium';
      const code = makeCode();
      const room = emptyRoom({ code, hostId: socket.id, isPvE: true, aiDifficulty: diff });
      room.players.set(socket.id, newPlayer(socket.id, playerName));
      room.players.set(AI_PLAYER_ID, newAiPlayer());
      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);
      cb({ ok: true, code });
      io.to(code).emit('roomState', roomState(room));
    });

    socket.on('joinRoom', (code: unknown, name: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const playerName = sanitizeName(name);
      if (!playerName) return cb({ ok: false, error: 'Enter a name first.' });
      const room = rooms.get(String(code ?? '').toUpperCase().trim());
      if (!room) return cb({ ok: false, error: 'Room not found.' });
      if (room.phase !== 'lobby') return cb({ ok: false, error: 'Game already in progress.' });
      if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full (6 players max).' });
      room.players.set(socket.id, newPlayer(socket.id, playerName));
      socketRoom.set(socket.id, room.code);
      socket.leave(LOBBY_CHANNEL); // they're entering a room, stop browsing
      socket.join(room.code);
      cb({ ok: true });
      io.to(room.code).emit('roomState', roomState(room));
      broadcastLobbies(io); // player count changed
    });

    // ── public lobby browser ───────────────────────────────────────────────────
    socket.on('subscribeLobbies', (cb: (res: object) => void) => {
      socket.join(LOBBY_CHANNEL);
      if (typeof cb === 'function') cb({ ok: true, rooms: publicRoomList() });
    });

    socket.on('unsubscribeLobbies', () => {
      socket.leave(LOBBY_CHANNEL);
    });

    socket.on('setVisibility', (isPublic: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      if (room.hostId !== socket.id) return cb({ ok: false, error: 'Only the host can change this.' });
      if (room.phase !== 'lobby') return cb({ ok: false, error: 'Only in the lobby.' });
      if (room.isPvE) return cb({ ok: false, error: 'Solo games cannot be public.' });
      room.isPublic = Boolean(isPublic);
      cb({ ok: true });
      io.to(room.code).emit('roomState', roomState(room));
      broadcastLobbies(io);
    });

    // ── game lifecycle ───────────────────────────────────────────────────────
    socket.on('startGame', () => {
      const room = getRoom(socket);
      if (!room || room.hostId !== socket.id) return;
      if (room.phase !== 'lobby' && room.phase !== 'finished') return;
      for (const p of room.players.values()) { p.score = 0; p.gems = START_GEMS; }
      room.round = 0;
      startRound(io, room);
      broadcastLobbies(io); // room left the lobby — drop it from the browser
    });

    socket.on('playAgain', () => {
      const room = getRoom(socket);
      if (!room || room.hostId !== socket.id || room.phase !== 'finished') return;
      for (const p of room.players.values()) {
        p.score = 0; p.gems = START_GEMS; p.played = false; p.word = ''; p.roundPoints = 0;
      }
      if (room.isPvE && !room.players.has(AI_PLAYER_ID)) {
        room.players.set(AI_PLAYER_ID, newAiPlayer());
      }
      room.phase = 'lobby';
      room.round = 0;
      clearRushState(room);
      io.to(room.code).emit('roomState', roomState(room));
      broadcastLobbies(io); // if public, it reappears in the browser
    });

    // ── rush-timer mechanic ──────────────────────────────────────────────────
    socket.on('pressStartTimer', (cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      if (!room || room.phase !== 'playing') return cb({ ok: false, error: 'Not in game.' });

      const activeId = activePlayerId(room);
      if (!activeId || activeId === socket.id) return cb({ ok: false, error: 'You are casting.' });

      if (!room.players.has(socket.id)) return cb({ ok: false, error: 'Not in this game.' });
      if (!room.rushAvailable) return cb({ ok: false, error: 'The next turn is starting.' });
      if (!room.rushVotingOpen) return cb({ ok: false, error: 'Rush voting is not open yet.' });

      if (room.rushActive) return cb({ ok: true }); // already rushing

      room.rushVotes.add(socket.id);
      cb({ ok: true });

      maybeActivateRush(io, room, activeId);
    });

    // ── word submission / turn actions ───────────────────────────────────────
    socket.on('submitWord', (path: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (!Array.isArray(path) || !isValidPath(path as number[])) {
        return cb({ ok: false, error: 'Invalid path.' });
      }
      const p = path as number[];
      const word = pathToWord(room.tiles, p);
      if (word.length < MIN_WORD_LEN || !getDictionary().has(word)) {
        return cb({ ok: false, error: `"${word}" is not a valid word.` });
      }
      // Capture boost usage before tiles are replaced
      const usedWordBoost = p.some((i) => room.tiles[i].wordMult > 1);
      const usedLetterBoost = p.some((i) => room.tiles[i].letterMult > 1);
      const points = scoreWord(room.tiles, p);
      const gemsCollected = p.filter((i) => room.tiles[i].gem).length;
      player.word = word;
      player.roundPoints = points;
      player.score += points;
      player.gems = Math.min(MAX_GEMS, player.gems + gemsCollected);
      player.played = true;
      cb({ ok: true, points, gemsCollected });

      io.to(room.code).emit('wordPlayed', { playerId: player.id, name: player.name, word, points, gemsCollected });

      clearBoardTimer(room);
      room.boardTimer = setTimeout(() => {
        for (const idx of p) room.tiles[idx] = freshTile();
        spreadGems(room.tiles);
        // Relocate used boosts so the next player sees fresh positions
        if (usedWordBoost) relocateWordBoost(room.tiles);
        if (usedLetterBoost) relocateLetterBoost(room.tiles);
        io.to(room.code).emit('boardUpdate', { tiles: room.tiles, replaced: p, cause: 'word' });
      }, BOARD_UPDATE_DELAY_MS);

      finishTurn(io, room);
    });

    socket.on('passTurn', () => {
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return;
      player.word = '';
      player.roundPoints = 0;
      player.played = true;
      finishTurn(io, room);
    });

    // ── abilities ────────────────────────────────────────────────────────────
    socket.on('useShuffle', (cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (player.gems < COST_SHUFFLE) return cb({ ok: false, error: 'Not enough gems.' });
      player.gems -= COST_SHUFFLE;
      shuffleBoard(room.tiles);
      cb({ ok: true });
      io.to(room.code).emit('boardUpdate', {
        tiles: room.tiles,
        replaced: room.tiles.map((_, i) => i),
        cause: 'shuffle',
      });
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('useSwap', (idx: unknown, letter: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (player.gems < COST_SWAP) return cb({ ok: false, error: 'Not enough gems.' });
      const i = Number(idx);
      const ch = String(letter ?? '').toUpperCase();
      if (!Number.isInteger(i) || i < 0 || i >= room.tiles.length || !/^[A-Z]$/.test(ch)) {
        return cb({ ok: false, error: 'Invalid swap.' });
      }
      player.gems -= COST_SWAP;
      room.tiles[i] = { ...room.tiles[i], letter: ch };
      cb({ ok: true });
      io.to(room.code).emit('boardUpdate', { tiles: room.tiles, replaced: [i], cause: 'swap' });
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('useHint', (cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (player.gems < COST_HINT) return cb({ ok: false, error: 'Not enough gems.' });
      const path = findRandomWord(room.tiles);
      if (!path) return cb({ ok: false, error: 'No word found — try a shuffle!' });
      player.gems -= COST_HINT;
      cb({ ok: true, path });
      io.to(room.code).emit('roomState', roomState(room));
    });

    // Time-extend only applies while the rush countdown is running
    socket.on('useTimeExtend', (cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (!room.rushActive) return cb({ ok: false, error: 'No countdown to extend.' });
      if (player.gems < COST_EXTEND) return cb({ ok: false, error: 'Not enough gems.' });
      player.gems -= COST_EXTEND;
      room.rushSecondsRemaining += EXTEND_SECONDS;
      cb({ ok: true, secondsRemaining: room.rushSecondsRemaining });
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('dragPath', (path: unknown) => {
      const room = getRoom(socket);
      if (!room || activePlayerId(room) !== socket.id) return;
      if (!Array.isArray(path) || path.length > 25 || !path.every((n) => Number.isInteger(n))) return;
      socket.volatile.to(room.code).emit('remoteDrag', { playerId: socket.id, path });
    });

    socket.on('leaveRoom', () => removeFromRoom(io, socket));
    socket.on('disconnect', () => removeFromRoom(io, socket));
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function newPlayer(id: string, name: string): Player {
  return { id, name, score: 0, gems: START_GEMS, played: false, word: '', roundPoints: 0, connected: true, isAI: false };
}

function newAiPlayer(): Player {
  return { id: AI_PLAYER_ID, name: AI_NAME, score: 0, gems: START_GEMS, played: false, word: '', roundPoints: 0, connected: true, isAI: true };
}

function sanitizeName(name: unknown): string {
  return String(name ?? '').trim().slice(0, 16);
}

function getRoom(socket: Socket): Room | undefined {
  const code = socketRoom.get(socket.id);
  return code ? rooms.get(code) : undefined;
}

/** Open, public, human-vs-human rooms still in the lobby, for the browser. */
function publicRoomList(): PublicRoom[] {
  const list: PublicRoom[] = [];
  for (const room of rooms.values()) {
    if (!room.isPublic || room.isPvE || room.phase !== 'lobby') continue;
    if (room.players.size >= MAX_PLAYERS) continue;
    const host = room.players.get(room.hostId);
    list.push({
      code: room.code,
      hostName: host?.name ?? '???',
      playerCount: room.players.size,
      maxPlayers: MAX_PLAYERS,
    });
  }
  return list.slice(0, 40);
}

function broadcastLobbies(io: Server) {
  io.to(LOBBY_CHANNEL).emit('publicRooms', publicRoomList());
}

function requireActive(room: Room | undefined, socket: Socket): Player | undefined {
  if (!room || room.phase !== 'playing') return undefined;
  if (activePlayerId(room) !== socket.id) return undefined;
  const player = room.players.get(socket.id);
  if (!player || player.played) return undefined;
  return player;
}

function clearRushState(room: Room) {
  clearRushGraceTimer(room);
  clearRushTicker(room);
  room.rushAvailable = false;
  room.rushVotingOpen = false;
  room.rushVotes = new Set();
  room.rushActive = false;
  room.rushSecondsRemaining = 0;
}

function beginRushState(io: Server, room: Room) {
  clearRushState(room);
  room.rushAvailable = true;
  const turnIdx = room.turnIdx;
  room.rushGraceTimer = setTimeout(() => {
    room.rushGraceTimer = null;
    if (room.phase !== 'playing' || room.turnIdx !== turnIdx || !room.rushAvailable) return;
    room.rushVotingOpen = true;
    io.to(room.code).emit('roomState', roomState(room));
  }, RUSH_GRACE_MS);
}

/**
 * Counts connected non-active, non-AI waiting players and their votes.
 * If required > 0 and voted >= required, activates the rush countdown.
 */
function maybeActivateRush(io: Server, room: Room, activeId: string) {
  const waitingPlayers = [...room.players.values()].filter(
    (p) => p.id !== activeId && !p.isAI && p.connected,
  );
  const allWaitingPlayersVoted = waitingPlayers.length > 0
    && waitingPlayers.every((player) => room.rushVotes.has(player.id));

  if (room.rushVotingOpen && allWaitingPlayersVoted) {
    clearRushGraceTimer(room);
    room.rushActive = true;
    room.rushVotingOpen = false;
    room.rushSecondsRemaining = RUSH_COUNTDOWN_SECONDS;
    startRushTicker(io, room);
  }
  io.to(room.code).emit('roomState', roomState(room));
}

// ── core game loop ───────────────────────────────────────────────────────────

function startRound(io: Server, room: Room) {
  room.round += 1;
  room.phase = 'playing';
  if (room.round === 1) {
    // First round: generate a fresh board with randomised letters and initial boosts.
    room.tiles = generateBoard();
  } else {
    // Subsequent rounds: the letter grid persists unchanged.
    // Only the 2x word boost relocates; the letter boost stays put.
    relocateWordBoost(room.tiles);
  }
  room.turnOrder = [...room.players.keys()];
  room.turnIdx = -1;
  for (const p of room.players.values()) {
    p.played = false; p.word = ''; p.roundPoints = 0;
  }
  io.to(room.code).emit('roundStart', { round: room.round, totalRounds: TOTAL_ROUNDS, tiles: room.tiles });
  nextTurn(io, room);
}

function nextTurn(io: Server, room: Room) {
  clearTimer(room);
  room.turnIdx += 1;
  // skip players who left mid-round (never skip the AI)
  while (
    room.turnIdx < room.turnOrder.length &&
    room.turnOrder[room.turnIdx] !== AI_PLAYER_ID &&
    !room.players.has(room.turnOrder[room.turnIdx])
  ) {
    room.turnIdx += 1;
  }
  if (room.turnIdx >= room.turnOrder.length) {
    endRound(io, room);
    return;
  }

  beginRushState(io, room);

  const activeId = room.turnOrder[room.turnIdx];
  if (activeId === AI_PLAYER_ID) {
    // AI plays automatically after its think delay; no rush needed (human may still rush below)
    io.to(room.code).emit('roomState', roomState(room));
    io.to(room.code).emit('turnStart', { playerId: activeId });
    room.timer = setTimeout(() => playAiTurn(io, room), AI_THINK_MS[room.aiDifficulty]);
  } else {
    // Human turn: unlimited time by default — waiting players can start a rush
    io.to(room.code).emit('roomState', roomState(room));
    io.to(room.code).emit('turnStart', { playerId: activeId });
  }
}

function onTurnTimeout(io: Server, room: Room) {
  if (room.phase !== 'playing') return;
  const player = room.players.get(room.turnOrder[room.turnIdx] ?? '');
  if (player) {
    player.word = '';
    player.roundPoints = 0;
    player.played = true;
  }
  nextTurn(io, room);
}

function finishTurn(io: Server, room: Room) {
  clearTimer(room);
  clearRushState(room);
  io.to(room.code).emit('roomState', roomState(room));
  room.timer = setTimeout(() => nextTurn(io, room), TURN_GAP_MS);
}

function endRound(io: Server, room: Room) {
  if (room.phase !== 'playing') return;
  clearTimer(room);
  clearRushState(room);
  room.phase = 'roundResults';

  const results: RoundResult[] = [...room.players.values()]
    .map((p) => ({ playerId: p.id, name: p.name, word: p.word || '—', points: p.roundPoints, total: p.score }))
    .sort((a, b) => b.total - a.total);

  io.to(room.code).emit('roomState', roomState(room));
  io.to(room.code).emit('roundEnd', { round: room.round, results });

  if (room.round >= TOTAL_ROUNDS) {
    room.timer = setTimeout(() => {
      room.phase = 'finished';
      const standings: RoundResult[] = [...room.players.values()]
        .map((p) => {
          const gemBonus = p.gems;
          p.score += gemBonus;
          p.gems = 0;
          return { playerId: p.id, name: p.name, word: p.word || '—', points: p.roundPoints, total: p.score, gemBonus };
        })
        .sort((a, b) => b.total - a.total);
      io.to(room.code).emit('roomState', roomState(room));
      io.to(room.code).emit('gameEnd', { standings });
    }, RESULTS_PAUSE_MS);
  } else {
    room.timer = setTimeout(() => startRound(io, room), RESULTS_PAUSE_MS);
  }
}

function clearTimer(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}
function clearRushGraceTimer(room: Room) {
  if (room.rushGraceTimer) { clearTimeout(room.rushGraceTimer); room.rushGraceTimer = null; }
}
function clearRushTicker(room: Room) {
  if (room.rushTicker) { clearInterval(room.rushTicker); room.rushTicker = null; }
}
function startRushTicker(io: Server, room: Room) {
  clearRushTicker(room);
  const turnIdx = room.turnIdx;
  room.rushTicker = setInterval(() => {
    if (room.phase !== 'playing' || room.turnIdx !== turnIdx || !room.rushActive) {
      clearRushTicker(room);
      return;
    }
    room.rushSecondsRemaining -= 1;
    if (room.rushSecondsRemaining <= 0) {
      clearRushTicker(room);
      onTurnTimeout(io, room);
      return;
    }
    io.to(room.code).emit('roomState', roomState(room));
  }, 1_000);
}
function clearBoardTimer(room: Room) {
  if (room.boardTimer) { clearTimeout(room.boardTimer); room.boardTimer = null; }
}

function removeFromRoom(io: Server, socket: Socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  socketRoom.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return;
  const wasActive = activePlayerId(room) === socket.id;
  room.players.delete(socket.id);
  socket.leave(code);

  const hasHumans = [...room.players.keys()].some((id) => id !== AI_PLAYER_ID);
  if (room.players.size === 0 || (room.isPvE && !hasHumans)) {
    clearTimer(room); clearBoardTimer(room); clearRushState(room); rooms.delete(code);
    broadcastLobbies(io); // room gone
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = [...room.players.keys()].find((id) => id !== AI_PLAYER_ID) ?? [...room.players.keys()][0];
  }

  if (room.phase === 'playing' && wasActive) {
    nextTurn(io, room);
  } else {
    // A waiting player disconnected mid-vote — recompute without their vote requirement
    if (room.phase === 'playing' && !room.rushActive) {
      const activeId = activePlayerId(room);
      if (activeId) maybeActivateRush(io, room, activeId);
      else io.to(code).emit('roomState', roomState(room));
    } else {
      io.to(code).emit('roomState', roomState(room));
    }
  }
  broadcastLobbies(io); // player count may have changed for a public lobby
}

// ── AI opponent ──────────────────────────────────────────────────────────────

function playAiTurn(io: Server, room: Room) {
  if (room.phase !== 'playing') return;
  const player = room.players.get(AI_PLAYER_ID);
  if (!player || player.played) return;

  const path = findWordByDifficulty(room.tiles, room.aiDifficulty);

  if (!path) {
    player.word = ''; player.roundPoints = 0; player.played = true;
    finishTurn(io, room);
    return;
  }

  let step = 0;
  const drag = setInterval(() => {
    // Stop if the turn was cancelled (rush timeout beat us)
    if (room.phase !== 'playing' || player.played) { clearInterval(drag); return; }
    step++;
    io.to(room.code).emit('remoteDrag', { playerId: AI_PLAYER_ID, path: path.slice(0, step) });
    if (step < path.length) return;
    clearInterval(drag);

    if (player.played) return; // rush expired between the last step and now
    // Capture boost usage before tiles are replaced
    const usedWordBoost = path.some((i) => room.tiles[i].wordMult > 1);
    const usedLetterBoost = path.some((i) => room.tiles[i].letterMult > 1);
    const word = pathToWord(room.tiles, path);
    const points = scoreWord(room.tiles, path);
    const gemsCollected = path.filter((i) => room.tiles[i].gem).length;
    player.word = word;
    player.roundPoints = points;
    player.score += points;
    player.gems = Math.min(MAX_GEMS, player.gems + gemsCollected);
    player.played = true;

    io.to(room.code).emit('wordPlayed', { playerId: AI_PLAYER_ID, name: player.name, word, points, gemsCollected });

    clearBoardTimer(room);
    room.boardTimer = setTimeout(() => {
      if (room.phase !== 'playing') return;
      for (const idx of path) room.tiles[idx] = freshTile();
      spreadGems(room.tiles);
      if (usedWordBoost) relocateWordBoost(room.tiles);
      if (usedLetterBoost) relocateLetterBoost(room.tiles);
      io.to(room.code).emit('boardUpdate', { tiles: room.tiles, replaced: path, cause: 'word' });
    }, BOARD_UPDATE_DELAY_MS);

    finishTurn(io, room);
  }, AI_DRAG_STEP_MS);
}
