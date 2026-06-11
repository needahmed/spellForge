import { io, type Socket } from 'socket.io-client';

// Same-origin: Vite proxies /socket.io in dev, Express serves both in prod.
export const socket: Socket = io({ autoConnect: true });
