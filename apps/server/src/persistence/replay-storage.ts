import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const replayDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/replays');

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
    try { entries = await readdir(replayDirectory, { withFileTypes: true }); }
    catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
    const files = entries.filter((entry) => entry.isFile() && /^[a-f\d]{48}\.gz$/i.test(entry.name));
    return Promise.all(files.map(async (entry) => ({
      objectKey: `replays/${entry.name}`,
      lastModified: (await stat(resolve(replayDirectory, entry.name))).mtime,
    })));
  }

  private resolveKey(objectKey: string): string {
    if (!/^replays\/[a-f\d]{48}\.gz$/.test(objectKey)) throw new Error('Invalid replay object key.');
    const path = resolve(replayDirectory, '..', objectKey);
    if (!path.startsWith(`${resolve(replayDirectory, '..')}${sep}`)) throw new Error('Invalid replay object key.');
    return path;
  }
}

export const replayStorage: ReplayStorage = new LocalReplayStorage();
