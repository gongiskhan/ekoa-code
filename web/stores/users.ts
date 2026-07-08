'use client';

/**
 * Users Store
 *
 * Manages user list and admin operations (create, delete, reset password).
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { AuthUser } from '@ekoa/shared';

interface UsersState {
  // State
  users: AuthUser[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchUsers: () => Promise<void>;
  addUser: (data: {
    username: string;
    password?: string;
    role: 'org-admin' | 'builder';
    passwordChangeRequired?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  removeUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (userId: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useUsersStore = create<UsersState>()((set) => ({
  users: [],
  isLoading: false,
  error: null,

  fetchUsers: async () => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.users.list());
    if (response.ok) {
      set({ users: response.data.items, isLoading: false });
    } else {
      set({ error: response.error.message || 'Failed to fetch users', isLoading: false });
    }
  },

  addUser: async (data) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() =>
      api.users.create({
        username: data.username,
        password: data.password || data.username.padEnd(6, '0'),
        role: data.role,
      }),
    );
    if (response.ok) {
      set((state) => ({
        users: [...state.users, response.data],
        isLoading: false,
      }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to create user';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  removeUser: async (userId) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.users.remove({ id: userId }));
    if (response.ok) {
      set((state) => ({
        users: state.users.filter((user) => user.id !== userId),
        isLoading: false,
      }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to delete user';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  resetPassword: async (userId, newPassword) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.users.resetPassword({ id: userId, newPassword }));
    if (response.ok) {
      set({ isLoading: false });
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to reset password';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  clearError: () => set({ error: null }),
}));
