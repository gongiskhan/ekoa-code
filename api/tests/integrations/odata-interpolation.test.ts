/**
 * Regression for the `$`-prefixed OData interpolation fix (2A-S1; ported from ekoa-dev
 * event-sourcing/odata-interpolation.test.ts). The fix already lives in ekoa-code's
 * http-template.ts (`/\{\{(\$?\w+)\}\}/g`); this test is the guard that keeps it there.
 *
 * The M365 `list_emails` action templates `{{$top}}` / `{{$filter}}` / `{{$orderby}}` — the OData
 * params the platform-poll source needs. `$` is not a `\w` char, so a plain `/\{\{(\w+)\}\}/g` would
 * leave them literal and Graph would ignore/reject them. We assert the REAL exported `interpolate`
 * substitutes both `$`- and plain-word placeholders, and that the shipped m365 config + the
 * http-template source are wired to it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { interpolate } from '../../src/integrations/http-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, '..', '..');

describe('OData $-placeholder interpolation (http-template)', () => {
  const vars = {
    $top: '50',
    $filter: 'receivedDateTime ge 2026-06-19T09:00:00Z',
    $orderby: 'receivedDateTime asc',
    access_token: 'tok',
  };

  it('substitutes $-prefixed params', () => {
    expect(interpolate('{{$top}}', vars)).toBe('50');
    expect(interpolate('{{$filter}}', vars)).toBe('receivedDateTime ge 2026-06-19T09:00:00Z');
    expect(interpolate('{{$orderby}}', vars)).toBe('receivedDateTime asc');
  });

  it('still substitutes plain-word params', () => {
    expect(interpolate('Bearer {{access_token}}', vars)).toBe('Bearer tok');
  });

  it('leaves unknown placeholders empty (not literal)', () => {
    expect(interpolate('{{$unknown}}', vars)).toBe('');
  });

  it('the shipped m365 list_emails config templates the $-params the poll source needs', () => {
    const cfgPath = join(API_ROOT, 'assets', 'integrations', 'microsoft-365', 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { actions: Array<{ actionName: string; httpConfig: { queryParams?: Record<string, string> } }> };
    const list = cfg.actions.find((a) => a.actionName === 'list_emails');
    expect(list).toBeTruthy();
    const qp = list!.httpConfig.queryParams ?? {};
    expect(qp.$top).toBe('{{$top}}');
    expect(qp.$filter).toBe('{{$filter}}');
    expect(qp.$orderby).toBe('{{$orderby}}');
  });

  it('the http-template source carries the $-aware regex', () => {
    const srcPath = join(API_ROOT, 'src', 'integrations', 'http-template.ts');
    const src = readFileSync(srcPath, 'utf8');
    expect(src).toContain('\\{\\{(\\$?\\w+)\\}\\}');
  });
});
