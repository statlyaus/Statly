import { io } from 'socket.io-client';

const URL = 'ws://localhost:4000';
const NS = '/v1';

const socket = io(URL + NS, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log('[client] connected', { id: socket.id, ns: NS });
  socket.emit('ping'); // triggers your server's ping handler
});

socket.on('evt', (msg) => {
  console.log('[client] evt', msg);
});

socket.on('connect_error', (err) => {
  console.error('[client] connect_error', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('[client] disconnect', reason);
  process.exit(0);
});

setTimeout(() => {
  console.log('[client] timeout');
  socket.close();
}, 3000);
