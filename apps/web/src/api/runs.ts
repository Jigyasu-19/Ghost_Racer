import { CompressedReplaySchema, LeaderboardResponseSchema, MyBestsResponseSchema, type CompressedReplay } from '@ghost-racer/contracts';

export interface RunSubmissionResult {
  newPersonalBest: boolean;
  verifiedFinishTime: number;
}

interface ErrorResponse {
  error?: { message?: string };
}

export async function submitRun(replay: { compressedReplay: ArrayBuffer; trackId: string; carId: string; simulationVersion: string; contentVersion: string }): Promise<RunSubmissionResult> {
  const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' });
  const csrfBody = await csrfResponse.json() as { csrfToken?: string } & ErrorResponse;
  if (!csrfResponse.ok || !csrfBody.csrfToken) throw new Error(csrfBody.error?.message ?? 'Could not prepare run submission.');

  const query = new URLSearchParams({ trackId: replay.trackId, carId: replay.carId, simulationVersion: replay.simulationVersion, contentVersion: replay.contentVersion });
  const response = await fetch(`/api/runs/submit?${query.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/gzip', 'X-CSRF-Token': csrfBody.csrfToken },
    body: replay.compressedReplay,
  });
  const body = await response.json() as RunSubmissionResult & ErrorResponse;
  if (!response.ok) throw new Error(body.error?.message ?? 'Could not submit this run.');
  return body;
}
export async function getMyBests() {
  const response = await fetch('/api/runs/my-bests', { credentials: 'include' });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const error = body as ErrorResponse;
    throw new Error(error.error?.message ?? 'Could not load personal bests.');
  }
  const parsed = MyBestsResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('The personal best response was invalid.');
  return parsed.data.runs;
}

export async function getReplay(runId: string): Promise<CompressedReplay> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/replay`, { credentials: 'include' });
  if (!response.ok) {
    const body = await response.json() as ErrorResponse;
    throw new Error(body.error?.message ?? 'Could not load the personal best replay.');
  }
  try {
    const compressed = await response.arrayBuffer();
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const replay: unknown = JSON.parse(await new Response(stream).text());
    const parsed = CompressedReplaySchema.safeParse(replay);
    if (!parsed.success) throw new Error('The stored replay is invalid.');
    return parsed.data;
  } catch (error: unknown) {
    throw error instanceof Error ? error : new Error('Could not decode the personal best replay.');
  }
}

export async function getLeaderboard(trackId: string, carId: string) {
  const response = await fetch(`/api/leaderboard/${encodeURIComponent(trackId)}/${encodeURIComponent(carId)}`, { credentials: 'include' });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const error = body as ErrorResponse;
    throw new Error(error.error?.message ?? 'Could not load the leaderboard.');
  }
  const parsed = LeaderboardResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('The leaderboard response was invalid.');
  return parsed.data.entries;
}
