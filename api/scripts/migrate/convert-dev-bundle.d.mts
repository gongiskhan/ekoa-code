/**
 * Type declarations for the convert-dev-bundle build-tooling module (2B-S5).
 * The runtime is plain ESM JS (`.mjs`, no product imports); these types let the
 * converter unit test and the artifact-family contract test consume it with real
 * types under NodeNext resolution.
 */

/** Canonical app-data dump carried under `ArtifactBundle.data` (matches AppDataAccess). */
export interface ConvertedAppDataDump {
  collections: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  totalItems: number;
  at: string;
}

/** The shared-ArtifactBundle-shaped output of the converter. */
export interface ConvertedBundle {
  manifestId: string;
  name?: string;
  slug?: string;
  /** Prod canonical id (envelope.sourceArtifactId) for preserveId migrations (S3). */
  id?: string;
  files?: Array<{ path: string; content: string }>;
  data?: ConvertedAppDataDump;
  version?: string;
}

export function decodeUtf8Strict(buf: Uint8Array, label: string): string;
export function readUtf8Strict(path: string): string;
export function normalizeAppData(source: unknown, fallbackAt?: string): ConvertedAppDataDump | undefined;
export function slugFromName(name: unknown): string;
export function screenAppData(
  data: ConvertedAppDataDump | undefined,
  warn: (msg: string) => void,
): ConvertedAppDataDump | undefined;
export function convertDevBundle(
  envelope: unknown,
  opts?: {
    appData?: unknown;
    slug?: string;
    /** Canonical prod artifact id (--id): wins over envelope.sourceArtifactId (S3 preserveId). */
    id?: string;
    /** Inject the ekoa-code-only manifest Graph opt-in (--m365-proxy). */
    m365Proxy?: boolean;
    warn?: (msg: string) => void;
  },
): ConvertedBundle;
