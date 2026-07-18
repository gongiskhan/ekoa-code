import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { VOICE_TTS_WS_PATH } from '@ekoa/shared';
import type { VoiceLang } from '@ekoa/shared';
import { sanitizeForSpeech, chunkSentences, speakableChunks } from '../../src/voice/text/pipeline.js';
import {
  registerTtsProvider,
  __resetVoiceProvidersForTests,
  type VoiceAttribution,
} from '../../src/voice/providers.js';
import { wavHeader } from '../../src/voice/stub-providers.js';
import {
  initVoiceTestEnv,
  resetVoiceTestState,
  startVoiceServer,
  stopVoiceServer,
  seedUserToken,
  sleep,
  VoiceClient,
  type VoiceTestServer,
} from './helpers.js';

/**
 * C5 (mega-run 20260717-190134): the TTS text pipeline - sanitize (strip markdown/code/
 * tables/images, the belt-and-braces behind the voice context note) -> normalize numbers
 * (speakable.ts, C3) -> sentence-chunk for per-sentence streaming synthesis. Pure parts are
 * zero-mock; the wiring is proven over a REAL WS tts-stream session with a CAPTURING provider
 * registered under the configured pt key, asserting the provider receives exactly the
 * pipeline's output, per sentence, in order.
 */

/* ----------------------------------- sanitizer ----------------------------------- */

describe('sanitizeForSpeech', () => {
  it('drops fenced code blocks entirely (content included)', () => {
    const text = 'Antes do código.\n```ts\nconst x = 1;\nconsole.log(x);\n```\nDepois do código.';
    expect(sanitizeForSpeech(text)).toBe('Antes do código.\n\nDepois do código.');
  });

  it('an unclosed fence swallows the rest (better silence than half a diff aloud)', () => {
    const text = 'Prosa.\n```\ncódigo sem fecho\ne mais código';
    expect(sanitizeForSpeech(text)).toBe('Prosa.');
  });

  it('drops markdown table rows and separator rows', () => {
    const text = 'A tabela:\n\n| Processo | Prazo |\n|---|---|\n| 123 | amanhã |\n\nFim.';
    expect(sanitizeForSpeech(text)).toBe('A tabela:\n\nFim.');
  });

  it('keeps a prose sentence with a single stray pipe (C5 review: not a table)', () => {
    const text = 'O prazo é 30 dias | o recurso é 15 dias, conforme o artigo.';
    expect(sanitizeForSpeech(text)).toBe(text);
  });

  it('drops a separator-less 2-cell table block via context (C5 codex review)', () => {
    const text = 'Preços:\n\nItem | Preço\nPlano | 10\nPro | 20\n\nFim.';
    const out = sanitizeForSpeech(text);
    expect(out).not.toContain('Plano | 10');
    expect(out).not.toContain('Item | Preço');
    expect(out).toContain('Preços');
    expect(out).toContain('Fim.');
  });

  it('keeps two consecutive PROSE lines that each contain a pipe (C5 codex review: not a run)', () => {
    const text = 'Usa filtro A | filtro B ao comparar resultados.\nMantém foo | bar como o exemplo exato.';
    const out = sanitizeForSpeech(text);
    expect(out).toContain('filtro A | filtro B');
    expect(out).toContain('foo | bar');
  });

  it('keeps a sentence whose inline code contains a pipe (C5 review)', () => {
    const text = 'Para filtrar, corre `grep erro | sort` no terminal. Depois avisa-me.';
    expect(sanitizeForSpeech(text)).toBe('Para filtrar, corre grep erro | sort no terminal. Depois avisa-me.');
  });

  it('drops an indented fenced block inside a list item (C5 review)', () => {
    const text = 'Passos:\n\n- Corre isto:\n   ```\n   npm run x\n   ```\n- Confirma o resultado.';
    const out = sanitizeForSpeech(text);
    expect(out).not.toContain('npm run x');
    expect(out).not.toContain('```');
    expect(out).toContain('Confirma o resultado');
  });

  it('drops images entirely and keeps link text without the URL', () => {
    const text = 'Veja ![gráfico](https://x.pt/g.png) o [relatório](https://x.pt/r) hoje.';
    expect(sanitizeForSpeech(text)).toBe('Veja o relatório hoje.');
  });

  it('drops bare URLs and autolinks', () => {
    const text = 'Está em https://exemplo.pt/doc?id=1 e <https://outro.pt> agora.';
    expect(sanitizeForSpeech(text)).toBe('Está em e agora.');
  });

  it('unwraps emphasis, inline code, headings, blockquotes and list markers', () => {
    const text = '# Título\n\n> Nota **importante** com `código` e *ênfase*.\n\n- primeiro item\n2. segundo item';
    expect(sanitizeForSpeech(text)).toBe('Título\n\nNota importante com código e ênfase.\n\nprimeiro item\nsegundo item');
  });

  it('keeps snake_case intact while stripping underscore emphasis', () => {
    expect(sanitizeForSpeech('o campo user_id fica _inalterado_ aqui')).toBe('o campo user_id fica inalterado aqui');
  });

  it('drops horizontal rules and stray HTML tags, collapses whitespace', () => {
    const text = 'Um.\n\n---\n\nDois   com <b>tag</b> dentro.\n\n\n\nTrês.';
    expect(sanitizeForSpeech(text)).toBe('Um.\n\nDois com tag dentro.\n\nTrês.');
  });

  it('is the identity on plain prose', () => {
    const text = 'Prosa normal, sem qualquer marcação. Segunda frase.';
    expect(sanitizeForSpeech(text)).toBe(text);
  });
});

/* ------------------------------- sentence chunking ------------------------------- */

describe('chunkSentences', () => {
  it('splits on sentence-final punctuation', () => {
    expect(chunkSentences('Olá. Está tudo bem? Sim!')).toEqual(['Olá.', 'Está tudo bem?', 'Sim!']);
  });

  it('does not split after PT abbreviations or initials', () => {
    expect(chunkSentences('O Sr. Silva falou com o Dr. Costa. Depois saiu.')).toEqual([
      'O Sr. Silva falou com o Dr. Costa.',
      'Depois saiu.',
    ]);
    expect(chunkSentences('Ver art. 5 do contrato. Fim.')).toEqual(['Ver art. 5 do contrato.', 'Fim.']);
    expect(chunkSentences('Assinado por J. Silva ontem. Confirmado.')).toEqual([
      'Assinado por J. Silva ontem.',
      'Confirmado.',
    ]);
    expect(chunkSentences('Use p. ex. quinze dias. Depois envie.')).toEqual([
      'Use p. ex. quinze dias.',
      'Depois envie.',
    ]);
  });

  it('does not split inside dotted numbers, and does split after a number that ends a sentence', () => {
    expect(chunkSentences('São 1.234 processos ao todo. Muitos.')).toEqual([
      'São 1.234 processos ao todo.',
      'Muitos.',
    ]);
    expect(chunkSentences('A versão é 1.2.3. Atualize hoje.')).toEqual(['A versão é 1.2.3.', 'Atualize hoje.']);
    expect(chunkSentences('O total é 1.234. Confirme.')).toEqual(['O total é 1.234.', 'Confirme.']);
  });

  it('treats paragraph breaks as boundaries and folds single newlines into spaces', () => {
    expect(chunkSentences('Primeira linha\ncontinua aqui.\n\nNovo parágrafo.')).toEqual([
      'Primeira linha continua aqui.',
      'Novo parágrafo.',
    ]);
  });

  it('keeps a tail without terminal punctuation as its own chunk', () => {
    expect(chunkSentences('Frase completa. E um resto sem ponto final')).toEqual([
      'Frase completa.',
      'E um resto sem ponto final',
    ]);
  });

  it('splits an over-long sentence at a clause boundary, never mid-word', () => {
    const long = `${'palavra '.repeat(40)}antes da vírgula, ${'depois '.repeat(20)}fim.`;
    const chunks = chunkSentences(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
    // Nothing lost: rejoining reproduces every word.
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
  });
});

/* ------------------------------- composed pipeline ------------------------------- */

describe('speakableChunks (sanitize -> normalize -> chunk)', () => {
  it('produces PT-PT speakable sentences from markdown with digits', () => {
    const text = '## Resumo\n\nO prazo termina no dia 16. Custa **€1.234,50** ao todo.';
    expect(speakableChunks(text, 'pt-PT')).toEqual([
      'Resumo',
      'O prazo termina no dia dezasseis.',
      'Custa mil duzentos e trinta e quatro euros e cinquenta cêntimos ao todo.',
    ]);
  });

  it('normalizes in English for lang en', () => {
    expect(speakableChunks('The fee is 15%. Done.', 'en')).toEqual(['The fee is fifteen percent.', 'Done.']);
  });

  it('pt-BR reuses the PT normalizer (documented v1 limit)', () => {
    expect(speakableChunks('São 16 dias.', 'pt-BR')).toEqual(['São dezasseis dias.']);
  });

  it('returns [] when nothing speakable survives (code-only reply)', () => {
    expect(speakableChunks('```js\nconsole.log(1);\n```', 'pt-PT')).toEqual([]);
    expect(speakableChunks('   ', 'pt-PT')).toEqual([]);
  });
});

/* ------------------------------ relay wiring (real WS) ------------------------------ */

let t: VoiceTestServer;

beforeAll(() => initVoiceTestEnv());
beforeEach(async () => {
  resetVoiceTestState();
  t = await startVoiceServer();
});
afterEach(async () => {
  __resetVoiceProvidersForTests();
  await stopVoiceServer(t);
});

function ttsUrl(token: string): string {
  return `ws://127.0.0.1:${t.port}${VOICE_TTS_WS_PATH}?token=${encodeURIComponent(token)}`;
}

describe('tts-stream applies the pipeline before the provider', () => {
  it('the provider receives sanitized+normalized SENTENCES, in order - never the raw say text', async () => {
    const received: Array<{ text: string; lang: VoiceLang; attribution: VoiceAttribution }> = [];
    // Capturing provider under the CONFIGURED pt-PT key ('google'), so resolution is the
    // real config path, not the stub fallback. One tiny well-formed WAV per sentence.
    registerTtsProvider({
      key: 'google',
      synthesizeStream: (text, lang, _signal, attribution) => {
        received.push({ text, lang, attribution });
        return (async function* () {
          yield wavHeader(4);
          yield Buffer.from([0, 0, 0, 0]);
        })();
      },
    });

    const token = seedUserToken('u-pipe-1', 'org-pipe-1', 'ana');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    const say = '## Estado\n\nO prazo termina no dia 16. Depois disso, o processo fecha.';
    c.client.send(JSON.stringify({ type: 'say', text: say, lang: 'pt-PT', turnId: 't-pipe' }));
    const speaking = await c.waitForJson((m) => m.type === 'speaking');
    expect(speaking.ttsProvider).toBe('google');
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't-pipe');

    expect(received.map((r) => r.text)).toEqual([
      'Estado',
      'O prazo termina no dia dezasseis.',
      'Depois disso, o processo fecha.',
    ]);
    for (const r of received) {
      expect(r.lang).toBe('pt-PT');
      expect(r.attribution).toMatchObject({ orgId: 'org-pipe-1', userId: 'u-pipe-1' });
    }
    // One complete WAV container per sentence on the wire (the client segments on RIFF).
    const riffFrames = c.binaryFrames().filter((f) => f.toString('ascii', 0, 4) === 'RIFF');
    expect(riffFrames.length).toBe(3);

    c.terminate();
    await c.waitClosed();
  });

  it('a multi-sentence say against the STUB streams one WAV container per sentence', async () => {
    const token = seedUserToken('u-pipe-2', 'org-pipe-2', 'rui');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    c.client.send(
      JSON.stringify({ type: 'say', text: 'Primeira frase completa. Segunda frase completa.', lang: 'pt-PT', turnId: 't-multi' }),
    );
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't-multi');

    const riffFrames = c.binaryFrames().filter((f) => f.toString('ascii', 0, 4) === 'RIFF');
    expect(riffFrames.length).toBe(2);

    c.terminate();
    await c.waitClosed();
  });

  it('a say with nothing speakable (code-only) completes the turn with zero audio', async () => {
    const token = seedUserToken('u-pipe-3', 'org-pipe-3', 'eva');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    c.client.send(
      JSON.stringify({ type: 'say', text: '```py\nprint("olá")\n```', lang: 'pt-PT', turnId: 't-empty' }),
    );
    await c.waitForJson((m) => m.type === 'speaking' && m.turnId === 't-empty');
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't-empty');
    await sleep(30);
    expect(c.binaryFrames().length).toBe(0);
    expect(c.jsonMessages().some((m: any) => m.type === 'error')).toBe(false);

    c.terminate();
    await c.waitClosed();
  });
});
