/**
 * Frontend types for the Tutorial Bridge demo specs. These mirror the
 * authoritative zod schema in cortex/src/services/demo-registry.ts. The two are
 * kept in sync by the shared _schema.json and the registry test; the e2e harness
 * validates the shape at runtime, so drift surfaces immediately.
 */

export interface DemoCopy {
  titlePt: string;
  bodyPt: string;
}

export interface DemoCard {
  titlePt: string;
  descriptionPt: string;
  durationSec: number;
  thumbnail?: string;
}

export type DemoSimulateAction =
  | { kind: "click"; target: string }
  | { kind: "fill"; target: string; value: string }
  | { kind: "select"; target: string; value?: string; index?: number };

export interface NavigateStep {
  id: string;
  type: "navigate";
  to: string;
  copy?: DemoCopy;
}

export interface SpotlightStep {
  id: string;
  type: "spotlight";
  target: string;
  copy: DemoCopy;
  timeoutMs?: number;
}

export interface AwaitActionStep {
  id: string;
  type: "await-action";
  target: string;
  event: "click" | "result-ready";
  simulate: { actions: DemoSimulateAction[] };
  timeoutMs?: number;
}

export interface AnnotateResultStep {
  id: string;
  type: "annotate-result";
  target: string;
  copy: DemoCopy;
  timeoutMs?: number;
}

export interface InjectPromptStep {
  id: string;
  type: "inject-prompt";
  surface: "chat";
  prompt: string;
  sendInHarness?: false;
  copy?: DemoCopy;
}

export interface ExternalImageStep {
  id: string;
  type: "external-image-step";
  image: string;
  copy: DemoCopy;
}

export type DemoStep =
  | NavigateStep
  | SpotlightStep
  | AwaitActionStep
  | AnnotateResultStep
  | InjectPromptStep
  | ExternalImageStep;

export interface DemoSpec {
  version: 1;
  appId: string;
  card: DemoCard;
  steps: DemoStep[];
}

export type DemoCardSummary = { appId: string; card: DemoCard };

export type TourStatus =
  | "idle"
  | "running"
  | "awaiting"
  | "done"
  | "cancelled"
  | "error";

export interface TourState {
  status: TourStatus;
  stepIndex: number;
  totalSteps: number;
  step: DemoStep | null;
  /** True when the current step advances via the "Seguinte" button. */
  awaitingManual: boolean;
  /** For annotate-result: whether the app's result has arrived. */
  resultReady: boolean;
  error?: string;
}

/** postMessage envelope discriminator shared with the injected bridge client. */
export const DEMO_ENVELOPE = 1 as const;
