/**
 * Pure helpers for the overlay rolling transcript bar.
 *
 * Every STT backend we use (local Whisper/Moonshine, and the cloud coalescers)
 * emits each partial as the FULL text of the current in-progress segment, then
 * one final per utterance. Crucially these partials are NOT monotonic: a local
 * model re-decodes the whole growing audio window each tick, so an earlier word
 * can change between ticks ("я думаю что" → "я полагаю что это"). The previous
 * implementation only replaced the in-progress tail when the new partial was a
 * strict prefix of the prior one; a revised (non-prefix) partial was appended
 * with a separator instead, which duplicated the same utterance on screen — the
 * "repetitions of the same thing, regardless of model" bug.
 *
 * Model (single display string):
 *   "<committed-1>  ·  <committed-2>  ·  <in-progress>"
 *   - Committed segments are each followed by FINAL_SEPARATOR. A finalised
 *     segment therefore ALWAYS leaves a trailing separator, which marks it as
 *     locked: the next partial starts a fresh in-progress tail instead of
 *     overwriting it.
 *   - The in-progress tail is whatever follows the last separator (possibly "").
 *   - A PARTIAL always replaces the in-progress tail (it is the latest full
 *     preview of the current segment).
 *   - A FINAL replaces the in-progress tail with the authoritative text and
 *     appends a trailing separator to commit it.
 * Use displayRollingTranscript() to strip the trailing separator for rendering.
 *
 * Comparisons that need to ignore casing/punctuation (e.g. interim vs final
 * dedup) use norm(); the display strings themselves are never mutated.
 */

const FINAL_SEPARATOR = '  ·  ';

// The rolling bar is a live recent-context strip, not a full meeting log (the
// persisted transcript lives elsewhere). Cap it to a sliding window of the most
// recent committed segments so a long session — or a model that loops — can
// never grow it into an unbounded wall of text.
const MAX_ROLLING_CHARS = 600;

/** Drop whole leading committed segments until the string fits the window. */
function capRolling(s: string): string {
  let cur = s;
  while (cur.length > MAX_ROLLING_CHARS) {
    const idx = cur.indexOf(FINAL_SEPARATOR);
    if (idx < 0 || idx + FINAL_SEPARATOR.length >= cur.length) break; // one segment left — keep it
    cur = cur.substring(idx + FINAL_SEPARATOR.length);
  }
  return cur;
}

/** Normalise a string for overlap comparison only — never used for display. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[\p{Pd}]+/gu, ' ')   // dashes/hyphens → space (state-of-the-art → state of the art)
    .replace(/[\p{P}\p{S}]+/gu, '') // strip remaining punctuation and symbols (curly quotes, periods, etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index of the last finalized-segment separator, or -1 when none. */
export function lastFinalSeparatorIndex(prev: string): number {
  return prev.lastIndexOf(FINAL_SEPARATOR);
}

/** Prefix containing all committed (finalized) segments including trailing separator. */
export function committedRollingPrefix(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(0, idx + FINAL_SEPARATOR.length) : '';
}

/** In-progress (non-final) tail after the last separator. */
export function inProgressRollingTail(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(idx + FINAL_SEPARATOR.length) : prev;
}

/** The most recently committed segment's text (without separators), or '' . */
function lastCommittedSegment(prev: string): string {
  const committed = committedRollingPrefix(prev);
  if (!committed) return '';
  const body = committed.slice(0, -FINAL_SEPARATOR.length); // drop trailing separator
  const idx = body.lastIndexOf(FINAL_SEPARATOR);
  return idx >= 0 ? body.substring(idx + FINAL_SEPARATOR.length) : body;
}

/**
 * Apply a partial preview — REPLACES the in-progress tail with the latest full
 * preview of the current segment. Never appends (that caused mid-utterance
 * duplication when a partial revised an earlier word). Committed segments,
 * delimited by trailing separators, are left untouched.
 */
export function mergeRollingTranscriptPartial(prev: string, partialText: string): string {
  const text = partialText.trim();
  if (!text) return prev;
  return committedRollingPrefix(prev) + text;
}

/**
 * Commit a final segment — replace the current segment's in-progress preview
 * with the authoritative final text and append a trailing separator so the
 * next partial begins a new segment. Idempotent against a duplicate final
 * identical to the last committed segment (soft-commit tail overlap / repeated
 * flush) so the same sentence is never committed twice.
 */
export function mergeRollingTranscriptFinal(prev: string, finalText: string): string {
  const text = finalText.trim();
  if (!text) return prev;

  const committed = committedRollingPrefix(prev);

  const last = lastCommittedSegment(prev);
  if (last && norm(last) === norm(text)) {
    // Already committed this exact sentence — just drop the in-progress tail
    // (it was this segment's preview) without committing a duplicate.
    return committed;
  }

  return capRolling(committed + text + FINAL_SEPARATOR);
}

/** Strip the trailing commit separator so the bar never shows a dangling " · ". */
export function displayRollingTranscript(s: string): string {
  return s.endsWith(FINAL_SEPARATOR) ? s.slice(0, -FINAL_SEPARATOR.length) : s;
}
