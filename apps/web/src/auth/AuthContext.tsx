import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@ghost-racer/contracts';
import { authApi } from '../api/auth';

interface AuthContextValue {
  user: PublicUser | null; loading: boolean;
  register: (username: string, email: string, password: string) => Promise<void>;
  login: (identity: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeTutorial: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void authApi.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const value = useMemo<AuthContextValue>(() => ({
    user, loading,
    register: async (username, email, password) => setUser(await authApi.register(username, email, password)),
    login: async (identity, password) => setUser(await authApi.login(identity, password)),
    logout: async () => { await authApi.logout(); setUser(null); },
    completeTutorial: async () => setUser(await authApi.completeTutorial()),
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
