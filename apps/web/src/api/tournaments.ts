import { TournamentHostHistorySchema, TournamentRaceResultSchema } from '@ghost-racer/contracts';

interface ErrorEnvelope { error?: { message?: string } }

export async function getTournamentHostHistory() {
  const response = await fetch('/api/tournaments', { credentials: 'include' });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const error = body as ErrorEnvelope;
    throw new Error(error.error?.message ?? 'Could not load tournaments.');
  }
  const parsed = TournamentHostHistorySchema.safeParse(body);
  if (!parsed.success) throw new Error('Tournament history response was invalid.');
  return parsed.data;
}

export async function getTournamentResult(tournamentId: string) {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/result`, { credentials: 'include' });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const error = body as ErrorEnvelope;
    throw new Error(error.error?.message ?? 'Could not load the tournament result.');
  }
  const parsed = TournamentRaceResultSchema.safeParse((body as { result?: unknown }).result);
  if (!parsed.success) throw new Error('Tournament result response was invalid.');
  return parsed.data;
}
