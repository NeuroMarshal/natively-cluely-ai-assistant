// premium/electron/knowledge/NegotiationConversationTracker.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Tracks a live salary/compensation negotiation across transcript turns and
// exposes a cheap synchronous comp-evidence detector used by the transcript-aware
// intent router.

import {
  NegotiationPhase,
} from './types';
import type { NegotiationState, OfferEvent, OfferState } from './types';

// Exact comp keywords (the sync keyword scorer's vocabulary). A bare "base" is
// excluded so "database"/"codebase" don't false-fire; a bare "comp" is excluded
// so "comp sci"/"comparison" don't false-fire (only "total comp" / "compensation").
const COMP_KEYWORDS =
  /\b(salary|salaries|compensation|ctc|remuneration|wage|wages|stipend|equity|rsus?|stock\s+options?|signing\s+bonus|bonus|base\s+pay|base\s+salary|total\s+comp|pay\s+package|paycheck|budget)\b/i;

// Money magnitudes typical of an offer: "150k", "120-140k", "$130,000", or a
// bare 5–6 digit figure.
const COMP_AMOUNT =
  /(\$\s?\d[\d,]*|\b\d{2,3}\s*-\s*\d{2,3}\s*k\b|\b\d{2,3}\s*k\b|\b\d{5,6}\b)/i;

/**
 * Cheap synchronous detector: does this utterance carry compensation evidence
 * (a comp keyword OR a money amount)? Used to scan the last interviewer turns.
 */
export function textHasCompEvidence(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return COMP_KEYWORDS.test(t) || COMP_AMOUNT.test(t);
}

/** Pull the first money amount (normalized to a number) out of a string. */
function extractAmount(text: string): { value: number | null; currency: string } {
  const t = text.toLowerCase();
  const kMatch = t.match(/(\d{2,3})\s*k\b/);
  if (kMatch) return { value: parseInt(kMatch[1], 10) * 1000, currency: '$' };
  const dollarMatch = t.match(/\$\s?([\d,]{4,})/);
  if (dollarMatch) return { value: parseInt(dollarMatch[1].replace(/,/g, ''), 10), currency: '$' };
  const bareMatch = t.match(/\b(\d{5,6})\b/);
  if (bareMatch) return { value: parseInt(bareMatch[1], 10), currency: '$' };
  return { value: null, currency: '$' };
}

export class NegotiationConversationTracker {
  private events: OfferEvent[] = [];
  private offer: OfferState = { currency: '$' };
  private phase: NegotiationPhase = NegotiationPhase.IDLE;
  private active = false;

  /** Feed a transcript turn; updates phase/offer state when comp is detected. */
  feed(text: string, speaker: 'interviewer' | 'candidate' = 'interviewer'): void {
    if (!textHasCompEvidence(text)) return;
    this.active = true;
    const { value, currency } = extractAmount(text);
    const event: OfferEvent = {
      kind: value != null ? 'offer' : 'comp_mention',
      text,
      value,
      currency,
      timestamp: Date.now(),
      speaker,
    };
    this.events.push(event);

    if (value != null) {
      if (speaker === 'interviewer') {
        this.offer.base = value;
        this.offer.total = value;
        this.phase = NegotiationPhase.COUNTERING;
      } else {
        this.phase = NegotiationPhase.ANCHORING;
      }
    } else if (this.phase === NegotiationPhase.IDLE) {
      this.phase = NegotiationPhase.DISCOVERY;
    }
  }

  getState(): NegotiationState {
    const interviewerOffer = [...this.events].reverse().find(
      (e) => e.speaker === 'interviewer' && e.value != null,
    );
    const candidateTarget = [...this.events].reverse().find(
      (e) => e.speaker === 'candidate' && e.value != null,
    );
    return {
      phase: this.phase,
      offer: this.offer,
      events: this.events,
      isActive: this.active,
      theirOffer: interviewerOffer?.value ?? this.offer.base ?? null,
      yourTarget: candidateTarget?.value ?? null,
      currency: this.offer.currency ?? '$',
    };
  }

  isActive(): boolean {
    return this.active;
  }

  reset(): void {
    this.events = [];
    this.offer = { currency: '$' };
    this.phase = NegotiationPhase.IDLE;
    this.active = false;
  }
}
