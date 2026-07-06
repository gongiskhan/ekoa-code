/**
 * STT provider interface for legal-transcricao — ONE interface, three engines:
 *
 *   - `whisperx`   self-hosted WhisperX + pyannote (GCP GPU). DEFAULT POSTURE.
 *                  Unavailable until the operator provisions GPU (item #13).
 *   - `elevenlabs` ElevenLabs Scribe cloud STT. Requires an API key (item #14) AND
 *                  an explicit per-matter cloud-consent flag — voice recordings are
 *                  third-party personal data (RGPD), so cloud processing is opt-in
 *                  per transcription, never default.
 *   - `mock`       Deterministic PT-PT two-speaker fixture. The ONLY engine that
 *                  runs pre-checkpoint; demos, tests and the review editor are
 *                  built against it. Stable word-level timestamps.
 *
 * Metering: every transcription meters `stt:<engine>` per started audio minute at
 * STT_TOKENS_PER_MINUTE into the internal-currency framework.
 *
 * Carried from cortex/src/services/stt-provider.ts (B22/adapt, billing seam B6):
 * the billing constant is defined here and the usage recorder is an INJECTED seam
 * (billing/ lands in its own build phase) so metering stays best-effort.
 */

/** Internal-currency tokens billed per started audio minute (§3.4). */
export const STT_TOKENS_PER_MINUTE = Number(process.env.EKOA_BILLING_STT_TOKENS_PER_MINUTE) || 1500;

export type SttWord = { w: string; start: number; end: number };
export type SttSegment = {
  start: number;
  end: number;
  speaker: string; // diarization label: 'ORADOR_1' | 'ORADOR_2' | ...
  text: string;
  words: SttWord[];
};
export type SttResult = {
  engine: string;
  language: string;
  durationSec: number;
  segments: SttSegment[];
};

export type SttOptions = {
  language?: string; // default 'pt-PT'
  diarize?: boolean; // default true
  /** RGPD: explicit per-matter consent for CLOUD processing. Cloud engines refuse without it. */
  consentCloud?: boolean;
};

export interface SttProvider {
  readonly engine: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  transcribe(audio: Buffer, opts?: SttOptions): Promise<SttResult>;
}

/* ------------------------------------------------------------------------- */
/* mock — deterministic PT-PT audiência fixture (juiz + testemunha)           */
/* ------------------------------------------------------------------------- */

function seg(speaker: string, start: number, text: string, words: Array<[string, number]>): SttSegment {
  const w: SttWord[] = words.map(([token, ts], i) => {
    const next = words[i + 1];
    return { w: token, start: ts, end: next ? next[1] : Math.round((ts + 0.45) * 10) / 10 };
  });
  const last = w[w.length - 1];
  return { speaker, start, end: last ? last.end : start, text, words: w };
}

/**
 * Fixture transcript: a short two-speaker audiência excerpt. Timestamps are
 * deterministic; the review editor, the excerpt generator and every committed
 * test rely on these exact values. ~3 minutes of nominal audio.
 */
export const MOCK_FIXTURE_SEGMENTS: SttSegment[] = [
  seg('ORADOR_1', 12.4, 'Declaro aberta a audiência de julgamento. Peço à testemunha que confirme o seu nome completo.', [
    ['Declaro', 12.4], ['aberta', 12.9], ['a', 13.3], ['audiência', 13.4], ['de', 14.1], ['julgamento.', 14.2],
    ['Peço', 15.1], ['à', 15.5], ['testemunha', 15.6], ['que', 16.3], ['confirme', 16.4], ['o', 17.0],
    ['seu', 17.1], ['nome', 17.4], ['completo.', 17.7],
  ]),
  seg('ORADOR_2', 19.2, 'Chamo-me António Manuel Ferreira da Silva.', [
    ['Chamo-me', 19.2], ['António', 19.9], ['Manuel', 20.5], ['Ferreira', 21.0], ['da', 21.6], ['Silva.', 21.7],
  ]),
  seg('ORADOR_1', 23.5, 'A testemunha conhece a sociedade Construções Tejo, Sociedade Anónima?', [
    ['A', 23.5], ['testemunha', 23.6], ['conhece', 24.3], ['a', 24.8], ['sociedade', 24.9], ['Construções', 25.6],
    ['Tejo,', 26.3], ['Sociedade', 26.8], ['Anónima?', 27.4],
  ]),
  seg('ORADOR_2', 29.0, 'Conheço, sim. Trabalhei na obra do armazém entre março e novembro de dois mil e vinte e quatro.', [
    ['Conheço,', 29.0], ['sim.', 29.6], ['Trabalhei', 30.4], ['na', 31.0], ['obra', 31.1], ['do', 31.5],
    ['armazém', 31.6], ['entre', 32.3], ['março', 32.6], ['e', 33.1], ['novembro', 33.2], ['de', 33.8],
    ['dois', 33.9], ['mil', 34.2], ['e', 34.4], ['vinte', 34.5], ['e', 34.8], ['quatro.', 34.9],
  ]),
  seg('ORADOR_2', 152.7, 'A fatura ficou por pagar porque a obra parou. Foi o que me disseram no estaleiro.', [
    ['A', 152.7], ['fatura', 152.8], ['ficou', 153.4], ['por', 153.8], ['pagar', 154.0], ['porque', 154.5],
    ['a', 155.0], ['obra', 155.1], ['parou.', 155.5], ['Foi', 156.3], ['o', 156.6], ['que', 156.7],
    ['me', 157.0], ['disseram', 157.1], ['no', 157.7], ['estaleiro.', 157.8],
  ]),
  seg('ORADOR_1', 176.0, 'Não havendo mais questões, dou por terminada a inquirição desta testemunha.', [
    ['Não', 176.0], ['havendo', 176.3], ['mais', 176.9], ['questões,', 177.1], ['dou', 177.8], ['por', 178.0],
    ['terminada', 178.2], ['a', 178.9], ['inquirição', 179.0], ['desta', 179.7], ['testemunha.', 180.0],
  ]),
];

const MOCK_DURATION_SEC = 181.2;

class MockSttProvider implements SttProvider {
  readonly engine = 'mock';
  async available(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async transcribe(_audio: Buffer, opts?: SttOptions): Promise<SttResult> {
    return {
      engine: this.engine,
      language: opts?.language ?? 'pt-PT',
      durationSec: MOCK_DURATION_SEC,
      segments: MOCK_FIXTURE_SEGMENTS.map((s) => ({ ...s, words: s.words.map((w) => ({ ...w })) })),
    };
  }
}

/* ------------------------------------------------------------------------- */
/* whisperx / elevenlabs — honest stubs until the checkpoint unlocks them     */
/* ------------------------------------------------------------------------- */

class WhisperxProvider implements SttProvider {
  readonly engine = 'whisperx';
  async available(): Promise<{ ok: boolean; reason?: string }> {
    const endpoint = process.env.EKOA_STT_WHISPERX_URL;
    if (!endpoint) {
      return {
        ok: false,
        reason:
          'WhisperX auto-alojado indisponível: EKOA_STT_WHISPERX_URL não configurado (aprovisionamento GPU - item #13 da sessão de configuração).',
      };
    }
    return { ok: true };
  }
  async transcribe(_audio: Buffer, _opts?: SttOptions): Promise<SttResult> {
    const avail = await this.available();
    if (!avail.ok) throw new Error(avail.reason);
    throw new Error('WhisperX: implementação live activa-se no pós-checkpoint (bake-off R-C).');
  }
}

class ElevenLabsProvider implements SttProvider {
  readonly engine = 'elevenlabs';
  async available(): Promise<{ ok: boolean; reason?: string }> {
    if (!process.env.EKOA_STT_ELEVENLABS_API_KEY) {
      return {
        ok: false,
        reason: 'ElevenLabs Scribe indisponível: chave API não configurada (item #14 da sessão de configuração).',
      };
    }
    return { ok: true };
  }
  async transcribe(_audio: Buffer, opts?: SttOptions): Promise<SttResult> {
    if (opts?.consentCloud !== true) {
      throw new Error(
        'Processamento em nuvem recusado: falta o consentimento explícito por processo (RGPD - gravações contêm dados pessoais de terceiros).',
      );
    }
    const avail = await this.available();
    if (!avail.ok) throw new Error(avail.reason);
    throw new Error('ElevenLabs Scribe: implementação live activa-se no pós-checkpoint (bake-off R-C).');
  }
}

/* ------------------------------------------------------------------------- */
/* registry + metering                                                        */
/* ------------------------------------------------------------------------- */

const PROVIDERS: Record<string, SttProvider> = {
  mock: new MockSttProvider(),
  whisperx: new WhisperxProvider(),
  elevenlabs: new ElevenLabsProvider(),
};

export function listSttProviders(): SttProvider[] {
  return Object.values(PROVIDERS);
}

/**
 * Resolve the engine to use: the preferred one if available, else the default
 * posture (whisperx), else mock — never fails, the mock always answers.
 */
export async function getSttProvider(prefer?: string): Promise<SttProvider> {
  const order = [prefer, 'whisperx', 'mock'].filter(Boolean) as string[];
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p) continue;
    const a = await p.available();
    if (a.ok) return p;
  }
  return PROVIDERS.mock as SttProvider;
}

/** Injected usage recorder (billing seam). Absent => metering is a no-op. */
export type SttUsageRecorder = (u: {
  sessionId: string;
  userId: string;
  agentType: string;
  inputTokens: number;
  outputTokens: number;
  artifactId?: string;
}) => Promise<void> | void;

/**
 * Meter a transcription: `stt:<engine>` at STT_TOKENS_PER_MINUTE per started audio
 * minute (§3.4). Best-effort — a billing failure never loses the finished
 * transcription (the caller wraps in try/catch).
 */
export async function meterStt(
  params: { userId: string; sessionId: string; engine: string; durationSec: number; artifactId?: string },
  record?: SttUsageRecorder,
): Promise<number> {
  const minutes = Math.max(1, Math.ceil(params.durationSec / 60));
  const tokens = minutes * STT_TOKENS_PER_MINUTE;
  if (record) {
    await record({
      sessionId: params.sessionId,
      userId: params.userId,
      agentType: `stt:${params.engine}`,
      inputTokens: tokens,
      outputTokens: 0,
      artifactId: params.artifactId,
    });
  }
  return tokens;
}
