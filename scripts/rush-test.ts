import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { RUSH_COUNTDOWN_SECONDS } from '../shared/rush';
import type { RoomState } from '../shared/types';

const URL = 'http://localhost:3001';
type Ack = { ok: boolean; code?: string; error?: string };

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => socket.emit(event, ...args, resolve));
}

function waitForState(socket: Socket, predicate: (state: RoomState) => boolean, timeoutMs = 5_000): Promise<RoomState> {
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

function assertFreshTurn(state: RoomState, activePlayerId: string) {
  assert.equal(state.activePlayerId, activePlayerId);
  assert.deepEqual(state.rushVotes, []);
  assert.equal(state.rushActive, false);
  assert.equal(state.rushAvailable, true);
  assert.equal(state.rushVotingOpen, false);
  assert.equal(state.rushSecondsRemaining, 0);
}

const players = [io(URL), io(URL), io(URL)];
const [alice, bob, cara] = players;

try {
  await Promise.all(players.map((socket) => new Promise<void>((resolve) => socket.on('connect', resolve))));

  const created = await emitAck(alice, 'createRoom', 'Alice');
  assert.equal(created.ok, true);
  assert.ok(created.code);
  assert.equal((await emitAck(bob, 'joinRoom', created.code, 'Bob')).ok, true);
  assert.equal((await emitAck(cara, 'joinRoom', created.code, 'Cara')).ok, true);

  const aliceTurnPromise = waitForState(alice, (state) => state.phase === 'playing' && state.activePlayerId === alice.id);
  alice.emit('startGame');
  assertFreshTurn(await aliceTurnPromise, alice.id!);

  const earlyVote = await emitAck(bob, 'pressStartTimer');
  assert.equal(earlyVote.ok, false);
  assert.equal(earlyVote.error, 'Rush voting is not open yet.');

  await waitForState(alice, (state) => state.rushVotingOpen, 20_000);
  assert.equal((await emitAck(bob, 'pressStartTimer')).ok, true);
  const firstRushPromise = waitForState(alice, (state) => state.rushActive);
  assert.equal((await emitAck(cara, 'pressStartTimer')).ok, true);
  const firstRush = await firstRushPromise;
  assert.equal(firstRush.rushSecondsRemaining, RUSH_COUNTDOWN_SECONDS);

  const gapPromise = waitForState(alice, (state) => !state.rushAvailable);
  alice.emit('passTurn');
  const gap = await gapPromise;
  assert.deepEqual(gap.rushVotes, []);
  assert.equal(gap.rushActive, false);

  // Bob transitions from waiting (and having voted) to active; his vote must not leak.
  const bobTurn = await waitForState(alice, (state) => state.activePlayerId === bob.id && state.rushAvailable);
  assertFreshTurn(bobTurn, bob.id!);
  await waitForState(alice, (state) => state.activePlayerId === bob.id && state.rushVotingOpen, 20_000);
  assert.equal((await emitAck(alice, 'pressStartTimer')).ok, true);
  const secondRushPromise = waitForState(alice, (state) => state.rushActive);
  assert.equal((await emitAck(cara, 'pressStartTimer')).ok, true);
  await secondRushPromise;

  bob.emit('passTurn');

  // On the immediately following turn Bob is waiting again and starts clean.
  const caraTurn = await waitForState(alice, (state) => state.activePlayerId === cara.id && state.rushAvailable);
  assertFreshTurn(caraTurn, cara.id!);
  await waitForState(alice, (state) => state.activePlayerId === cara.id && state.rushVotingOpen, 20_000);
  assert.equal((await emitAck(bob, 'pressStartTimer')).ok, true);
  const bobVote = await waitForState(alice, (state) => state.rushVotes.includes(bob.id!));
  assert.deepEqual(bobVote.rushVotes, [bob.id]);

  console.log('PASS: rush timing and per-turn vote resets');
} finally {
  for (const socket of players) socket.disconnect();
}
