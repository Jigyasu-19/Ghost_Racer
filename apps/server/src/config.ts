import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(sourceDirectory, '../.env') });

const nodeEnv = process.env.NODE_ENV ?? 'development';
const production = nodeEnv === 'production' || process.env.RENDER === 'true';
const configuredReplayDirectory = process.env.REPLAY_STORAGE_DIR?.trim();
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() || undefined;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() || undefined;

function parseWebOrigins(value: string | undefined): string[] {
  const origins = value?.split(',') ?? (production ? ['https://ghostracer.vercel.app'] : []);
  return origins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin.trim());
    } catch {
      throw new Error('WEB_ORIGINS must contain valid HTTP or HTTPS origins.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('WEB_ORIGINS must contain valid HTTP or HTTPS origins without paths.');
    }
    return parsed.origin;
  });
}

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

function parseS3Endpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('S3_ENDPOINT must be a valid HTTP or HTTPS origin.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('S3_ENDPOINT must be a valid HTTP or HTTPS origin without a path.');
  }
  return endpoint.origin;
}

export const config = {
  port: parsePort(process.env.PORT),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ghost-racer',
  redisUrl: parseRedisUrl(process.env.REDIS_URL),
  nodeEnv,
  webOrigins: parseWebOrigins(process.env.WEB_ORIGINS),
  replayStorage: {
    driver: process.env.REPLAY_STORAGE_DRIVER?.trim() || (production ? 's3' : 'local'),
    bucket: process.env.S3_BUCKET?.trim(),
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    endpoint: parseS3Endpoint(process.env.S3_ENDPOINT),
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    localDirectory: configuredReplayDirectory === undefined
      ? resolve(sourceDirectory, '../data/replays')
      : resolve(configuredReplayDirectory),
  },
} as const;

if (config.replayStorage.driver !== 'local' && config.replayStorage.driver !== 's3') {
  throw new Error('REPLAY_STORAGE_DRIVER must be either local or s3.');
}
if (config.replayStorage.driver === 's3' && !config.replayStorage.bucket) {
  throw new Error('S3_BUCKET is required when REPLAY_STORAGE_DRIVER is s3.');
}
if (config.replayStorage.driver === 'local' && production && configuredReplayDirectory === undefined) {
  throw new Error('REPLAY_STORAGE_DIR must point to a persistent volume when using local replay storage in production.');
}
if ((config.replayStorage.accessKeyId === undefined) !== (config.replayStorage.secretAccessKey === undefined)) {
  throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.');
}
