import type { BoardTile } from './scoring';

export interface PlayerInfo {
  id: string;
  name: string;
  score: number;
  submitted: boolean;
  connected: boolean;
}

export interface RoundResult {
  playerId: string;
  name: string;
  word: string;
  points: number;
  total: number;
}

export type RoomPhase = 'lobby' | 'playing' | 'roundResults' | 'finished';

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  players: PlayerInfo[];
  round: number; // 1-based, 0 in lobby
  totalRounds: number;
}

// client -> server
export interface ClientEvents {
  createRoom: (name: string, cb: (res: { ok: true; code: string } | { ok: false; error: string }) => void) => void;
  joinRoom: (code: string, name: string, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  startGame: () => void;
  submitWord: (path: number[], cb: (res: { ok: true; points: number } | { ok: false; error: string }) => void) => void;
  playAgain: () => void;
  leaveRoom: () => void;
}

// server -> client
export interface ServerEvents {
  roomState: (state: RoomState) => void;
  roundStart: (data: { round: number; totalRounds: number; tiles: BoardTile[]; endsAt: number }) => void;
  roundEnd: (data: { round: number; results: RoundResult[] }) => void;
  gameEnd: (data: { standings: RoundResult[] }) => void;
}
