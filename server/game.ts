import type { Server, Socket } from 'socket.io';
import type { BoardTile } from '../shared/scoring';
import { isValidPath, pathToWord, scoreWord, MIN_WORD_LEN } from '../shared/scoring';
import type { PlayerInfo, RoomState, RoundResult } from '../shared/types';
import { freshTile, generateBoard, shuffleBoard } from './board';
import { findRandomWord, getDictionary } from './dictionary';

const TOTAL_ROUNDS = 5;
const TURN_SECONDS = 45;
const TURN_GAP_MS = 1800; // pause between turns so everyone sees the played word
const BOARD_UPDATE_DELAY_MS = 900; // let the success flash play before tiles cascade
const RESULTS_PAUSE_MS = 6000;
const MAX_PLAYERS = 6;

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
  turnEndsAt: number;
  timer: ReturnType<typeof setTimeout> | null; // turn timer / gap timer / results timer
  boardTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>(); // socket.id -> room code

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
    turnEndsAt: room.turnEndsAt,
  };
}

export function setupGame(io: Server) {
  io.on('connection', (socket: Socket) => {
    socket.on('createRoom', (name: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const playerName = sanitizeName(name);
      if (!playerName) return cb({ ok: false, error: 'Enter a name first.' });
      const code = makeCode();
      const room: Room = {
        code,
        hostId: socket.id,
        phase: 'lobby',
        players: new Map(),
        round: 0,
        tiles: [],
        turnOrder: [],
        turnIdx: -1,
        turnEndsAt: 0,
        timer: null,
        boardTimer: null,
      };
      room.players.set(socket.id, newPlayer(socket.id, playerName));
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
      socket.join(room.code);
      cb({ ok: true });
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('startGame', () => {
      const room = getRoom(socket);
      if (!room || room.hostId !== socket.id) return;
      if (room.phase !== 'lobby' && room.phase !== 'finished') return;
      for (const p of room.players.values()) {
        p.score = 0;
        p.gems = START_GEMS;
      }
      room.round = 0;
      startRound(io, room);
    });

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
      const points = scoreWord(room.tiles, p);
      const gemsCollected = p.filter((i) => room.tiles[i].gem).length;
      player.word = word;
      player.roundPoints = points;
      player.score += points;
      player.gems = Math.min(MAX_GEMS, player.gems + gemsCollected);
      player.played = true;
      cb({ ok: true, points, gemsCollected });

      io.to(room.code).emit('wordPlayed', { playerId: player.id, name: player.name, word, points, gemsCollected });

      // cascade: used tiles drop out and fresh ones fall in (slightly delayed
      // so the submitter's success flash isn't cut short)
      clearBoardTimer(room);
      room.boardTimer = setTimeout(() => {
        for (const idx of p) room.tiles[idx] = freshTile();
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

    socket.on('useTimeExtend', (cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      const player = requireActive(room, socket);
      if (!room || !player) return cb({ ok: false, error: 'Not your turn.' });
      if (player.gems < COST_EXTEND) return cb({ ok: false, error: 'Not enough gems.' });
      player.gems -= COST_EXTEND;
      room.turnEndsAt += EXTEND_SECONDS * 1000;
      clearTimer(room);
      room.timer = setTimeout(() => onTurnTimeout(io, room), room.turnEndsAt - Date.now());
      cb({ ok: true, endsAt: room.turnEndsAt });
      io.to(room.code).emit('turnStart', { playerId: player.id, endsAt: room.turnEndsAt });
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('dragPath', (path: unknown) => {
      const room = getRoom(socket);
      if (!room || activePlayerId(room) !== socket.id) return;
      if (!Array.isArray(path) || path.length > 25 || !path.every((n) => Number.isInteger(n))) return;
      socket.volatile.to(room.code).emit('remoteDrag', { playerId: socket.id, path });
    });

    socket.on('playAgain', () => {
      const room = getRoom(socket);
      if (!room || room.hostId !== socket.id || room.phase !== 'finished') return;
      for (const p of room.players.values()) {
        p.score = 0;
        p.gems = START_GEMS;
        p.played = false;
        p.word = '';
        p.roundPoints = 0;
      }
      room.phase = 'lobby';
      room.round = 0;
      io.to(room.code).emit('roomState', roomState(room));
    });

    socket.on('leaveRoom', () => removeFromRoom(io, socket));
    socket.on('disconnect', () => removeFromRoom(io, socket));
  });
}

function newPlayer(id: string, name: string): Player {
  return { id, name, score: 0, gems: START_GEMS, played: false, word: '', roundPoints: 0, connected: true };
}

function sanitizeName(name: unknown): string {
  return String(name ?? '').trim().slice(0, 16);
}

function getRoom(socket: Socket): Room | undefined {
  const code = socketRoom.get(socket.id);
  return code ? rooms.get(code) : undefined;
}

/** The player, but only if it's their turn right now and they haven't acted yet. */
function requireActive(room: Room | undefined, socket: Socket): Player | undefined {
  if (!room || room.phase !== 'playing') return undefined;
  if (activePlayerId(room) !== socket.id) return undefined;
  const player = room.players.get(socket.id);
  if (!player || player.played) return undefined; // turn already finished (gap before next turn)
  return player;
}

function startRound(io: Server, room: Room) {
  room.round += 1;
  room.phase = 'playing';
  room.tiles = generateBoard();
  room.turnOrder = [...room.players.keys()];
  room.turnIdx = -1;
  for (const p of room.players.values()) {
    p.played = false;
    p.word = '';
    p.roundPoints = 0;
  }
  io.to(room.code).emit('roundStart', { round: room.round, totalRounds: TOTAL_ROUNDS, tiles: room.tiles });
  nextTurn(io, room);
}

function nextTurn(io: Server, room: Room) {
  clearTimer(room);
  room.turnIdx += 1;
  // skip players who left mid-round
  while (room.turnIdx < room.turnOrder.length && !room.players.has(room.turnOrder[room.turnIdx])) {
    room.turnIdx += 1;
  }
  if (room.turnIdx >= room.turnOrder.length) {
    endRound(io, room);
    return;
  }
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  io.to(room.code).emit('roomState', roomState(room));
  io.to(room.code).emit('turnStart', { playerId: room.turnOrder[room.turnIdx], endsAt: room.turnEndsAt });
  room.timer = setTimeout(() => onTurnTimeout(io, room), TURN_SECONDS * 1000);
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

/** After a word/pass: short gap so everyone sees what happened, then the next turn. */
function finishTurn(io: Server, room: Room) {
  clearTimer(room);
  io.to(room.code).emit('roomState', roomState(room));
  room.timer = setTimeout(() => nextTurn(io, room), TURN_GAP_MS);
}

function endRound(io: Server, room: Room) {
  if (room.phase !== 'playing') return;
  clearTimer(room);
  room.phase = 'roundResults';

  const results: RoundResult[] = [...room.players.values()]
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      word: p.word || '—',
      points: p.roundPoints,
      total: p.score,
    }))
    .sort((a, b) => b.total - a.total);

  io.to(room.code).emit('roomState', roomState(room));
  io.to(room.code).emit('roundEnd', { round: room.round, results });

  if (room.round >= TOTAL_ROUNDS) {
    room.timer = setTimeout(() => {
      room.phase = 'finished';
      // leftover gems convert to 1 point each
      const standings: RoundResult[] = [...room.players.values()]
        .map((p) => {
          const gemBonus = p.gems;
          p.score += gemBonus;
          p.gems = 0;
          return {
            playerId: p.id,
            name: p.name,
            word: p.word || '—',
            points: p.roundPoints,
            total: p.score,
            gemBonus,
          };
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
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function clearBoardTimer(room: Room) {
  if (room.boardTimer) {
    clearTimeout(room.boardTimer);
    room.boardTimer = null;
  }
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

  if (room.players.size === 0) {
    clearTimer(room);
    clearBoardTimer(room);
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = [...room.players.keys()][0];
  }

  if (room.phase === 'playing' && wasActive) {
    nextTurn(io, room);
  } else {
    io.to(code).emit('roomState', roomState(room));
  }
}
