// Creates a public room and stays connected, printing the code, for invite-link UI testing.
import { io } from 'socket.io-client';
const s = io('http://localhost:3001');
s.on('connect', () => {
  s.emit('createRoom', 'HostBot', (res: { ok: boolean; code?: string }) => {
    s.emit('setVisibility', true, () => {
      console.log('CODE:' + res.code);
    });
  });
});
setTimeout(() => process.exit(0), 120_000);
