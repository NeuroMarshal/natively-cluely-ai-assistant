import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run `npm run build:electron` first — imports the compiled output.
import {
  filterHallucination as filt,
  collapseRepeats as collapse,
} from '../../../../dist-electron/electron/audio/whisper/hallucinationFilter.js';

test('collapses a single-word runaway loop to two occurrences', () => {
  assert.equal(collapse('да да да да да да да да'), 'да да');
});

test('collapses a repeated phrase loop', () => {
  assert.equal(
    collapse('спасибо за просмотр спасибо за просмотр спасибо за просмотр спасибо за просмотр'),
    'спасибо за просмотр спасибо за просмотр',
  );
});

test('preserves legitimate short doublings (<=2 reps)', () => {
  assert.equal(collapse('это очень очень важно для нас'), 'это очень очень важно для нас');
  assert.equal(collapse('no no I disagree with that'), 'no no I disagree with that');
});

test('leaves normal sentences untouched', () => {
  const s = 'Привет, как у тебя сегодня дела на работе';
  assert.equal(collapse(s), s);
});

test('filterHallucination de-loops then keeps real text', () => {
  assert.equal(
    filt('Я думаю что это это это это это это это правильно решение'),
    'Я думаю что это это правильно решение',
  );
});

test('filterHallucination still blocks known hallucinations and bracket tags', () => {
  assert.equal(filt('Thank you for watching'), '');
  assert.equal(filt('[BLANK_AUDIO]'), '');
  assert.equal(filt('[музыка]'), '');
  assert.equal(filt('you'), '');
});
