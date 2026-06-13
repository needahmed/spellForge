import type { BoardTile } from './scoring';

export interface PlayerInfo {
  id: string;
  name: string;
  score: number;
  gems: number;
  /** has finished their turn this round */
  played: boolean;
  connected: boolean;
  isAI?: boolean;
}

export interface RoundResult {
  playerId: string;
  name: string;
  word: string;
  points: number;
  total: number;
  /** end-of-game only: leftover gems converted to points */
  gemBonus?: number;
}

export type RoomPhase = 'lobby' | 'playing' | 'roundResults' | 'finished';

export type AiDifficulty = 'easy' | 'medium' | 'hard';

/** A joinable public room, as shown in the lobby browser. */
export interface PublicRoom {
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  players: PlayerInfo[];
  round: number; // 1-based, 0 in lobby
  totalRounds: number;
  activePlayerId: string | null;
  /** current board — lets late-mounting clients render without waiting for the next event */
  tiles: BoardTile[];
  turnEndsAt: number;
  isPvE: boolean;
  aiDifficulty: AiDifficulty;
  /** absolute ms timestamp when the current turn started (for 15 s grace countdown) */
  turnStartedAt: number;
  /** player IDs that have pressed Start Timer this turn */
  rushVotes: string[];
  /** the 10-second countdown is now running */
  rushActive: boolean;
  /** absolute ms timestamp when the rush countdown expires */
  rushEndsAt: number;
  /** listed in the public lobby browser (host-controlled, lobby only) */
  isPublic: boolean;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

// client -> server
export interface ClientEvents {
  createRoom: (name: string, cb: Ack<{ code: string }>) => void;
  joinRoom: (code: string, name: string, cb: Ack) => void;
  startPvE: (name: string, difficulty: AiDifficulty, cb: Ack<{ code: string }>) => void;
  startGame: () => void;
  setVisibility: (isPublic: boolean, cb: Ack) => void;
  subscribeLobbies: (cb: Ack<{ rooms: PublicRoom[] }>) => void;
  unsubscribeLobbies: () => void;
  pressStartTimer: (cb: Ack) => void;
  submitWord: (path: number[], cb: Ack<{ points: number; gemsCollected: number }>) => void;
  passTurn: () => void;
  useShuffle: (cb: Ack) => void;
  useSwap: (idx: number, letter: string, cb: Ack) => void;
  useHint: (cb: Ack<{ path: number[] }>) => void;
  useTimeExtend: (cb: Ack<{ endsAt: number }>) => void;
  dragPath: (path: number[]) => void;
  playAgain: () => void;
  leaveRoom: () => void;
}

// server -> client
export interface ServerEvents {
  roomState: (state: RoomState) => void;
  publicRooms: (rooms: PublicRoom[]) => void;
  roundStart: (data: { round: number; totalRounds: number; tiles: BoardTile[] }) => void;
  turnStart: (data: { playerId: string; endsAt: number }) => void;
  wordPlayed: (data: { playerId: string; name: string; word: string; points: number; gemsCollected: number }) => void;
  boardUpdate: (data: { tiles: BoardTile[]; replaced: number[]; cause: 'word' | 'shuffle' | 'swap' }) => void;
  remoteDrag: (data: { playerId: string; path: number[] }) => void;
  roundEnd: (data: { round: number; results: RoundResult[] }) => void;
  gameEnd: (data: { standings: RoundResult[] }) => void;
}
