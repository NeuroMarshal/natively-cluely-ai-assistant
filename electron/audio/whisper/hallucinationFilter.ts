/**
 * Filters common Whisper hallucinations and collapses runaway repetition.
 * Returns an empty string if the text is a known hallucination, otherwise the
 * cleaned (repetition-collapsed) trimmed text.
 */

const EXACT_BLOCKS = new Set([
  '[music]',
  '[applause]',
  '[inaudible]',
  '(music)',
  'thank you for watching',
  'thanks for watching',
  'you',
  'bye',
  '...',
  '.',
]);

// Matches any token that is entirely wrapped in square brackets e.g. [Noise], [BLANK_AUDIO]
const BRACKET_TOKEN_RE = /^\[.*\]$/;

/**
 * Collapse runaway repetition — Whisper/Moonshine occasionally enter a
 * generation loop and emit the same word or short phrase dozens of times
 * ("да да да да …", "спасибо за просмотр спасибо за просмотр …"). For every
 * window length k=1..6, a window that repeats 3+ times in a row is reduced to
 * two occurrences. Two repeats are kept so legitimate emphasis ("no no",
 * "ха ха") and short doublings survive; only genuine loops are trimmed.
 */
export function collapseRepeats(text: string): string {
  const trimmed = text.trim();
  let words = trimmed.split(/\s+/);
  if (words.length < 6) return trimmed;

  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  for (let k = 1; k <= 6; k++) {
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      // How many times does the window [i, i+k) repeat consecutively?
      let reps = 1;
      while (i + (reps + 1) * k <= words.length) {
        let same = true;
        for (let j = 0; j < k; j++) {
          if (!eq(words[i + j], words[i + reps * k + j])) { same = false; break; }
        }
        if (!same) break;
        reps++;
      }
      if (reps >= 3) {
        // Keep two occurrences of the window, drop the rest of the loop.
        for (let r = 0; r < 2; r++) for (let j = 0; j < k; j++) out.push(words[i + j]);
        i += reps * k;
      } else {
        out.push(words[i]);
        i++;
      }
    }
    words = out;
  }
  return words.join(' ');
}

export function filterHallucination(text: string): string {
  // Collapse loops BEFORE the block checks so a looped phrase is judged on its
  // de-duplicated form (and never reaches the UI as a wall of repeats).
  const trimmed = collapseRepeats(text);

  // Too short
  if (trimmed.length < 2) return '';

  const lower = trimmed.toLowerCase();

  // Exact match against known hallucinations
  if (EXACT_BLOCKS.has(lower)) return '';

  // Any token that is purely a bracketed tag
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';

  return trimmed;
}
