import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-placeholder"><p className="page-placeholder-desc">Checking session…</p></div>;
  return user ? <Outlet /> : <Navigate to="/sign-in" replace state={{ from: location }} />;
}
