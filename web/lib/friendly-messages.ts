/**
 * Friendly UI messages for build phases, tool activity, and summaries.
 * Uses getTranslations() from @/lib/i18n for locale-aware strings.
 */

import { getTranslations } from '@/lib/i18n';

export function getFriendlyPhaseMessage(phase: string, _locale?: string): string {
  const t = getTranslations();
  const fm = t.friendlyMessages;
  const key = phase as keyof typeof fm.phases;
  return fm.phases[key] || fm.phaseDefault(phase);
}

export function getFriendlyToolActivity(
  toolName: string,
  _args: Record<string, unknown>,
  _locale?: string,
): string | null {
  const t = getTranslations();
  const fm = t.friendlyMessages;
  const key = toolName as keyof typeof fm.tools;
  return fm.tools[key] || fm.toolDefault(toolName);
}

export function getFriendlySummary(
  result: { success: boolean; summary: string },
  _locale?: string,
): string {
  const t = getTranslations();
  const fm = t.friendlyMessages;
  if (result.success) {
    return result.summary || fm.buildSuccess;
  }
  return result.summary || fm.buildFailed;
}

export function getRotatingFillerMessage(
  phase: string | null,
  index: number,
  _locale?: string,
): string {
  const t = getTranslations();
  const fillers = t.friendlyMessages.fillers;
  return fillers[index % fillers.length];
}

/** Format a raw agent/skill name into a readable label */
function formatAgentName(name: string): string {
  // Strip UUIDs, task IDs, and file extensions
  let clean = name
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\.md$/i, '')
    .replace(/^.*\//, '') // strip path prefix
    .replace(/SKILL$/i, '')
    .trim();

  // Convert kebab-case/snake_case to title case
  clean = clean
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  return clean || name;
}

export function getFriendlySubagentMessage(
  agent: string,
  event: string,
  description?: string,
  _locale?: string,
): string {
  const t = getTranslations();
  const fm = t.friendlyMessages;
  const name = formatAgentName(agent);
  switch (event) {
    case 'started':
    case 'agent_started':
      return fm.subagentDelegating(name);
    case 'progress':
      return fm.subagentProgress(name, description || fm.fillers[0]);
    case 'completed':
    case 'agent_completed':
      return description
        ? fm.subagentFinishedWith(name, description)
        : fm.subagentFinished(name);
    case 'failed':
      return fm.subagentFailed(name);
    default:
      return fm.subagentDefault(name, event);
  }
}

export function getFriendlySkillMessage(
  skill: string,
  _locale?: string,
): string {
  const t = getTranslations();
  const name = formatAgentName(skill);
  return t.friendlyMessages.usingSkill(name);
}

export function getFriendlyToolActivityBrief(
  toolName: string,
  args: Record<string, unknown>,
  _locale?: string,
): string {
  const t = getTranslations();
  const fm = t.friendlyMessages;

  const path = (args.file_path || args.path || args.filename) as string | undefined;
  const shortPath = path ? path.replace(/^.*\//, '') : null;
  const command = (args.command || args.cmd) as string | undefined;
  const shortCmd = command
    ? command.length > 40
      ? command.slice(0, 40) + '...'
      : command
    : null;
  const pattern = (args.pattern || args.query) as string | undefined;

  const name = toolName.toLowerCase();
  if (name.includes('write') || name === 'write_file')
    return shortPath ? fm.writingPath(shortPath) : fm.writingFile;
  if (name.includes('edit') || name === 'edit_file')
    return shortPath ? fm.editingPath(shortPath) : fm.editingFile;
  if (name.includes('read') || name === 'read_file')
    return shortPath ? fm.readingPath(shortPath) : fm.readingFile;
  if (name.includes('bash') || name.includes('exec') || name.includes('command') || name.includes('shell'))
    return shortCmd ? fm.runningCmd(shortCmd) : fm.runningCommand;
  if (name.includes('search') || name.includes('grep'))
    return pattern ? fm.searchingFor(pattern) : fm.searchingCode;
  if (name.includes('glob') || name.includes('find'))
    return pattern ? fm.findingPattern(pattern) : fm.findingFiles;
  if (name.includes('list') || name.includes('ls'))
    return shortPath ? fm.listingPath(shortPath) : fm.listingFiles;
  if (name.includes('delete') || name.includes('remove'))
    return shortPath ? fm.deletingPath(shortPath) : fm.deleting;
  return fm.usingTool(toolName);
}
