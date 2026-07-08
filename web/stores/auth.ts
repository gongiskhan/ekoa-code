'use client';

/**
 * Auth Store
 *
 * Manages authentication state: login, logout, password change, token persistence.
 * Transport is the typed client (ch12 §12.4.3 FC-037): `login` no longer sets the token
 * as a side effect - the store calls `api.auth.login` then `setToken`; `logout` calls
 * `api.auth.logout` (server-side revocation, RESOLVED P-03) then `clearToken`. Boot
 * rehydrate re-injects the persisted token through the accessor (FC-067), which
 * transitively re-authenticates the streams; boot validation uses `GET /auth/me` and
 * renews with `POST /auth/refresh` (§12.2.3, RESOLVED P-03).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, setToken, clearToken, ApiError } from '@/lib/api';
import type { AuthUser } from '@ekoa/shared';

interface AuthState {
  // State
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  passwordChangeRequired: boolean;
  error: string | null;
  /**
   * CONV-2 code of the last failure, when the transport surfaced one (FC-508).
   * Drives the activation-error copy on login (`ACCOUNT_DISABLED` / `BILLING_LOCKED`).
   */
  errorCode: string | null;
  /**
   * In-session block detected while validating the session (FC-508): the CONV-2
   * code (`ACCOUNT_DISABLED` 403 / `BILLING_LOCKED` 402) that a protected call
   * returned. Read by the blocked-state guard.
   */
  blockedCode: string | null;
  hasHydrated: boolean;

  // Actions
  login: (username: string, password: string, rememberMe?: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      passwordChangeRequired: false,
      error: null,
      errorCode: null,
      blockedCode: null,
      hasHydrated: false,

      login: async (username: string, password: string, rememberMe = false) => {
        set({ isLoading: true, error: null, errorCode: null });

        try {
          const { token, user, passwordChangeRequired } = await api.auth.login({
            username,
            password,
            rememberMe,
          });

          // FC-037: setting the token is an explicit, separate step from the login call.
          setToken(token);

          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
            passwordChangeRequired,
            error: null,
            errorCode: null,
          });

          return true;
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Login failed',
            // FC-508: keep the CONV-2 code so the login page can render the
            // dedicated PT copy for ACCOUNT_DISABLED / BILLING_LOCKED.
            errorCode: err instanceof ApiError ? err.code : null,
          });
          return false;
        }
      },

      logout: async () => {
        // RESOLVED (P-03): revoke the current token server-side before clearing it locally.
        // Best-effort - a failed revoke must never trap the user in a signed-in state.
        try {
          await api.auth.logout({});
        } catch {
          /* ignore - clear local state regardless */
        }
        clearToken();

        set({
          user: null,
          token: null,
          isAuthenticated: false,
          passwordChangeRequired: false,
          error: null,
        });
      },

      changePassword: async (oldPassword: string, newPassword: string) => {
        set({ isLoading: true, error: null });

        try {
          await api.auth.changePassword({ currentPassword: oldPassword, newPassword });
          set({
            isLoading: false,
            passwordChangeRequired: false,
            error: null,
          });
          return { success: true };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to change password';
          set({
            isLoading: false,
            error: errorMsg,
          });
          return { success: false, error: errorMsg };
        }
      },

      checkAuth: async () => {
        const { token } = get();

        if (!token) {
          set({ isAuthenticated: false, user: null });
          return false;
        }

        set({ isLoading: true });

        try {
          // Boot validation (§12.2.3, RESOLVED P-03): validate with GET /auth/me...
          const user = await api.auth.me();

          // ...then renew explicitly with POST /auth/refresh. Renewal failure is
          // non-fatal: the just-validated token is still good for this session.
          try {
            const refreshed = await api.auth.refresh();
            if (refreshed.token && refreshed.token !== get().token) {
              setToken(refreshed.token);
              set({ token: refreshed.token });
            }
          } catch {
            /* keep the validated token */
          }

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            passwordChangeRequired: user.passwordChangeRequired ?? false,
            // A successful validation clears any prior block (e.g. after re-activation).
            blockedCode: null,
          });
          return true;
        } catch (err) {
          // The core's 401 interceptor already cleared the token and redirected on an
          // authentication failure; mirror that into store state. Network errors keep
          // the existing auth so a flaky connection never forces a logout.
          if (err instanceof ApiError && err.status === 401) {
            clearToken();
            set({
              user: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              passwordChangeRequired: false,
              blockedCode: null,
            });
          } else if (
            err instanceof ApiError &&
            (err.code === 'ACCOUNT_DISABLED' || err.code === 'BILLING_LOCKED')
          ) {
            // FC-508: the session is valid but the account is blocked (403/402).
            // Surface the code for the blocked-state guard; keep the user signed in
            // so the guard can render over the app.
            set({ isLoading: false, blockedCode: err.code });
          } else {
            set({ isLoading: false });
          }
          return false;
        }
      },

      clearError: () => set({ error: null, errorCode: null }),

      setHasHydrated: (hydrated: boolean) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'ekoa_auth',
      onRehydrateStorage: () => (state) => {
        // FC-067: re-inject the persisted token through the single accessor, which
        // transitively re-authenticates the streams.
        if (state?.token) {
          setToken(state.token);
        }
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        passwordChangeRequired: state.passwordChangeRequired,
      }),
    }
  )
);
