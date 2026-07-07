/**
 * Template types -- shared frontend type definitions.
 *
 * ConfigItem is the canonical interface for template configuration items.
 * Worktree 4 depends on this interface -- do not change without coordinating.
 */

// ============================================
// CONFIG ITEMS (canonical interface)
// ============================================

export type ConfigItemType = 'text' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'steps' | 'color' | 'email' | 'phone' | 'textarea' | 'url';

export interface ConfigItemOption {
  value: string;
  label: string;
}

export interface ConfigItemStep {
  id: string;
  label: string;
}

export interface ConfigItem {
  id: string;
  label: string;
  description?: string;
  type: ConfigItemType;
  required: boolean;
  options?: ConfigItemOption[];
  steps?: ConfigItemStep[];
  defaultValue?: unknown;
  group?: string;
  showWhen?: { field: string; value: unknown };
}

// ============================================
// TEMPLATE TYPES
// ============================================

export type OutputKind =
  | 'web_app'
  | 'landing_page'
  | 'report_excel'
  | 'agent_app'
  | 'presentation_html'
  | 'document_pdf';

export interface BuildConfig {
  /** Entry point file relative to project root (default "frontend/src/index.jsx"). */
  entryPoint?: string;
  /** Build output directory relative to project root (default "dist/"). */
  outputDir?: string;
  /** App type: "jsx-app", "html-app", or "static" (default "jsx-app"). */
  type?: string;
  workingDirTemplate: string;
}

export interface ExpectedOutput {
  kind: 'url' | 'file';
  label: string;
  description?: string;
  required: boolean;
  fileExtensions?: string[];
  pathPattern?: string;
}

export interface TemplateExample {
  title: string;
  titlePt?: string;
  description: string;
  descriptionPt?: string;
  prompt: string;
  promptPt?: string;
}

export interface TemplateField {
  fieldId: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'url' | 'color' | 'email' | 'phone';
  label: string;
  labelPt?: string;
  placeholder?: string;
  placeholderPt?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; labelPt?: string; value: string }>;
  order?: number;
}

export interface TemplateFile {
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface TemplateData {
  id: string;
  name: string;
  namePt?: string;
  description: string;
  descriptionPt?: string;
  icon?: string;
  keywords?: string[];
  outputKind: OutputKind;
  enabled: boolean;
  isDefault?: boolean;
  defaultForKind?: boolean;
  buildConfig: BuildConfig;
  expectedOutputs: ExpectedOutput[];
  brandingRequired: boolean;
  allowDownload?: boolean;
  constraints: string[];
  instructions?: string;
  guidelines?: string;
  examples?: TemplateExample[];
  files?: TemplateFile[];
  configItems?: ConfigItem[];
  fields?: TemplateField[];
  screenshotUrl?: string | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Default build config for new templates */
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
  workingDirTemplate: '${instanceId}',
};

/** All known output kinds for dropdowns */
export const OUTPUT_KINDS: OutputKind[] = [
  'web_app',
  'landing_page',
  'report_excel',
  'agent_app',
  'presentation_html',
  'document_pdf',
];
