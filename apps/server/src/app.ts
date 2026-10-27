import express, { type Express, type Request, type Response } from 'express';
import { authRouter } from './http/auth-router.js';
import { runsRouter } from './http/runs-router.js';
import { leaderboardRouter } from './http/leaderboard-router.js';
import { tournamentsRouter } from './http/tournaments-router.js';
import { isMongoConnected } from './persistence/mongo.js';
import { isRedisConnected } from './persistence/redis.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', async (_request: Request, response: Response) => {
    const dbConnected = isMongoConnected();
    const redisConnected = await isRedisConnected();
    const dependenciesConnected = dbConnected && redisConnected;

    response.status(dependenciesConnected ? 200 : 503).json({
      status: dependenciesConnected ? 'ok' : 'degraded',
      db: dbConnected ? 'connected' : 'disconnected',
      redis: redisConnected ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/tournaments', tournamentsRouter);

  return app;
}
