import { Link } from 'react-router-dom';
import { Flag, Trophy } from 'lucide-react';

export function HomePage() {
  return (
    <div className="hero">
      <h1 className="hero-title">
        <span className="hero-title-ghost">Ghost</span>{' '}
        <span className="hero-title-racer">Racer</span>
      </h1>

      <p className="hero-tagline">
        Top-down racing with replay ghosts and private tournaments.
        Race solo, beat your best, or challenge friends.
      </p>

      <div className="hero-actions">
        <Link to="/race" className="btn btn-primary">
          <Flag size={16} />
          Start Racing
        </Link>
        <Link to="/leaderboard" className="btn btn-secondary">
          <Trophy size={16} />
          Leaderboard
        </Link>
      </div>

      <div className="status-badge">
        <span className="status-dot" />
        <span>Workspace ready — Units 2 & 3 complete</span>
      </div>
    </div>
  );
}
