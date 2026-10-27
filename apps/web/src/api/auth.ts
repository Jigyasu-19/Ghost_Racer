import type { PublicUser } from '@ghost-racer/contracts';

interface AuthResponse { user: PublicUser }
interface ErrorResponse { error?: { message?: string } }

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ErrorResponse;
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

async function csrfToken(): Promise<string> {
  const response = await fetch('/api/auth/csrf', { credentials: 'include' });
  const body = await readJson<{ csrfToken: string }>(response);
  return body.csrfToken;
}

async function mutation(path: string, body?: unknown): Promise<AuthResponse | undefined> {
  const token = await csrfToken();
  const response = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined;
  return readJson<AuthResponse>(response);
}

export const authApi = {
  async me(): Promise<PublicUser | null> {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (response.status === 401) return null;
    return (await readJson<AuthResponse>(response)).user;
  },
  async register(username: string, email: string, password: string): Promise<PublicUser> {
    return (await mutation('/api/auth/register', { username, email, password }))!.user;
  },
  async login(identity: string, password: string): Promise<PublicUser> {
    return (await mutation('/api/auth/login', { identity, password }))!.user;
  },
  async logout(): Promise<void> { await mutation('/api/auth/logout'); },
  async completeTutorial(): Promise<PublicUser> {
    return (await mutation('/api/auth/tutorial-complete'))!.user;
  },
};
