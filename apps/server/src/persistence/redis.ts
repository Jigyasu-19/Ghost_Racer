import { createConnection } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { config } from '../config.js';

type RedisValue = string | number | null | RedisValue[];
let connectionStatus = false;
const redisAddress = new URL(config.redisUrl);
const redisPort = Number(redisAddress.port || (redisAddress.protocol === 'rediss:' ? 6380 : 6379));
const redisDatabase = redisAddress.pathname.length > 1 ? Number(redisAddress.pathname.slice(1)) : 0;
const RATE_LIMIT_SCRIPT = `local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; if count > tonumber(ARGV[2]) then return 'LIMITED' end; return 'ALLOWED'`;

function encodeCommand(parts: readonly string[]): Buffer {
  const rows = [`*${parts.length}\r\n`];
  for (const part of parts) rows.push(`$${Buffer.byteLength(part)}\r\n${part}\r\n`);
  return Buffer.from(rows.join(''));
}

function parseResponse(buffer: Buffer, offset = 0): { value: RedisValue; bytesRead: number } | null {
  const marker = buffer[offset];
  if (marker === undefined) return null;
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd < 0) return null;
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + 2;
  if (marker === 43) return { value: line, bytesRead: afterLine - offset };
  if (marker === 45) throw new Error(`Redis command failed: ${line}`);
  if (marker === 58) return { value: Number(line), bytesRead: afterLine - offset };
  if (marker === 36) {
    const length = Number(line);
    if (length === -1) return { value: null, bytesRead: afterLine - offset };
    const end = afterLine + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString('utf8', afterLine, end), bytesRead: end + 2 - offset };
  }
  if (marker === 42) {
    const length = Number(line);
    if (length === -1) return { value: null, bytesRead: afterLine - offset };
    const values: RedisValue[] = [];
    let cursor = afterLine;
    for (let index = 0; index < length; index++) {
      const parsed = parseResponse(buffer, cursor);
      if (parsed === null) return null;
      values.push(parsed.value);
      cursor += parsed.bytesRead;
    }
    return { value: values, bytesRead: cursor - offset };
  }
  throw new Error('Redis returned an unsupported response.');
}

async function runCommand(parts: readonly string[]): Promise<RedisValue> {
  const secure = redisAddress.protocol === 'rediss:';
  const socket = secure
    ? connectTls({ host: redisAddress.hostname, port: redisPort, servername: redisAddress.hostname })
    : createConnection({ host: redisAddress.hostname, port: redisPort });
  socket.setTimeout(5_000, () => socket.destroy(new Error('Redis connection timed out.')));
  try {
    await new Promise<void>((resolve, reject) => {
      const connected = secure ? 'secureConnect' : 'connect';
      socket.once(connected, resolve);
      socket.once('error', reject);
    });
    if (redisAddress.password) {
      const auth = redisAddress.username
        ? await exchange(socket, ['AUTH', decodeURIComponent(redisAddress.username), decodeURIComponent(redisAddress.password)])
        : await exchange(socket, ['AUTH', decodeURIComponent(redisAddress.password)]);
      if (auth !== 'OK') throw new Error('Redis authentication failed.');
    }
    if (!Number.isInteger(redisDatabase) || redisDatabase < 0) throw new Error('REDIS_URL database path must be a non-negative integer.');
    if (redisDatabase > 0 && await exchange(socket, ['SELECT', String(redisDatabase)]) !== 'OK') {
      throw new Error('Redis database selection failed.');
    }
    const result = await exchange(socket, parts);
    connectionStatus = true;
    return result;
  } catch (error: unknown) {
    connectionStatus = false;
    throw error;
  } finally {
    socket.destroy();
  }
}

function exchange(socket: ReturnType<typeof createConnection> | ReturnType<typeof connectTls>, parts: readonly string[]): Promise<RedisValue> {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      try {
        const parsed = parseResponse(response);
        if (parsed === null) return;
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(parsed.value);
      } catch (error: unknown) {
        socket.off('data', onData);
        socket.off('error', onError);
        reject(error);
      }
    };
    const onError = (error: Error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.write(encodeCommand(parts));
  });
}

export class RedisStore {
  async set(key: string, value: string, options: { EX: number; NX?: boolean }): Promise<string | null> {
    const parts = ['SET', key, value, 'EX', String(options.EX)];
    if (options.NX) parts.push('NX');
    const result = await runCommand(parts);
    return typeof result === 'string' ? result : null;
  }

  async get(key: string): Promise<string | null> {
    const result = await runCommand(['GET', key]);
    return typeof result === 'string' || result === null ? result : null;
  }

  async del(keys: string | readonly string[]): Promise<number> {
    const keyList = typeof keys === 'string' ? [keys] : [...keys];
    const result = await runCommand(['DEL', ...keyList]);
    return typeof result === 'number' ? result : 0;
  }

  async eval(script: string, keys: readonly string[], args: readonly string[]): Promise<string | null> {
    const result = await runCommand(['EVAL', script, String(keys.length), ...keys, ...args]);
    return typeof result === 'string' ? result : null;
  }
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    return await runCommand(['PING']) === 'PONG';
  } catch {
    return false;
  }
}

export async function connectToRedis(): Promise<void> {
  if (await isRedisConnected()) return;
  throw new Error('Redis is not reachable.');
}

export async function getRedisClient(): Promise<RedisStore> {
  if (!connectionStatus && !(await isRedisConnected())) throw new Error('Redis is not reachable.');
  return new RedisStore();
}

export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('Rate-limit thresholds must be positive integers.');
  }
  const redis = await getRedisClient();
  const result = await redis.eval(RATE_LIMIT_SCRIPT, [key], [String(windowSeconds), String(limit)]);
  if (result === 'ALLOWED') return true;
  if (result === 'LIMITED') return false;
  throw new Error('Redis returned an invalid rate-limit result.');
}

export async function closeRedisConnection(): Promise<void> {
  connectionStatus = false;
}
