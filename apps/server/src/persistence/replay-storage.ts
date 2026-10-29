import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

const defaultReplayDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/replays');

function validateReplayKey(objectKey: string): void {
  if (!/^replays\/[a-f\d]{48}\.gz$/.test(objectKey)) throw new Error('Invalid replay object key.');
}

export interface StoredReplay {
  objectKey: string;
  checksum: string;
}

export interface ReplayObjectInfo { objectKey: string; lastModified: Date }

export interface ReplayStorage {
  put(compressedReplay: Buffer): Promise<StoredReplay>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  list(): Promise<ReplayObjectInfo[]>;
}

export class LocalReplayStorage implements ReplayStorage {
  constructor(private readonly replayDirectory = defaultReplayDirectory) {}

  async put(compressedReplay: Buffer): Promise<StoredReplay> {
    const objectKey = `replays/${randomBytes(24).toString('hex')}.gz`;
    const path = this.resolveKey(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, compressedReplay, { flag: 'wx' });
    return { objectKey, checksum: createHash('sha256').update(compressedReplay).digest('hex') };
  }

  async delete(objectKey: string): Promise<void> {
    await unlink(this.resolveKey(objectKey)).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    });
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(objectKey));
  }

  async list(): Promise<ReplayObjectInfo[]> {
    let entries;
    try { entries = await readdir(this.replayDirectory, { withFileTypes: true }); }
    catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
    const files = entries.filter((entry) => entry.isFile() && /^[a-f\d]{48}\.gz$/i.test(entry.name));
    return Promise.all(files.map(async (entry) => ({
      objectKey: `replays/${entry.name}`,
      lastModified: (await stat(resolve(this.replayDirectory, entry.name))).mtime,
    })));
  }

  private resolveKey(objectKey: string): string {
    validateReplayKey(objectKey);
    const storageRoot = resolve(this.replayDirectory, '..');
    const path = resolve(storageRoot, objectKey);
    if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error('Invalid replay object key.');
    return path;
  }
}

export class S3ReplayStorage implements ReplayStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    endpoint: string | undefined,
    accessKeyId: string | undefined,
    secretAccessKey: string | undefined,
  ) {
    this.client = new S3Client({
      region,
      ...(endpoint === undefined ? {} : { endpoint, forcePathStyle: true }),
      ...(accessKeyId === undefined || secretAccessKey === undefined ? {} : { credentials: { accessKeyId, secretAccessKey } }),
    });
  }

  async put(compressedReplay: Buffer): Promise<StoredReplay> {
    const objectKey = `replays/${randomBytes(24).toString('hex')}.gz`;
    const checksum = createHash('sha256').update(compressedReplay).digest('hex');
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: compressedReplay,
      ContentType: 'application/gzip',
      Metadata: { sha256: checksum },
    }));
    return { objectKey, checksum };
  }

  async get(objectKey: string): Promise<Buffer> {
    validateReplayKey(objectKey);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (response.Body === undefined) throw new Error('Replay object returned no content.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(objectKey: string): Promise<void> {
    validateReplayKey(objectKey);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async list(): Promise<ReplayObjectInfo[]> {
    const objects: ReplayObjectInfo[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'replays/',
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      }));
      for (const object of response.Contents ?? []) {
        if (object.Key === undefined || !/^replays\/[a-f\d]{48}\.gz$/.test(object.Key)) continue;
        objects.push({ objectKey: object.Key, lastModified: object.LastModified ?? new Date(0) });
      }
      if (response.IsTruncated && response.NextContinuationToken === undefined) {
        throw new Error('Replay object listing was truncated without a continuation token.');
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return objects;
  }
}

function createReplayStorage(): ReplayStorage {
  if (config.replayStorage.driver === 'local') return new LocalReplayStorage(config.replayStorage.localDirectory);
  const bucket = config.replayStorage.bucket;
  if (bucket === undefined || bucket.length === 0) throw new Error('S3_BUCKET is required when REPLAY_STORAGE_DRIVER is s3.');
  return new S3ReplayStorage(
    bucket,
    config.replayStorage.region,
    config.replayStorage.endpoint,
    config.replayStorage.accessKeyId,
    config.replayStorage.secretAccessKey,
  );
}

export const replayStorage = createReplayStorage();
