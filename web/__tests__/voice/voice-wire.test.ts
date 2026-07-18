// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parseSttServerMessage,
  parseTtsServerMessage,
  serializeSttClientMessage,
  serializeTtsClientMessage,
  sttStreamUrl,
  ttsStreamUrl,
  voiceLangForLocale,
} from '@/lib/voice/wire';
import { SentenceAssembler } from '@/lib/voice/sentence-assembler';
import { SpeechChannel, type PlaybackLike } from '@/lib/voice/speech-channel';

/**
 * C4 (mega-run 20260717-190134): the pure WS client framing. URL construction (token +
 * session params on the query - a browser WS cannot set headers), zod-validated parse of
 * every inbound message, validated serialization of every outbound one, the locale->lang
 * map, the sentence assembler, and the SpeechChannel say-serialization invariants (one say
 * in flight; the next only after audio_end + local drain; barge-in flushes everything).
 */

describe('voice WS urls', () => {
  it('builds the stt dial url: ws scheme, path, token + session params', () => {
    const url = sttStreamUrl('http://localhost:4111', {
      token: 'tok/1+2',
      sampleRate: 16_000,
      utteranceEndMs: 5_000,
      lang: 'pt-PT',
    });
    expect(url.startsWith('ws://localhost:4111/api/voice/stream?')).toBe(true);
    const params = new URL(url.replace(/^ws/, 'http')).searchParams;
    expect(params.get('token')).toBe('tok/1+2');
    expect(params.get('sample_rate')).toBe('16000');
    expect(params.get('utterance_end_ms')).toBe('5000');
    expect(params.get('lang')).toBe('pt-PT');
  });

  it('upgrades https to wss and omits absent params', () => {
    const url = sttStreamUrl('https://api.ekoa.example', { token: 't', sampleRate: 16_000 });
    expect(url.startsWith('wss://api.ekoa.example/api/voice/stream?')).toBe(true);
    expect(url).not.toContain('utterance_end_ms');
    expect(url).not.toContain('lang');
    expect(ttsStreamUrl('https://api.ekoa.example', { token: 't' })).toBe(
      'wss://api.ekoa.example/api/voice/tts-stream?token=t',
    );
  });
});

describe('inbound validation (every message through the shared unions)', () => {
  it('accepts valid stt server messages and rejects garbage', () => {
    expect(
      parseSttServerMessage(
        JSON.stringify({ type: 'transcript', text: 'Olá', isFinal: false, speechFinal: false }),
      ),
    ).toEqual({ type: 'transcript', text: 'Olá', isFinal: false, speechFinal: false });
    expect(parseSttServerMessage(JSON.stringify({ type: 'utterance_end', transcript: 'Olá.' })))
      .toEqual({ type: 'utterance_end', transcript: 'Olá.' });
    expect(parseSttServerMessage('not json')).toBeNull();
    expect(parseSttServerMessage(JSON.stringify({ type: 'transcript', text: 42 }))).toBeNull();
    expect(parseSttServerMessage(JSON.stringify({ type: 'unknown_kind' }))).toBeNull();
  });

  it('accepts valid tts server messages and rejects malformed ones', () => {
    expect(
      parseTtsServerMessage(
        JSON.stringify({ type: 'speaking', turnId: 't1', lang: 'pt-PT', ttsProvider: 'stub' }),
      ),
    ).toMatchObject({ type: 'speaking', turnId: 't1' });
    expect(parseTtsServerMessage(JSON.stringify({ type: 'cleared' }))).toEqual({ type: 'cleared' });
    expect(parseTtsServerMessage(JSON.stringify({ type: 'speaking', turnId: 7 }))).toBeNull();
  });
});

describe('outbound serialization (validated builds)', () => {
  it('serializes close_stream and turn_committed', () => {
    expect(JSON.parse(serializeSttClientMessage({ type: 'close_stream' }))).toEqual({
      type: 'close_stream',
    });
    expect(
      JSON.parse(
        serializeSttClientMessage({
          type: 'turn_committed',
          transcriptMessageId: 'msg-1',
          mode: 'talking',
        }),
      ),
    ).toEqual({ type: 'turn_committed', transcriptMessageId: 'msg-1', mode: 'talking' });
  });

  it('serializes say/clear and REFUSES an invalid build (client bug surfaces loudly)', () => {
    expect(
      JSON.parse(serializeTtsClientMessage({ type: 'say', text: 'Olá.', lang: 'pt-PT' })),
    ).toEqual({ type: 'say', text: 'Olá.', lang: 'pt-PT' });
    expect(JSON.parse(serializeTtsClientMessage({ type: 'clear' }))).toEqual({ type: 'clear' });
    expect(() =>
      serializeTtsClientMessage({ type: 'say', text: '', lang: 'pt-PT' }),
    ).toThrow(); // empty say violates the shared schema
  });
});

describe('voiceLangForLocale (locale-only resolution, decided)', () => {
  it('maps pt -> pt-PT, keeps pt-BR, defaults everything else to en', () => {
    expect(voiceLangForLocale('pt')).toBe('pt-PT');
    expect(voiceLangForLocale('pt-PT')).toBe('pt-PT');
    expect(voiceLangForLocale('pt-BR')).toBe('pt-BR');
    expect(voiceLangForLocale('en')).toBe('en');
    expect(voiceLangForLocale('fr')).toBe('en');
  });
});

describe('SentenceAssembler', () => {
  it('emits sentences only at boundaries, across arbitrary chunk splits', () => {
    const a = new SentenceAssembler();
    expect(a.push('O prazo é de 30 di')).toEqual([]);
    expect(a.push('as. Pode contestar')).toEqual(['O prazo é de 30 dias.']);
    expect(a.push(' até sexta! E depois')).toEqual(['Pode contestar até sexta!']);
    expect(a.flush()).toBe('E depois');
    expect(a.flush()).toBeNull(); // consumed
  });

  it('keeps abbreviations/enumerations together and waits at a buffer-final terminal', () => {
    const a = new SentenceAssembler();
    // "art. 5" is not a boundary ('5' is no sentence start); the final '.' waits for the
    // next chunk (streaming chunks split anywhere) and lands via flush.
    expect(a.push('Nos termos do art. 5.2 do contrato aplica-se a cláusula. ')).toEqual([]);
    expect(a.flush()).toBe('Nos termos do art. 5.2 do contrato aplica-se a cláusula.');
    // With the next sentence's start visible, the same terminal DOES split.
    expect(a.push('Aplica-se a cláusula. Nada mais resta')).toEqual(['Aplica-se a cláusula.']);
  });

  it('treats a blank line (paragraph break) as a boundary even without punctuation', () => {
    const a = new SentenceAssembler();
    expect(a.push('Resumo do parecer\n\nPrimeiro ponto.')).toEqual(['Resumo do parecer']);
    expect(a.flush()).toBe('Primeiro ponto.');
  });

  it('reset drops everything buffered (barge-in)', () => {
    const a = new SentenceAssembler();
    a.push('meio de uma frase sem fim');
    a.reset();
    expect(a.flush()).toBeNull();
  });
});

/* ----------------------------- SpeechChannel serialization ----------------------------- */

class FakePlayback implements PlaybackLike {
  calls: string[] = [];
  unlock(): void {
    this.calls.push('unlock');
  }
  beginTurn(): void {
    this.calls.push('beginTurn');
  }
  pushAudio(): void {
    this.calls.push('pushAudio');
  }
  endTurn(): void {
    this.calls.push('endTurn');
  }
  bargeIn(): void {
    this.calls.push('bargeIn');
  }
}

function makeChannel() {
  const says: string[] = [];
  const events: string[] = [];
  let clears = 0;
  const playback = new FakePlayback();
  const channel = new SpeechChannel(
    {
      say: (text: string) => {
        says.push(text);
        return Promise.resolve();
      },
      clear: () => {
        clears += 1;
      },
    },
    playback,
    () => 'pt-PT',
    {
      onAudible: () => events.push('audible'),
      onIdle: () => events.push('idle'),
      onError: (code) => events.push(code),
    },
  );
  return { channel, says, events, playback, clears: () => clears };
}

describe('SpeechChannel: one say at a time, drain before next', () => {
  it('holds the second sentence until audio_end AND local playback end', () => {
    const { channel, says, playback } = makeChannel();
    channel.enqueueText('Primeira frase. Segunda frase. Ainda a meio');
    expect(says).toEqual(['Primeira frase.']); // second is queued, not sent

    // Frames arrive and play; audio_end alone must NOT release the next say (local
    // playback still audible - clearing would clip it).
    channel.handleAudio(new Uint8Array(4));
    channel.handlePlaybackStart();
    channel.handleMessage({ type: 'audio_end', turnId: 't' });
    expect(says).toEqual(['Primeira frase.']);
    expect(playback.calls).toContain('endTurn');

    channel.handlePlaybackEnd(); // local drain -> next say goes out
    expect(says).toEqual(['Primeira frase.', 'Segunda frase.']);
  });

  it('completes a say that produced no audio (all-markdown text) on audio_end alone', () => {
    const { channel, says, events } = makeChannel();
    channel.enqueueText('Primeira. Segunda. Resto');
    expect(says).toEqual(['Primeira.']);
    channel.handleMessage({ type: 'audio_end', turnId: 't' }); // nothing ever played
    expect(says).toEqual(['Primeira.', 'Segunda.']);
    channel.handleMessage({ type: 'audio_end', turnId: 't2' });
    expect(events).toContain('idle'); // fully drained
  });

  it('flushText sends the unterminated tail and reports idle after it drains', () => {
    const { channel, says, events } = makeChannel();
    channel.enqueueText('Uma frase completa. E um resto');
    expect(says).toEqual(['Uma frase completa.']);
    channel.flushText(); // the reply settled: the tail becomes the last say
    channel.handleMessage({ type: 'audio_end', turnId: 't' });
    expect(says).toEqual(['Uma frase completa.', 'E um resto']);
    channel.handleMessage({ type: 'audio_end', turnId: 't2' });
    expect(events.filter((e) => e === 'idle')).toHaveLength(1);
    expect(channel.idle).toBe(true);
    channel.flushText(); // nothing buffered: still idle, no extra say
    expect(says).toHaveLength(2);
  });

  it('clear() drops the queue, clears the wire and flushes playback (barge-in)', () => {
    const { channel, says, playback, clears } = makeChannel();
    channel.enqueueText('Uma. Duas. Três. Quatro ainda a meio');
    expect(says).toEqual(['Uma.']);
    channel.handlePlaybackStart();
    channel.clear();
    expect(clears()).toBe(1); // wire clear for the in-flight say
    expect(playback.calls).toContain('bargeIn');
    // Nothing pending resumes after the barge-in.
    channel.handleMessage({ type: 'cleared' });
    channel.handlePlaybackEnd();
    expect(says).toEqual(['Uma.']);
    expect(channel.idle).toBe(true);
  });

  it('reports audible once playback starts and surfaces a wire error without stalling', () => {
    const { channel, says, events } = makeChannel();
    channel.enqueueText('Uma. Duas. Fim ainda a meio');
    channel.handlePlaybackStart();
    expect(events).toContain('audible');
    channel.handleMessage({ type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'x' });
    expect(events).toContain('VOICE_TTS_FAILED');
    expect(says).toEqual(['Uma.', 'Duas.']); // the queue advanced despite the error
  });
});
