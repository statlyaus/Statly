import { io } from 'socket.io-client';

const port = process.env.SOCKET_PORT ?? '3002';
const URL =
  process.env.SOCKET_TEST_URL ?? process.env.NEXT_PUBLIC_SOCKET_URL ?? `http://localhost:${port}`;

const socket = io(URL, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log('[client] connected', { id: socket.id, url: URL });
  socket.emit('test', { message: 'socket smoke test' });
});

socket.on('test-response', (msg) => {
  console.log('[client] test-response', msg);
  socket.close();
});

socket.on('connect_error', (err) => {
  console.error('[client] connect_error', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('[client] disconnect', reason);
  process.exit(0);
});

setTimeout(() => {
  console.error('[client] timeout');
  socket.close();
  process.exit(1);
}, 3000);
