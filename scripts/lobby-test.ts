// Headless test for public lobby browser + visibility toggle.
import { io } from 'socket.io-client';
import type { PublicRoom } from '../shared/types';

const URL = 'http://localhost:3001';
let failed = false;
const fail = (m: string) => { console.log('FAIL:', m); failed = true; process.exit(1); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // browser = a client sitting on the home screen watching the lobby list
  const browser = io(URL);
  let latest: PublicRoom[] = [];
  browser.on('publicRooms', (list: PublicRoom[]) => { latest = list; });

  await new Promise<void>((r) => browser.on('connect', () => r()));
  const sub = await new Promise<{ ok: boolean; rooms?: PublicRoom[] }>((r) =>
    browser.emit('subscribeLobbies', r),
  );
  if (!sub.ok) fail('subscribeLobbies failed');
  console.log('subscribed, initial rooms:', sub.rooms?.length);

  // host creates a room (private by default) — should NOT appear
  const host = io(URL);
  await new Promise<void>((r) => host.on('connect', () => r()));
  const created = await new Promise<{ ok: boolean; code?: string }>((r) =>
    host.emit('createRoom', 'Alice', r),
  );
  if (!created.ok || !created.code) fail('createRoom failed');
  const code = created.code!;
  await wait(200);
  if (latest.some((r) => r.code === code)) fail('private room leaked into public list');
  console.log('private room correctly hidden');

  // host makes it public — should appear with 1 player
  const vis = await new Promise<{ ok: boolean }>((r) => host.emit('setVisibility', true, r));
  if (!vis.ok) fail('setVisibility failed');
  await wait(200);
  const listed = latest.find((r) => r.code === code);
  if (!listed) fail('public room did not appear in list');
  if (listed!.hostName !== 'Alice' || listed!.playerCount !== 1) fail('wrong room metadata');
  console.log('public room appeared:', JSON.stringify(listed));

  // a second player joins via the listed code — count should update to 2
  const joiner = io(URL);
  await new Promise<void>((r) => joiner.on('connect', () => r()));
  const joined = await new Promise<{ ok: boolean }>((r) => joiner.emit('joinRoom', code, 'Bob', r));
  if (!joined.ok) fail('joinRoom via public code failed');
  await wait(200);
  const after = latest.find((r) => r.code === code);
  if (!after || after.playerCount !== 2) fail(`player count not updated (got ${after?.playerCount})`);
  console.log('join updated count to', after!.playerCount);

  // host starts the game — room should drop out of the public list
  host.emit('startGame');
  await wait(300);
  if (latest.some((r) => r.code === code)) fail('in-progress room still listed');
  console.log('room removed from list once game started');

  // back to private toggle check: new room, make public then private
  const h2 = io(URL);
  await new Promise<void>((r) => h2.on('connect', () => r()));
  const c2 = await new Promise<{ ok: boolean; code?: string }>((r) => h2.emit('createRoom', 'Carol', r));
  await new Promise((r) => h2.emit('setVisibility', true, r));
  await wait(150);
  if (!latest.some((r) => r.code === c2.code)) fail('Carol room not listed when public');
  await new Promise((r) => h2.emit('setVisibility', false, r));
  await wait(150);
  if (latest.some((r) => r.code === c2.code)) fail('Carol room still listed after going private');
  console.log('public→private toggle removes from list');

  // non-host cannot toggle visibility
  const c2joiner = io(URL);
  await new Promise<void>((r) => c2joiner.on('connect', () => r()));
  await new Promise((r) => c2joiner.emit('joinRoom', c2.code, 'Dave', r));
  const badVis = await new Promise<{ ok: boolean; error?: string }>((r) =>
    c2joiner.emit('setVisibility', true, r),
  );
  if (badVis.ok) fail('non-host was allowed to change visibility');
  console.log('non-host visibility change correctly rejected:', badVis.error);

  if (!failed) console.log('PASS');
  process.exit(0);
}

main();
setTimeout(() => fail('timeout'), 20_000);
