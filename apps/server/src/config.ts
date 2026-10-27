import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(sourceDirectory, '../.env') });

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3001;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

function parseRedisUrl(value: string | undefined): string {
  const redisUrl = value ?? 'redis://127.0.0.1:6379';
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL must be a valid Redis URL.');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://.');
  }
  return redisUrl;
}

export const config = {
  port: parsePort(process.env.PORT),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ghost-racer',
  redisUrl: parseRedisUrl(process.env.REDIS_URL),
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;
