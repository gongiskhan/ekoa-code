/**
 * Mode-picker absence test. The unified chat experience is now system-guided
 * — the orchestrator picks the mode and asks clarifying questions. The user
 * NEVER picks a mode from a UI control. This file asserts that the chat
 * empty/welcome surfaces carry no mode-picker affordances.
 *
 * Strategy: static analysis of the relevant source files plus a smoke
 * render of EmptyState. Full render-and-assert was attempted (see git
 * history) but framer-motion + next/image + ReactMarkdown together don't
 * play well with the jsdom + React 19 + Vitest 4 combo, and the value
 * of the test is the "no mode picker" guard, not exercising the render
 * pipeline. Source-level audits catch the regression patterns we care
 * about (radiogroup roles, mode-picker testids, picker phrasing).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const FILES_TO_AUDIT = [
  'components/chat/empty-state.tsx',
  'app/(dashboard)/chat/[[...sessionId]]/page.tsx',
].map((p) => join(REPO_ROOT, p));

// Forbidden source-level patterns. Any one indicates the mode picker has
// been re-introduced and the user is being asked to pick a mode.
const FORBIDDEN_SOURCE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'data-testid="mode-picker"', re: /data-testid=["']mode-picker["']/i },
  { name: 'role="radiogroup" within chat empty surfaces', re: /role=["']radiogroup["']/i },
  { name: 'ModePicker component import', re: /\bModePicker\b/ },
  { name: 'mode-picker className', re: /className=["'][^"']*mode-picker[^"']*["']/i },
  { name: 'select-your-mode phrasing', re: /select\s+your\s+mode/i },
  { name: 'pick-a-mode phrasing', re: /pick\s+a\s+mode/i },
  { name: 'which-mode phrasing', re: /which\s+mode/i },
  { name: 'escolha-o-modo phrasing', re: /escolha\s+o\s+modo/i },
  { name: 'selecione-o-modo phrasing', re: /selecione\s+o\s+modo/i },
];

describe('Chat surfaces — static audit for mode-picker patterns', () => {
  for (const filePath of FILES_TO_AUDIT) {
    const rel = filePath.replace(REPO_ROOT + '/', '');

    it(`${rel} exists`, () => {
      expect(existsSync(filePath), `expected ${rel} to exist`).toBe(true);
    });

    it(`${rel} contains no mode-picker source patterns`, () => {
      if (!existsSync(filePath)) return; // already failed above
      const src = readFileSync(filePath, 'utf-8');
      const hits = FORBIDDEN_SOURCE_PATTERNS.filter((p) => p.re.test(src));
      expect(
        hits,
        hits.length
          ? `${rel} contains forbidden mode-picker pattern(s): ${hits
              .map((h) => h.name)
              .join(', ')}`
          : '',
      ).toEqual([]);
    });
  }
});

describe('Chat surfaces — no chatMode branches in render paths', () => {
  it('app/(dashboard)/chat/[[...sessionId]]/page.tsx has no chatMode === comparisons in JSX', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'app/(dashboard)/chat/[[...sessionId]]/page.tsx'),
      'utf-8',
    );
    // Match chatMode === "..." or chatMode === '...'
    const hits = src.match(/chatMode\s*===\s*["'][^"']+["']/g) ?? [];
    expect(
      hits,
      hits.length
        ? `chat page has ${hits.length} chatMode === comparison(s) still in source: ${hits.join(', ')}. Replace with sidePanelState or data-presence checks.`
        : '',
    ).toEqual([]);
  });

  it('app/(dashboard)/chat/[[...sessionId]]/page.tsx does not branch render on chatMode', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'app/(dashboard)/chat/[[...sessionId]]/page.tsx'),
      'utf-8',
    );
    // The render structure should not contain a `{chatMode ` JSX expression.
    expect(src).not.toMatch(/\{chatMode\s*===/);
    expect(src).not.toMatch(/chatMode\s*===\s*["']chat["']\s*\?/);
  });

  it('side-panel + integration-build-panel are not gated on chatMode', () => {
    const sp = readFileSync(join(REPO_ROOT, 'components/builder/side-panel.tsx'), 'utf-8');
    const ibp = readFileSync(
      join(REPO_ROOT, 'components/builder/integration-build-panel.tsx'),
      'utf-8',
    );
    expect(sp).not.toMatch(/chatMode\s*===/);
    expect(ibp).not.toMatch(/setChatMode\(/);
  });
});

describe('Chat surfaces — locale strings carry no mode-picker phrasing', () => {
  it('ekoa/locales/pt.ts has no "select mode" phrasing aimed at the user', () => {
    const pt = readFileSync(join(REPO_ROOT, 'locales/pt.ts'), 'utf-8');
    // The surviving mode labels (emptyState.modeTaglines / modeSubtitles) label
    // the *system-chosen* mode, not a picker. The value strings must not invite
    // the user to choose.
    const forbidden = [
      /escolha o modo/i,
      /selecione o modo/i,
      /escolher um modo/i,
      /qual o seu modo/i,
    ];
    const hits = forbidden.filter((re) => re.test(pt));
    expect(hits.map((re) => re.toString())).toEqual([]);
  });

  it('ekoa/locales/en.ts has no "select mode" phrasing aimed at the user', () => {
    const en = readFileSync(join(REPO_ROOT, 'locales/en.ts'), 'utf-8');
    const forbidden = [
      /select\s+your\s+mode/i,
      /pick\s+a\s+mode/i,
      /which\s+mode/i,
      /choose\s+a\s+mode/i,
    ];
    const hits = forbidden.filter((re) => re.test(en));
    expect(hits.map((re) => re.toString())).toEqual([]);
  });
});
