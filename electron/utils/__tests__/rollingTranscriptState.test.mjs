import { test } from 'node:test';
import assert from 'node:assert/strict';

// Imports the COMPILED output (run `npm run build:electron` first), matching the
// repo's other electron unit tests. Exercises the real merge logic against the
// emit sequences local Whisper/Moonshine and cloud STT actually produce.
import {
  mergeRollingTranscriptPartial as P,
  mergeRollingTranscriptFinal as F,
  displayRollingTranscript as D,
} from '../../../dist-electron/electron/utils/rollingTranscriptState.js';

const SEP = '  ·  ';
const countSep = (s) => s.split(SEP).length - 1;

test('growing (monotonic) partials collapse to one segment', () => {
  let r = '';
  for (const p of ['я', 'я думаю', 'я думаю что это']) r = P(r, p);
  assert.equal(D(r), 'я думаю что это');
  assert.equal(countSep(r), 0);
});

test('a REVISED (non-prefix) partial replaces — never duplicates the utterance', () => {
  let r = '';
  for (const p of ['я думаю', 'я думаю что это', 'я полагаю что это важно']) r = P(r, p);
  // The whole thing is still ONE in-progress segment — no separator injected.
  assert.equal(countSep(r), 0);
  assert.equal(D(r), 'я полагаю что это важно');
});

test('final replaces the in-progress preview even when it diverges from partials', () => {
  let r = '';
  r = P(r, 'я думаю');
  r = P(r, 'я думаю что это');
  r = F(r, 'Я полагаю, что это важно.'); // authoritative, diverges from preview
  assert.equal(D(r), 'Я полагаю, что это важно.');
  assert.equal(countSep(D(r)), 0); // exactly one utterance, no repetition
});

test('two separate utterances → exactly two committed segments', () => {
  let r = '';
  r = P(r, 'привет');
  r = F(r, 'Привет!');
  r = P(r, 'как');
  r = P(r, 'как дела');
  r = F(r, 'Как дела?');
  assert.equal(D(r), `Привет!${SEP}Как дела?`);
  assert.equal(countSep(D(r)), 1);
});

test('a new segment never overwrites the previous final', () => {
  let r = '';
  r = F(r, 'Первое предложение.');
  r = P(r, 'второе');             // must NOT replace "Первое предложение."
  assert.ok(D(r).startsWith('Первое предложение.'));
  assert.equal(D(r), `Первое предложение.${SEP}второе`);
});

test('duplicate final (soft-commit tail / double flush) is idempotent', () => {
  let r = '';
  r = F(r, 'Одно и то же.');
  r = F(r, 'одно и то же')   // same sentence, different case/punct — must not double-commit
  assert.equal(countSep(D(r)), 0);
  assert.equal(D(r), 'Одно и то же.');
});

test('display never shows a dangling trailing separator', () => {
  let r = F('', 'Готово.');
  assert.ok(r.endsWith(SEP));      // state keeps the commit marker
  assert.equal(D(r), 'Готово.');   // display strips it
});

test('empty / whitespace partials and finals are ignored', () => {
  let r = P('', '  ');
  assert.equal(r, '');
  r = P('текст', '');
  assert.equal(r, 'текст');
});

test('rolling buffer is bounded (sliding window) over a long session', () => {
  let r = '';
  for (let i = 0; i < 200; i++) r = F(r, `Это предложение номер ${i} в очень длинной сессии.`);
  assert.ok(r.length <= 700, `expected bounded buffer, got ${r.length} chars`);
  // The most recent segment must survive the windowing.
  assert.ok(D(r).includes('номер 199'));
  assert.ok(!D(r).includes('номер 0 '));
});
