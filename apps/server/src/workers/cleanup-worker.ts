import { replayStorage } from '../persistence/replay-storage.js';
import { listReferencedReplayKeys } from '../persistence/run-repository.js';

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1_000;
let cleanupTimer: NodeJS.Timeout | undefined;
let cleanupRunning = false;

export async function runCleanupCycle(now = Date.now()): Promise<void> {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const [objects, referencedKeys] = await Promise.all([replayStorage.list(), listReferencedReplayKeys()]);
    const cutoff = now - ORPHAN_MIN_AGE_MS;
    for (const object of objects) {
      if (object.lastModified.getTime() >= cutoff || referencedKeys.has(object.objectKey)) continue;
      try {
        await replayStorage.delete(object.objectKey);
      } catch (error: unknown) {
        console.error('Could not remove an orphaned replay object; a later cleanup cycle will retry.', error);
      }
    }
  } finally {
    cleanupRunning = false;
  }
}

export function startCleanupWorker(): void {
  if (cleanupTimer !== undefined) return;
  cleanupTimer = setInterval(() => {
    void runCleanupCycle().catch((error: unknown) => console.error('Replay cleanup cycle failed; a later cycle will retry.', error));
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  void runCleanupCycle().catch((error: unknown) => console.error('Initial replay cleanup cycle failed; a later cycle will retry.', error));
}

export function stopCleanupWorker(): void {
  if (cleanupTimer !== undefined) clearInterval(cleanupTimer);
  cleanupTimer = undefined;
}
