import http from 'http';
import app from './app';
import { initRealtime } from '../api/realtime';

const port = Number(process.env.PORT) || 3001;
const server = http.createServer(app);

initRealtime(server);

server.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
