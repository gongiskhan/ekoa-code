'use client';

/**
 * Auth Store
 *
 * Manages authentication state: login, logout, password change, token persistence.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as api from '@/lib/api/client';
import type { AuthUser } from '@/lib/api/client';

interface AuthState {
  // State
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  passwordChangeRequired: boolean;
  error: string | null;
  hasHydrated: boolean;

  // Actions
  login: (username: string, password: string, rememberMe?: boolean) => Promise<boolean>;
  logout: () => void;
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
      hasHydrated: false,

      login: async (username: string, password: string, rememberMe = false) => {
        set({ isLoading: true, error: null });

        try {
          const response = await api.login({ username, password, rememberMe });

          if (response.success && response.data) {
            const { token, user, passwordChangeRequired } = response.data;

            api.setAuthToken(token);

            set({
              user,
              token,
              isAuthenticated: true,
              isLoading: false,
              passwordChangeRequired,
              error: null,
            });

            return true;
          } else {
            set({
              isLoading: false,
              error: response.error?.message || 'Login failed',
            });
            return false;
          }
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Login failed',
          });
          return false;
        }
      },

      logout: () => {
        api.clearAuthToken();

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
          const response = await api.changePassword({ oldPassword, newPassword });

          if (response.success) {
            set({
              isLoading: false,
              passwordChangeRequired: false,
              error: null,
            });
            return { success: true };
          } else {
            const errorMsg = response.error?.message || 'Failed to change password';
            set({
              isLoading: false,
              error: errorMsg,
            });
            return { success: false, error: errorMsg };
          }
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
          const response = await api.getCurrentUser();

          if (response.success && response.data) {
            // Server may return a refreshed token when our role/scopes drifted
            // (e.g. after the super-admin migration). Accept it so subsequent
            // requests use the up-to-date claims.
            const refreshedToken = response.data.token;
            const { token: previousToken, ...userData } = response.data;
            void previousToken; // discard from user state
            const nextToken = refreshedToken ?? get().token;
            if (refreshedToken && refreshedToken !== get().token) {
              api.setAuthToken(refreshedToken);
              const { reconnectWithToken } = await import('@/lib/cortex/connection');
              reconnectWithToken(refreshedToken);
            }
            set({
              user: userData,
              token: nextToken,
              isAuthenticated: true,
              isLoading: false,
              passwordChangeRequired: response.data.passwordChangeRequired,
            });
            return true;
          } else {
            // Only clear auth if server explicitly rejected (not a network error)
            const isAuthError = response.error?.message?.includes('Unauthorized') ||
              response.error?.message?.includes('Authentication failed') ||
              response.error?.message?.includes('expired');
            if (isAuthError) {
              api.clearAuthToken();
              set({
                user: null,
                token: null,
                isAuthenticated: false,
                isLoading: false,
                passwordChangeRequired: false,
              });
            } else {
              // Network error -- keep existing auth state, just stop loading
              set({ isLoading: false });
            }
            return false;
          }
        } catch {
          // Network error -- keep existing auth, don't force logout
          set({ isLoading: false });
          return false;
        }
      },

      clearError: () => set({ error: null }),

      setHasHydrated: (hydrated: boolean) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'ekoa_auth',
      onRehydrateStorage: () => (state) => {
        // Restore the token to the API client
        if (state?.token) {
          api.setAuthToken(state.token);
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
