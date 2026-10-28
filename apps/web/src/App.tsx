import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { HomePage } from './pages/HomePage';
import { SignInPage } from './pages/SignInPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { RacePage } from './pages/RacePage';
import { MyBestsPage } from './pages/MyBestsPage';
import { RegisterPage } from './pages/RegisterPage';
import { TournamentLobbyPage } from './pages/TournamentLobbyPage';
import { TournamentPodiumPage } from './pages/TournamentPodiumPage';
import { TournamentAdminPage } from './pages/TournamentAdminPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './auth/AuthContext';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider><div className="app-shell">
        <NavBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}><Route path="/leaderboard" element={<LeaderboardPage />} /><Route path="/my-bests" element={<MyBestsPage />} /><Route path="/race" element={<RacePage />} /><Route path="/tournaments" element={<TournamentLobbyPage />} /><Route path="/tournaments/:tournamentId/podium" element={<TournamentPodiumPage />} /><Route path="/tournaments/host" element={<TournamentAdminPage />} /><Route path="/admin/tournaments" element={<TournamentAdminPage />} /></Route>
          </Routes>
        </main>
      </div></AuthProvider>
    </BrowserRouter>
  );
}
