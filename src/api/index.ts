import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import leagueRoutes from './routes/leagues';
import draftRoutes from './routes/drafts';
import pickRoutes from './routes/picks';
import queueRoutes from './routes/queues';
import { authenticateJWT } from './middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use(authenticateJWT);
app.use('/leagues', leagueRoutes);
app.use('/drafts', draftRoutes);
app.use('/picks', pickRoutes);
app.use('/queues', queueRoutes);

export default app;
