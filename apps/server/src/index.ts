import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config.js';
import { ensureAuthenticationIndexes } from './persistence/auth-repository.js';
import { ensureBestRunIndexes } from './persistence/run-repository.js';
import { closeMongoConnection, connectToMongo } from './persistence/mongo.js';
import { closeRedisConnection, connectToRedis } from './persistence/redis.js';
import { attachLobbySockets } from './realtime/lobby.js';
import { startCleanupWorker, stopCleanupWorker } from './workers/cleanup-worker.js';

const app = createApp();

const server = createServer(app);
const io = new SocketServer(server, { allowRequest: (request, callback) => {
  const origin = request.headers.origin;
  const host = request.headers.host;
  let sameOrigin = false;
  try {
    if (origin !== undefined && host !== undefined) {
      const originUrl = new URL(origin);
      sameOrigin = originUrl.host === host;
      if (!sameOrigin && config.webOrigins.includes(originUrl.origin)) sameOrigin = true;
      if (!sameOrigin && config.nodeEnv !== 'production') {
        const isLoopback = ['localhost', '127.0.0.1'].includes(originUrl.hostname) && ['localhost', '127.0.0.1'].includes(new URL(`http://${host}`).hostname);
        sameOrigin = isLoopback && originUrl.port === new URL(`http://${host}`).port;
      }
    }
  } catch { /* Malformed origins are rejected. */ }
  callback(null, origin === undefined || sameOrigin);
} });
attachLobbySockets(io);

async function startServer(): Promise<void> {
  await connectToMongo();
  await ensureAuthenticationIndexes();
  await ensureBestRunIndexes();
  startCleanupWorker();
  console.info('MongoDB connection and indexes ready.');
  server.listen(config.port, () => {
    console.info(`Ghost Racer API listening on http://localhost:${config.port}`);
  });
  void connectToRedis()
    .then(() => console.info('Redis connection ready.'))
    .catch((error: unknown) => console.error('Redis connection failed.', error));
}

void startServer().catch((error: unknown) => {
  console.error('Server startup failed; HTTP requests will not be accepted.', error);
  stopCleanupWorker();
  void Promise.allSettled([closeMongoConnection(), closeRedisConnection()]).then(() => {
    process.exitCode = 1;
  });
});

function shutdown(signal: string): void {
  console.info(`${signal} received; shutting down.`);
  stopCleanupWorker();
  io.close(() => {
    void Promise.all([closeMongoConnection(), closeRedisConnection()]).finally(() => process.exit(0));
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
