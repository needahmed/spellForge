// Headless 2-player smoke test against the dev server: turn-based flow,
// gems, abilities, cascade, and end-of-game gem bonus.
import { io, type Socket } from 'socket.io-client';
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
let tiles: BoardTile[] = [];
let round = 0;
let abilitiesTested = false;
let failed = false;
const fail = (msg: string) => {
  console.log('FAIL:', msg);
  failed = true;
  process.exit(1);
};

const accepted = new Set<string>(); // `${who}:${round}` — guards against double-accepted turns

const takeTurn = (sock: Socket, who: string) => {
  const path = findWord(tiles);
  if (!path) {
    console.log(`${who}: no word — passing`);
    sock.emit('passTurn');
    return;
  }
  const word = path.map((i) => tiles[i].letter).join('');
  const gems = path.filter((i) => tiles[i].gem).length;
  sock.emit('submitWord', path, (res: { ok: boolean; points?: number; gemsCollected?: number; error?: string }) => {
    console.log(`${who} cast ${word}:`, JSON.stringify(res));
    if (!res.ok) fail(`${who} submit rejected`);
    const key = `${who}:${round}`;
    if (accepted.has(key)) fail(`${who} got two words accepted in round ${round}`);
    accepted.add(key);
    if (res.gemsCollected !== gems) fail(`gem count mismatch: expected ${gems}, got ${res.gemsCollected}`);
  });
};

const testAbilities = (done: () => void) => {
  // Alice has 3 starting gems: hint (4) must fail, shuffle (1) ok -> 2 left, swap (3) must fail
  a.emit('useHint', (res: { ok: boolean }) => {
    if (res.ok) fail('hint should fail with 3 gems');
    console.log('hint w/ 3 gems correctly rejected');
    a.emit('useShuffle', (res2: { ok: boolean }) => {
      if (!res2.ok) fail('shuffle should succeed');
      console.log('shuffle ok (gems 3 -> 2)');
      a.emit('useSwap', 0, 'E', (res3: { ok: boolean }) => {
        if (res3.ok) fail('swap should fail with 2 gems');
        console.log('swap w/ 2 gems correctly rejected');
        // Time-extend only applies during a rush countdown; on a normal turn it's rejected.
        a.emit('useTimeExtend', (res4: { ok: boolean }) => {
          if (res4.ok) fail('time extend should be rejected outside a rush');
          console.log('time extend correctly rejected outside rush');
          done();
        });
      });
    });
  });
};

a.on('connect', () => {
  a.emit('createRoom', 'Alice', (res: { ok: boolean; code?: string }) => {
    console.log('createRoom:', JSON.stringify(res));
    if (!res.ok || !res.code) return fail('createRoom');
    b.emit('joinRoom', res.code, 'Bob', (jr: { ok: boolean }) => {
      console.log('joinRoom:', JSON.stringify(jr));
      if (!jr.ok) return fail('joinRoom');
      a.emit('startGame');
    });
  });
});

a.on('roundStart', (data: { round: number; tiles: BoardTile[] }) => {
  round = data.round;
  tiles = data.tiles;
  console.log(`--- round ${data.round} ---`);
});

a.on('boardUpdate', (data: { tiles: BoardTile[]; replaced: number[]; cause: string }) => {
  tiles = data.tiles;
  console.log(`board update: ${data.cause}, ${data.replaced.length} tiles`);
});

const turnsSeen = new Set<string>();
a.on('turnStart', ({ playerId }: { playerId: string }) => {
  // time-extend re-emits turnStart for the same turn — only act once
  const turnKey = `${playerId}:${round}`;
  if (turnsSeen.has(turnKey)) return;
  turnsSeen.add(turnKey);
  // out-of-turn submit must be rejected
  const idle = playerId === a.id ? b : a;
  idle.emit('submitWord', [0, 1, 2], (res: { ok: boolean }) => {
    if (res.ok) fail('out-of-turn submit accepted!');
  });
  if (playerId === a.id) {
    if (!abilitiesTested && round === 1) {
      abilitiesTested = true;
      testAbilities(() => takeTurn(a, 'Alice'));
    } else {
      takeTurn(a, 'Alice');
    }
  } else if (playerId === b.id) {
    takeTurn(b, 'Bob');
  }
});

a.on('roundEnd', (data: { round: number; results: { name: string; word: string; points: number; total: number }[] }) => {
  console.log(
    `round ${data.round} results:`,
    data.results.map((r) => `${r.name}: ${r.word} +${r.points} (total ${r.total})`).join(' | '),
  );
});

a.on('gameEnd', (data: { standings: { name: string; total: number; gemBonus?: number }[] }) => {
  console.log('GAME END:', data.standings.map((s) => `${s.name}=${s.total} (gem bonus ${s.gemBonus})`).join(', '));
  if (round !== 5) fail(`expected 5 rounds, got ${round}`);
  if (!data.standings.every((s) => typeof s.gemBonus === 'number')) fail('missing gem bonus');
  if (!failed) console.log('PASS');
  process.exit(0);
});

setTimeout(() => fail('timeout'), 120_000);
