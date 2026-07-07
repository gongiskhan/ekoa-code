'use client';

/**
 * Teams Store
 *
 * Manages teams state.
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';
import type { TeamWithMemberCount, CreateTeamRequest, UpdateTeamRequest } from '@/lib/api/client';

interface TeamsState {
  // State
  teams: TeamWithMemberCount[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchTeams: () => Promise<void>;
  addTeam: (data: CreateTeamRequest) => Promise<{ success: boolean; error?: string }>;
  editTeam: (id: string, data: UpdateTeamRequest) => Promise<{ success: boolean; error?: string }>;
  removeTeam: (id: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useTeamsStore = create<TeamsState>()((set, get) => ({
  teams: [],
  isLoading: false,
  error: null,

  fetchTeams: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.getTeams();
      if (response.success && response.data) {
        set({ teams: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch teams',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch teams',
        isLoading: false,
      });
    }
  },

  addTeam: async (data: CreateTeamRequest) => {
    try {
      const response = await api.createTeam(data);
      if (response.success && response.data) {
        const newTeam: TeamWithMemberCount = {
          ...response.data,
          memberCount: 0,
        };
        set({ teams: [...get().teams, newTeam] });
        return { success: true };
      }
      return {
        success: false,
        error: response.error?.message || 'Failed to create team',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create team',
      };
    }
  },

  editTeam: async (id: string, data: UpdateTeamRequest) => {
    try {
      const response = await api.updateTeam(id, data);
      if (response.success && response.data) {
        set({
          teams: get().teams.map((team) =>
            team.id === id ? { ...team, ...response.data } : team
          ),
        });
        return { success: true };
      }
      return {
        success: false,
        error: response.error?.message || 'Failed to update team',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update team',
      };
    }
  },

  removeTeam: async (id: string) => {
    try {
      const response = await api.deleteTeam(id);
      if (response.success) {
        set({
          teams: get().teams.filter((team) => team.id !== id),
        });
        return { success: true };
      }
      return {
        success: false,
        error: response.error?.message || 'Failed to delete team',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete team',
      };
    }
  },

  clearError: () => set({ error: null }),
}));
