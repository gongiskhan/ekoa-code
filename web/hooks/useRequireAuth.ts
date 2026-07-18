'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

/**
 * The client-side auth guard both shells share (no middleware exists; surface
 * contract 4.5). Extracted verbatim from the dashboard layout so the (os)
 * route group cannot drift from it. Each layout renders its own loading UI
 * from the returned flags.
 */
export function useRequireAuth() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  // Auth check: redirect to login if not authenticated
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [hasHydrated, isAuthenticated, router]);

  // Refresh the cached user from the server once per mount so role/profile
  // changes since last login (e.g. super-admin migration) are picked up
  // without forcing a logout.
  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      void checkAuth();
    }
  }, [hasHydrated, isAuthenticated, checkAuth]);

  return { hasHydrated, isAuthenticated, ready: hasHydrated && isAuthenticated };
}
