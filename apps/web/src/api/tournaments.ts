import { TournamentAdminHistorySchema } from '@ghost-racer/contracts';

interface ErrorEnvelope { error?: { message?: string } }

export async function getAdminTournamentHistory() {
  const response = await fetch('/api/tournaments', { credentials: 'include' });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const error = body as ErrorEnvelope;
    throw new Error(error.error?.message ?? 'Could not load tournaments.');
  }
  const parsed = TournamentAdminHistorySchema.safeParse(body);
  if (!parsed.success) throw new Error('Tournament history response was invalid.');
  return parsed.data;
}
