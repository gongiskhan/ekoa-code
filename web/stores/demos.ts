"use client";

import { create } from "zustand";
import type { DemoSpec, TourState } from "@/lib/demo/types";

/**
 * Demo (Tutorial Bridge) store: the active tour's spec and live state, and the
 * prompt an inject-prompt step surfaced for the chat composer. The
 * DemoTourProvider writes here; the overlay reads from here.
 */
interface DemosState {
  activeAppId: string | null;
  spec: DemoSpec | null;
  tour: TourState | null;
  injectedPrompt: string | null;

  startTour: (appId: string, spec: DemoSpec) => void;
  setTour: (tour: TourState) => void;
  setInjectedPrompt: (prompt: string | null) => void;
  endTour: () => void;
}

export const useDemosStore = create<DemosState>((set) => ({
  activeAppId: null,
  spec: null,
  tour: null,
  injectedPrompt: null,

  startTour: (appId, spec) => set({ activeAppId: appId, spec, tour: null, injectedPrompt: null }),
  setTour: (tour) => set({ tour }),
  setInjectedPrompt: (injectedPrompt) => set({ injectedPrompt }),
  endTour: () => set({ activeAppId: null, spec: null, tour: null, injectedPrompt: null }),
}));
