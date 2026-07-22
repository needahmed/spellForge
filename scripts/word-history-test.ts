import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { getAppliedBoosts, isAdjacent, type BoardTile } from '../shared/scoring';
import type { RoomState } from '../shared/types';

const URL = 'http://localhost:3001';
const dictionary = new Set(
  readFileSync('public/dict/enable1.txt', 'utf8').split(/\r?\n/).filter(Boolean).map((word) => word.toUpperCase()),
);

function findWord(tiles: BoardTile[]): number[] | null {
  let found: number[] | null = null;
  const visit = (path: number[]) => {
    if (found) return;
    const word = path.map((idx) => tiles[idx].letter).join('');
    if (path.length >= 3 && dictionary.has(word)) { found = [...path]; return; }
    if (path.length >= 6) return;
    for (let idx = 0; idx < tiles.length; idx++) {
      if (!path.includes(idx) && isAdjacent(path[path.length - 1], idx)) {
        visit([...path, idx]);
        if (found) return;
      }
    }
  };
  for (let idx = 0; idx < tiles.length && !found; idx++) visit([idx]);
  return found;
}

function waitForState(socket: Socket, predicate: (state: RoomState) => boolean, timeoutMs = 10_000): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('roomState', onState);
      reject(new Error('Timed out waiting for room state'));
    }, timeoutMs);
    const onState = (state: RoomState) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('roomState', onState);
      resolve(state);
    };
    socket.on('roomState', onState);
  });
}

function emitAck<T>(socket: Socket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => socket.emit(event, ...args, resolve));
}

const multiplierBoard: BoardTile[] = Array.from({ length: 25 }, () => ({
  letter: 'A', letterMult: 1, wordMult: 1, gem: false,
}));
multiplierBoard[0].letterMult = 2;
multiplierBoard[1].wordMult = 2;
assert.deepEqual(getAppliedBoosts(multiplierBoard, [0, 1, 2]), [
  { letterIndex: 0, type: 'DL' },
  { letterIndex: 1, type: '2X' },
]);

const alice = io(URL);
const bob = io(URL);
const solo = io(URL);

try {
  await Promise.all([alice, bob, solo].map((socket) => new Promise<void>((resolve) => socket.on('connect', resolve))));
  const created = await emitAck<{ ok: boolean; code?: string }>(alice, 'createRoom', 'Alice');
  assert.equal(created.ok, true);
  assert.ok(created.code);
  assert.equal((await emitAck<{ ok: boolean }>(bob, 'joinRoom', created.code, 'Bob')).ok, true);

  const aliceTurnPromise = waitForState(alice, (state) => state.phase === 'playing' && state.activePlayerId === alice.id);
  alice.emit('startGame');
  const aliceTurn = await aliceTurnPromise;
  const path = findWord(aliceTurn.tiles);
  assert.ok(path, 'expected a playable word');
  const expectedWord = path.map((idx) => aliceTurn.tiles[idx].letter).join('');
  const submitted = await emitAck<{ ok: boolean; points?: number }>(alice, 'submitWord', path);
  assert.equal(submitted.ok, true);

  const afterWord = await waitForState(alice, (state) => state.players.some(
    (player) => player.id === alice.id && player.wordHistory.length === 1,
  ));
  const aliceHistory = afterWord.players.find((player) => player.id === alice.id)!.wordHistory;
  assert.equal(aliceHistory[0].round, 1);
  assert.equal(aliceHistory[0].word, expectedWord);
  assert.equal(aliceHistory[0].score, submitted.points);

  await waitForState(alice, (state) => state.activePlayerId === bob.id);
  bob.emit('passTurn');
  const afterPass = await waitForState(alice, (state) => state.players.some(
    (player) => player.id === bob.id && player.wordHistory.length === 1,
  ));
  const bobHistory = afterPass.players.find((player) => player.id === bob.id)!.wordHistory;
  assert.deepEqual(bobHistory[0], { round: 1, word: '—', score: 0, boosts: [] });

  const pve = await emitAck<{ ok: boolean }>(solo, 'startPvE', 'Solo', 'medium');
  assert.equal(pve.ok, true);
  const soloTurnPromise = waitForState(solo, (state) => state.phase === 'playing' && state.activePlayerId === solo.id);
  solo.emit('startGame');
  await soloTurnPromise;
  solo.emit('passTurn');
  const afterAiTurn = await waitForState(solo, (state) => state.players.some(
    (player) => player.isAI && player.wordHistory.length === 1,
  ), 15_000);
  const aiHistory = afterAiTurn.players.find((player) => player.isAI)!.wordHistory;
  assert.equal(aiHistory[0].round, 1);
  assert.equal(typeof aiHistory[0].score, 'number');

  console.log('PASS: human/AI word history, boost metadata, and skipped turns');
} finally {
  alice.disconnect();
  bob.disconnect();
  solo.disconnect();
}
