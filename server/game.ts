import type { Server, Socket } from 'socket.io';
import type { BoardTile } from '../shared/scoring';
import { isValidPath, pathToWord, scoreWord, MIN_WORD_LEN } from '../shared/scoring';
import type { PlayerInfo, RoomState, RoundResult } from '../shared/types';
import { generateBoard } from './board';
import { getDictionary } from './dictionary';

const TOTAL_ROUNDS = 5;
const ROUND_SECONDS = 75;
const RESULTS_PAUSE_MS = 6000;
const MAX_PLAYERS = 6;

interface Player {
  id: string;
  name: string;
  score: number;
  submitted: boolean;
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
  roundTimer: ReturnType<typeof setTimeout> | null;
  roundEndsAt: number;
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

function roomState(room: Room): RoomState {
  const players: PlayerInfo[] = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    submitted: p.submitted,
    connected: p.connected,
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
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
        roundTimer: null,
        roundEndsAt: 0,
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
      }
      room.round = 0;
      startRound(io, room);
    });

    socket.on('submitWord', (path: unknown, cb: (res: object) => void) => {
      if (typeof cb !== 'function') return;
      const room = getRoom(socket);
      if (!room || room.phase !== 'playing') return cb({ ok: false, error: 'No active round.' });
      const player = room.players.get(socket.id);
      if (!player) return cb({ ok: false, error: 'Not in this game.' });
      if (player.submitted) return cb({ ok: false, error: 'Already submitted this round.' });
      if (!Array.isArray(path) || !isValidPath(path as number[])) {
        return cb({ ok: false, error: 'Invalid path.' });
      }
      const p = path as number[];
      const word = pathToWord(room.tiles, p);
      if (word.length < MIN_WORD_LEN || !getDictionary().has(word)) {
        return cb({ ok: false, error: `"${word}" is not a valid word.` });
      }
      const points = scoreWord(room.tiles, p);
      player.submitted = true;
      player.word = word;
      player.roundPoints = points;
      player.score += points;
      cb({ ok: true, points });
      io.to(room.code).emit('roomState', roomState(room));

      const allDone = [...room.players.values()].every((pl) => pl.submitted || !pl.connected);
      if (allDone) endRound(io, room);
    });

    socket.on('playAgain', () => {
      const room = getRoom(socket);
      if (!room || room.hostId !== socket.id || room.phase !== 'finished') return;
      for (const p of room.players.values()) {
        p.score = 0;
        p.submitted = false;
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
  return { id, name, score: 0, submitted: false, word: '', roundPoints: 0, connected: true };
}

function sanitizeName(name: unknown): string {
  return String(name ?? '').trim().slice(0, 16);
}

function getRoom(socket: Socket): Room | undefined {
  const code = socketRoom.get(socket.id);
  return code ? rooms.get(code) : undefined;
}

function startRound(io: Server, room: Room) {
  room.round += 1;
  room.phase = 'playing';
  room.tiles = generateBoard();
  room.roundEndsAt = Date.now() + ROUND_SECONDS * 1000;
  for (const p of room.players.values()) {
    p.submitted = false;
    p.word = '';
    p.roundPoints = 0;
  }
  io.to(room.code).emit('roomState', roomState(room));
  io.to(room.code).emit('roundStart', {
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    tiles: room.tiles,
    endsAt: room.roundEndsAt,
  });
  clearTimer(room);
  room.roundTimer = setTimeout(() => endRound(io, room), ROUND_SECONDS * 1000);
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
    room.roundTimer = setTimeout(() => {
      room.phase = 'finished';
      io.to(room.code).emit('roomState', roomState(room));
      io.to(room.code).emit('gameEnd', { standings: results });
    }, RESULTS_PAUSE_MS);
  } else {
    room.roundTimer = setTimeout(() => startRound(io, room), RESULTS_PAUSE_MS);
  }
}

function clearTimer(room: Room) {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
}

function removeFromRoom(io: Server, socket: Socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  socketRoom.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(code);

  if (room.players.size === 0) {
    clearTimer(room);
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = [...room.players.keys()][0];
  }
  io.to(code).emit('roomState', roomState(room));

  // If everyone left has submitted, close the round out.
  if (room.phase === 'playing') {
    const allDone = [...room.players.values()].every((pl) => pl.submitted || !pl.connected);
    if (allDone) endRound(io, room);
  }
}
