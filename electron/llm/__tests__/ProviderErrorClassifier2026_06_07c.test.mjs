// electron/llm/__tests__/ProviderErrorClassifier2026_06_07c.test.mjs
//
// Release 2026-06-07c — deterministic provider-error classification: separate
// environment/outage conditions (excluded from logic-defect scoring) from real
// answers, and decide retryability.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { classifyProviderError, isClarificationStall } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

describe('classifyProviderError — error objects', () => {
  const cases = [
    ['429 status', { status: 429 }, undefined, 'rate_limit', true, true],
    ['RESOURCE_EXHAUSTED', new Error('RESOURCE_EXHAUSTED: quota metric'), undefined, 'rate_limit', true, true],
    ['too many requests', new Error('429 Too Many Requests'), undefined, 'rate_limit', true, true],
    ['403 forbidden', { status: 403 }, undefined, 'auth', true, false],
    ['401 unauthorized', { status: 401 }, undefined, 'auth', true, false],
    ['expired API key', new Error('API key expired or invalid'), undefined, 'auth', true, false],
    ['503 overloaded', { status: 503 }, undefined, 'overloaded', true, true],
    ['529 overloaded', new Error('model is overloaded'), undefined, 'overloaded', true, true],
    ['timeout/abort', new Error('first-useful deadline exceeded; aborted'), undefined, 'timeout', true, true],
    ['network ENOTFOUND', new Error('getaddrinfo ENOTFOUND generativelanguage'), undefined, 'network', true, true],
    ['500 server', { status: 500 }, undefined, 'server_error', true, true],
  ];
  for (const [name, err, text, kind, outage, retry] of cases) {
    test(`${name} → ${kind} (outage=${outage}, retry=${retry})`, () => {
      const r = classifyProviderError(err, text);
      assert.equal(r.kind, kind, `kind: got ${r.kind}`);
      assert.equal(r.isOutage, outage, 'isOutage');
      assert.equal(r.retryable, retry, 'retryable');
    });
  }
});

describe('classifyProviderError — produced text (no error object)', () => {
  test('empty text → zero_token outage', () => {
    const r = classifyProviderError(null, '');
    assert.equal(r.kind, 'zero_token');
    assert.equal(r.isOutage, true);
  });
  test('clarification stall → stall outage', () => {
    const r = classifyProviderError(null, 'Could you repeat that? I want to make sure I address your question properly.');
    assert.equal(r.kind, 'stall');
    assert.equal(r.isOutage, true);
  });
  test('real answer → none (NOT an outage)', () => {
    const r = classifyProviderError(null, 'I have 3 years of Python experience building FastAPI backends.');
    assert.equal(r.kind, 'none');
    assert.equal(r.isOutage, false);
    assert.equal(r.retryable, false);
  });
});

describe('isClarificationStall', () => {
  for (const s of ['Could you repeat that?', 'Sorry, could you repeat the question?', "I'm sorry, I didn't catch that.", 'Please clarify what you mean.']) {
    test(`"${s.slice(0, 30)}…" is a stall`, () => assert.equal(isClarificationStall(s), true));
  }
  for (const s of ['I have 3 years of Python experience.', 'My best project is Natively.', 'You would rate Python an 8/10.', '']) {
    test(`"${s.slice(0, 30)}…" is NOT a stall`, () => assert.equal(isClarificationStall(s), false));
  }
  test('a long answer that happens to contain "repeat" is not a stall', () => {
    assert.equal(isClarificationStall('I built a retry system that can repeat failed requests with exponential backoff, which I used in production for over a year on a high-traffic service.'), false);
  });
});

describe('outage classification gates benchmark scoring correctly', () => {
  test('all outage kinds report isOutage=true so they are excluded from logic-defect scoring', () => {
    const outageKinds = [
      classifyProviderError({ status: 429 }),
      classifyProviderError({ status: 503 }),
      classifyProviderError(new Error('timeout')),
      classifyProviderError(null, ''),
      classifyProviderError(null, 'Could you repeat that?'),
    ];
    for (const r of outageKinds) assert.equal(r.isOutage, true);
  });
  test('a genuine answer is NOT an outage (so it IS scored)', () => {
    assert.equal(classifyProviderError(null, 'My name is on my resume and I lead backend work.').isOutage, false);
  });
});
