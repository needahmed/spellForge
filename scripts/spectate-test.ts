// Creates a room, waits for a second (human/browser) player, then on its turn
// drags a word slowly (streaming dragPath) and submits — for testing spectator UX.
import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';
import type { BoardTile } from '../shared/scoring';
import { isAdjacent } from '../shared/scoring';

const dict = new Set(
  readFileSync('public/dict/enable1.txt', 'utf8').split(/\r?\n/).filter(Boolean).map((w) => w.toUpperCase()),
);

function findWord(tiles: BoardTile[]): number[] | null {
  let found: number[] | null = null;
  const dfs = (path: number[]) => {
    if (found) return;
    const w = path.map((i) => tiles[i].letter).join('');
    if (path.length >= 4 && dict.has(w)) {
      found = [...path];
      return;
    }
    if (path.length >= 5) return;
    for (let n = 0; n < 25 && !found; n++) {
      if (!path.includes(n) && isAdjacent(path[path.length - 1], n)) {
        path.push(n);
        dfs(path);
        path.pop();
      }
    }
  };
  for (let s = 0; s < 25 && !found; s++) dfs([s]);
  return found;
}

const s = io('http://localhost:3001');
let tiles: BoardTile[] = [];
let started = false;

s.on('connect', () => {
  s.emit('createRoom', 'Robo', (res: { ok: boolean; code?: string }) => {
    console.log('CODE:' + res.code);
  });
});

s.on('roomState', (state: { phase: string; players: { id: string }[] }) => {
  if (!started && state.phase === 'lobby' && state.players.length === 2) {
    started = true;
    console.log('second player joined — starting');
    setTimeout(() => s.emit('startGame'), 500);
  }
});

s.on('roundStart', (data: { tiles: BoardTile[] }) => {
  tiles = data.tiles;
});
s.on('boardUpdate', (data: { tiles: BoardTile[] }) => {
  tiles = data.tiles;
});

s.on('turnStart', async ({ playerId }: { playerId: string }) => {
  if (playerId !== s.id) return;
  const path = findWord(tiles);
  if (!path) {
    s.emit('passTurn');
    return;
  }
  console.log('my turn, dragging', path.map((i) => tiles[i].letter).join(''));
  for (let i = 1; i <= path.length; i++) {
    s.emit('dragPath', path.slice(0, i));
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1500));
  s.emit('submitWord', path, (res: object) => console.log('submitted:', JSON.stringify(res)));
});

s.on('gameEnd', () => {
  console.log('game over');
  process.exit(0);
});
setTimeout(() => process.exit(0), 180_000);
