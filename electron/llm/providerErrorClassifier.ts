// electron/llm/providerErrorClassifier.ts
//
// Pure, deterministic classification of provider failures (release 2026-06-07c).
// One place to decide: is this a quota/rate-limit, an overload, an auth failure, a
// timeout, a zero-token empty, or a content-free clarification stall? The product
// uses it to decide whether to fall back deterministically vs surface an error; the
// benchmark uses it to SEPARATE provider-outage rows (excluded from the pass
// denominator) from genuine logic defects.
//
// No I/O, no LLM. Inspects an error object and/or the produced text.

export type ProviderErrorKind =
  | 'rate_limit'        // 429 / RESOURCE_EXHAUSTED / "rate limit"
  | 'auth'              // 401 / 403 / API_KEY / permission
  | 'overloaded'        // 503 / 529 / "overloaded"
  | 'server_error'      // 500 / other 5xx
  | 'timeout'           // deadline / ETIMEDOUT / first-useful timeout / abort
  | 'network'           // ENOTFOUND / ECONNRESET / DNS
  | 'zero_token'        // stream produced no text
  | 'stall'             // produced only a content-free clarification ("could you repeat that?")
  | 'none';             // not a provider failure

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  /** True when this is an ENVIRONMENT condition (exclude from logic-defect scoring). */
  isOutage: boolean;
  /** True when the product MAY safely retry/hedge/fallback. */
  retryable: boolean;
  /** Short code for telemetry (no raw content). */
  code: string;
}

// A content-free clarification stall the model emits when it's confused/degraded.
// MUST stay in sync with IntelligenceEngine's "Could you repeat that?" fallback and
// the benchmark's stall quarantine.
const STALL_RE = /^(?:\s*)(?:could you (?:please )?repeat|can you repeat|i(?:'m| am)? (?:sorry,? )?(?:i )?(?:didn'?t|did not) (?:catch|hear|get)|sorry,? (?:could|can) you|i want to make sure i (?:address|understand)|please (?:repeat|clarify|rephrase)|what (?:was|did) (?:the|you))/i;

/** Is `text` a content-free clarification stall (not a real answer)? */
export function isClarificationStall(text: string | null | undefined): boolean {
  const s = (text || '').trim();
  return s.length > 0 && s.length < 200 && STALL_RE.test(s);
}

function statusOf(err: any): number {
  if (!err) return 0;
  return Number(err.status ?? err.statusCode ?? err.code) || 0;
}

/**
 * Classify a provider failure from an error object and/or the produced text.
 * Pass `text` (possibly empty) so a successful HTTP call that returned no tokens or
 * a stall is still classified as an outage rather than a logic pass.
 */
export function classifyProviderError(err: any, text?: string): ProviderErrorClassification {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);

  // 1. Hard error object present → classify by status/message first.
  if (err) {
    if (status === 429 || /\b429\b|rate.?limit|resource_exhausted|quota|too many requests/.test(msg)) {
      return { kind: 'rate_limit', isOutage: true, retryable: true, code: 'rate_limit' };
    }
    if (status === 401 || status === 403 || /\b401\b|\b403\b|api[_ ]?key|permission|unauthor|forbidden|invalid.*key|expired.*key/.test(msg)) {
      return { kind: 'auth', isOutage: true, retryable: false, code: 'auth' };
    }
    if (status === 503 || status === 529 || /\b503\b|\b529\b|overloaded|unavailable|capacity/.test(msg)) {
      return { kind: 'overloaded', isOutage: true, retryable: true, code: 'overloaded' };
    }
    if (/etimedout|deadline|timeout|timed out|aborted|abort|first.?useful.*deadline/.test(msg)) {
      return { kind: 'timeout', isOutage: true, retryable: true, code: 'timeout' };
    }
    if (/enotfound|econnreset|econnrefused|network|dns|getaddrinfo|socket hang/.test(msg)) {
      return { kind: 'network', isOutage: true, retryable: true, code: 'network' };
    }
    if (status >= 500 || /\b5\d\d\b|internal error|server error/.test(msg)) {
      return { kind: 'server_error', isOutage: true, retryable: true, code: 'server_error' };
    }
    // An unrecognized thrown error is still a failure — treat as a retryable outage
    // conservatively (it produced no usable answer), so it never scores as a defect.
    return { kind: 'server_error', isOutage: true, retryable: true, code: 'unknown_error' };
  }

  // 2. No error object — inspect the produced text.
  const t = (text ?? '').trim();
  if (!t) return { kind: 'zero_token', isOutage: true, retryable: true, code: 'zero_token' };
  if (isClarificationStall(t)) return { kind: 'stall', isOutage: true, retryable: true, code: 'stall' };

  return { kind: 'none', isOutage: false, retryable: false, code: 'ok' };
}
