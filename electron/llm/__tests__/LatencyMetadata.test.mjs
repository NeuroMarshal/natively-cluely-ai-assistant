import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestTrace } from '../../../dist-electron/electron/utils/RequestTrace.js';

test('RequestTrace.mark records elapsed timings in memory', () => {
  const trace = new RequestTrace({ source: 'what_to_answer' });
  trace.mark('what_to_answer_clicked');
  trace.mark('intent_classified', { intent: 'coding' });

  const snap = trace.snapshot();
  assert.ok('what_to_answer_clicked' in snap);
  assert.ok('intent_classified' in snap);
  assert.ok(snap.intent_classified >= snap.what_to_answer_clicked, 'milestones are monotonic');
});

test('RequestTrace requestId is stable and unique-ish', () => {
  const a = new RequestTrace({ source: 'manual' });
  const b = new RequestTrace({ source: 'manual' });

  assert.ok(a.requestId.startsWith('req_'));
  assert.notEqual(a.requestId, b.requestId);
});

test('RequestTrace.markFirstUseful is idempotent and records only the first', () => {
  const trace = new RequestTrace({ source: 'what_to_answer' });

  assert.equal(trace.hasFirstUseful(), false);
  assert.equal(trace.markFirstUseful(), true, 'first call returns true');
  assert.equal(trace.markFirstUseful(), false, 'subsequent calls return false');
  assert.equal(trace.hasFirstUseful(), true);
  assert.ok('first_useful_token' in trace.snapshot());
});

test('RequestTrace keeps the first timing for a repeated milestone', () => {
  const trace = new RequestTrace({ source: 'manual' });

  trace.mark('first_stream_chunk');
  const first = trace.snapshot().first_stream_chunk;
  trace.mark('first_stream_chunk');

  assert.equal(trace.snapshot().first_stream_chunk, first, 'idempotent milestone keeps first value');
});

test('RequestTrace accepts all live-answer milestone names', () => {
  const trace = new RequestTrace({ source: 'what_to_answer', sessionId: 'sess-1' });
  const milestones = [
    'question_submitted', 'what_to_answer_clicked', 'transcript_window_loaded',
    'latest_question_extracted', 'intent_classified', 'answer_type_selected',
    'context_selected', 'context_build_started', 'context_build_completed',
    'prompt_built', 'provider_request_started', 'first_response_byte',
    'first_stream_chunk', 'first_visible_text', 'first_useful_token',
    'response_completed', 'validation_started', 'validation_completed',
    'validation_failed', 'repair_used', 'retry_used', 'degraded_context',
    'ui_render_completed', 'provider_timeout', 'fallback_answer_used',
    'code_verify_started', 'code_verify_skipped', 'tests_extracted',
    'code_executed', 'code_verify_passed', 'code_verify_failed',
    'code_correction_used', 'code_correction_error',
    'code_correction_reverified', 'code_verify_error',
  ];

  for (const milestone of milestones) {
    assert.doesNotThrow(() => trace.mark(milestone), `milestone ${milestone} should be markable`);
  }
  assert.equal(Object.keys(trace.snapshot()).length, milestones.length);
});
