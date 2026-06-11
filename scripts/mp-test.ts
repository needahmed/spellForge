// Headless 2-player smoke test against the dev server.
import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';
import type { BoardTile } from '../shared/scoring';
import { isAdjacent } from '../shared/scoring';

const URL = 'http://localhost:3001';
const dict = new Set(
  readFileSync('public/dict/enable1.txt', 'utf8').split(/\r?\n/).filter(Boolean).map((w) => w.toUpperCase()),
);

function findWord(tiles: BoardTile[], minLen = 4): number[] | null {
  let found: number[] | null = null;
  const dfs = (path: number[]) => {
    if (found) return;
    const w = path.map((i) => tiles[i].letter).join('');
    if (path.length >= minLen && dict.has(w)) {
      found = [...path];
      return;
    }
    if (path.length >= 6) return;
    for (let n = 0; n < 25; n++) {
      if (!path.includes(n) && isAdjacent(path[path.length - 1], n)) {
        path.push(n);
        dfs(path);
        path.pop();
        if (found) return;
      }
    }
  };
  for (let s = 0; s < 25 && !found; s++) dfs([s]);
  return found;
}

const a = io(URL);
const b = io(URL);
let rounds = 0;
let invalidChecked = false;

const submit = (sock: ReturnType<typeof io>, who: string, tiles: BoardTile[]) => {
  const path = findWord(tiles);
  if (!path) {
    console.log(`${who}: no word found?!`);
    return;
  }
  const word = path.map((i) => tiles[i].letter).join('');
  sock.emit('submitWord', path, (res: { ok: boolean; points?: number; error?: string }) => {
    console.log(`${who} submitted ${word}:`, JSON.stringify(res));
  });
};

a.on('connect', () => {
  a.emit('createRoom', 'Alice', (res: { ok: boolean; code?: string }) => {
    console.log('createRoom:', JSON.stringify(res));
    if (!res.ok || !res.code) process.exit(1);
    b.emit('joinRoom', res.code, 'Bob', (jr: { ok: boolean; error?: string }) => {
      console.log('joinRoom:', JSON.stringify(jr));
      if (!jr.ok) process.exit(1);
      a.emit('startGame');
    });
  });
});

a.on('roundStart', (data: { round: number; tiles: BoardTile[] }) => {
  rounds = data.round;
  console.log(`--- round ${data.round} ---`);
  if (!invalidChecked) {
    invalidChecked = true;
    // junk path: not adjacent
    a.emit('submitWord', [0, 14, 3], (res: object) => console.log('Alice junk path:', JSON.stringify(res)));
    // gibberish but adjacent — likely invalid word
    const bad = [0, 1, 0];
    a.emit('submitWord', bad, (res: object) => console.log('Alice reused tile:', JSON.stringify(res)));
  }
  submit(a, 'Alice', data.tiles);
  submit(b, 'Bob', data.tiles);
});

a.on('roundEnd', (data: { round: number; results: { name: string; word: string; points: number; total: number }[] }) => {
  console.log(`round ${data.round} results:`, data.results.map((r) => `${r.name}: ${r.word} +${r.points} (total ${r.total})`).join(' | '));
});

a.on('gameEnd', (data: { standings: { name: string; total: number }[] }) => {
  console.log('GAME END:', data.standings.map((s) => `${s.name}=${s.total}`).join(', '));
  if (rounds !== 5) {
    console.log('FAIL: expected 5 rounds, got', rounds);
    process.exit(1);
  }
  console.log('PASS');
  process.exit(0);
});

setTimeout(() => {
  console.log('FAIL: timeout');
  process.exit(1);
}, 90_000);
