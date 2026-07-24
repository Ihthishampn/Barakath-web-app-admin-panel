import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from './stores/authStore';

/** Gate protected routes: waits for auth hydration, else redirects to /login. */
export function RequireAuth() {
  const { admin, ready } = useAuthStore();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-app">
        <Spinner className="h-8 w-8 text-brand-primary" />
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
