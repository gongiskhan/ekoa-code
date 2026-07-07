'use client';

/**
 * Users Store
 *
 * Manages user list and admin operations (create, delete, reset password).
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';
import type { AuthUser } from '@/lib/api/client';

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
    role: 'admin' | 'builder';
    teamId?: string;
    passwordChangeRequired?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  removeUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (userId: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useUsersStore = create<UsersState>()((set, get) => ({
  users: [],
  isLoading: false,
  error: null,

  fetchUsers: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.listUsers();
      if (response.success && response.data) {
        set({ users: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch users',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch users',
        isLoading: false,
      });
    }
  },

  addUser: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.createUser(data);

      if (response.success && response.data) {
        set((state) => ({
          users: [...state.users, response.data!],
          isLoading: false,
        }));
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to create user';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to create user';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  removeUser: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.deleteUser(userId);
      if (response.success) {
        set((state) => ({
          users: state.users.filter((user) => user.id !== userId),
          isLoading: false,
        }));
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to delete user';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete user';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  resetPassword: async (userId, newPassword) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.resetUserPassword(userId, newPassword);
      if (response.success) {
        set({ isLoading: false });
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to reset password';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to reset password';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  clearError: () => set({ error: null }),
}));
