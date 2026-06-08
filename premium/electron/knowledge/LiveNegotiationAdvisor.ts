// premium/electron/knowledge/LiveNegotiationAdvisor.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Real-time negotiation coaching. Given the live negotiation state and the most
// recent interviewer turn, it produces a short tactical note + an exact, speak-
// aloud script using the injected low-latency LLM function. The result is pushed
// to the renderer's NegotiationCoachingCard.

import { NegotiationPhase } from './types';
import type { NegotiationState, LiveCoachingResponse } from './types';

export type GenerateContentFn = (
  contents: Array<{ text: string }> | string,
) => Promise<string>;

function tryParseJSON<T>(text: string): T | null {
  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text) as T;
  } catch {
    return null;
  }
}

export class LiveNegotiationAdvisor {
  constructor(private generateFn: GenerateContentFn | null = null) {}

  setLiveCoachingContentFn(fn: GenerateContentFn): void {
    this.generateFn = fn;
  }

  async advise(
    state: NegotiationState,
    lastInterviewerTurn: string | undefined,
    context?: { targetRange?: { low: number | null; high: number | null }; currency?: string },
  ): Promise<LiveCoachingResponse | null> {
    if (!this.generateFn) return null;

    const currency = state.currency ?? context?.currency ?? '$';
    const theirOffer = state.theirOffer ?? null;
    const yourTarget = state.yourTarget ?? context?.targetRange?.high ?? null;

    const systemPrefix =
      'You are a live salary-negotiation coach speaking into the candidate\'s ear. ' +
      'Respond FAST with STRICT JSON: {"tacticalNote": string (<=160 chars, what to do ' +
      'and why), "exactScript": string (the exact words to say, first person, <=240 chars)}. ' +
      'Be calm, confident, never lowball the candidate.';

    const prompt = [
      `Negotiation phase: ${state.phase}`,
      theirOffer != null ? `Their offer: ${currency}${theirOffer.toLocaleString()}` : 'No explicit offer yet.',
      yourTarget != null ? `Candidate target: ${currency}${yourTarget.toLocaleString()}` : '',
      lastInterviewerTurn ? `Interviewer just said: "${lastInterviewerTurn}"` : '',
      'Give the next move.',
    ].filter(Boolean).join('\n');

    let raw = '';
    try {
      raw = await this.generateFn([{ text: systemPrefix }, { text: prompt }]);
    } catch {
      return null;
    }

    const parsed = tryParseJSON<{ tacticalNote?: string; exactScript?: string }>(raw);
    const tacticalNote = parsed?.tacticalNote ?? raw.split('\n')[0]?.slice(0, 200) ?? '';
    const exactScript = parsed?.exactScript ?? '';
    if (!tacticalNote && !exactScript) return null;

    return {
      tacticalNote,
      exactScript,
      phase: state.phase ?? NegotiationPhase.DISCOVERY,
      theirOffer,
      yourTarget,
      currency,
      showSilenceTimer: state.phase === NegotiationPhase.COUNTERING,
    };
  }
}
