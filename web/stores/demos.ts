"use client";

import { create } from "zustand";
import type { DemoCardSummary, DemoSpec, TourState } from "@/lib/demo/types";

/**
 * Demo (Tutorial Bridge) store: the gallery cards, the active tour's spec and
 * live state, and the prompt an inject-prompt step surfaced for the chat
 * composer. The DemoTourProvider writes here; the overlay and (future) landing
 * panel read from here.
 */
interface DemosState {
  cards: DemoCardSummary[];
  cardsLoaded: boolean;
  activeAppId: string | null;
  spec: DemoSpec | null;
  tour: TourState | null;
  injectedPrompt: string | null;

  setCards: (cards: DemoCardSummary[]) => void;
  startTour: (appId: string, spec: DemoSpec) => void;
  setTour: (tour: TourState) => void;
  setInjectedPrompt: (prompt: string | null) => void;
  endTour: () => void;
}

export const useDemosStore = create<DemosState>((set) => ({
  cards: [],
  cardsLoaded: false,
  activeAppId: null,
  spec: null,
  tour: null,
  injectedPrompt: null,

  setCards: (cards) => set({ cards, cardsLoaded: true }),
  startTour: (appId, spec) => set({ activeAppId: appId, spec, tour: null, injectedPrompt: null }),
  setTour: (tour) => set({ tour }),
  setInjectedPrompt: (injectedPrompt) => set({ injectedPrompt }),
  endTour: () => set({ activeAppId: null, spec: null, tour: null, injectedPrompt: null }),
}));
