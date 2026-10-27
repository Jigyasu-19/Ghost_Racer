import { NavLink, Link } from 'react-router-dom';
import { Trophy, Flag, Home, LogOut, Medal, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  async function handleLogout(): Promise<void> { await logout(); navigate('/sign-in'); }
  return (
    <nav className="nav">
      <Link to="/" className="nav-brand">
        <span className="nav-brand-ghost">Ghost</span>
        <span className="nav-brand-racer">Racer</span>
      </Link>

      <ul className="nav-links">
        <li>
          <NavLink to="/" end className={navLinkClass}>
            <Home size={16} />
            Home
          </NavLink>
        </li>
        <li>
          <NavLink to="/race" className={navLinkClass}>
            <Flag size={16} />
            Race
          </NavLink>
        </li>
        <li>
          <NavLink to="/my-bests" className={navLinkClass}>
            <Medal size={16} />
            My Bests
          </NavLink>
        </li>
        <li>
          <NavLink to="/leaderboard" className={navLinkClass}>
            <Trophy size={16} />
            Leaderboard
          </NavLink>
        </li>
        {user && <li><NavLink to="/tournaments" className={navLinkClass}><Users size={16} /> Tournament</NavLink></li>}
        {user?.role === 'admin' && <li><NavLink to="/admin/tournaments" className={navLinkClass}><Trophy size={16} /> Manage tournaments</NavLink></li>}
      </ul>
      {user ? <div className="nav-account"><span>{user.username}</span><button className="nav-logout" onClick={() => void handleLogout()}><LogOut size={16} /> Log out</button></div> : <NavLink to="/sign-in" className={navLinkClass}>Sign in</NavLink>}
    </nav>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link active' : 'nav-link';
}
