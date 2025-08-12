import app from './app';
import '../api/workers/draftWorker';

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
