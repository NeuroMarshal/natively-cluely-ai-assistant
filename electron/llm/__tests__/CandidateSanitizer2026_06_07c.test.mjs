// electron/llm/__tests__/CandidateSanitizer2026_06_07c.test.mjs
//
// Release 2026-06-07c — final candidate-answer sanitizer: strip assistant-meta /
// false-refusal tails from candidate-facing answers without damaging valid content;
// flag needsFallback when the answer was entirely meta.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { sanitizeCandidateAnswer, CANDIDATE_VOICE_ANSWER_TYPES } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const META = /\bas an AI\b|\bI(?:'m| am)\s+(?:an?\s+)?(?:AI|Natively)\b|\bcan(?:not| ?not|'?t)\s+share\b|\bdo(?:n'?t| not)\s+have\s+(?:access|your resume|your profile)\b|\bdo(?:n'?t| not)\s+(?:have|assign)\s+(?:numerical\s+)?ratings?\b/i;

describe('sanitizeCandidateAnswer — strips meta tail, keeps valid content', () => {
  const cases = [
    ['tail "as an AI assistant"', 'I have 3 years of Python experience building FastAPI backends. As an AI assistant, I cannot assign ratings.', /Python experience/],
    ['tail "I\'m Natively"', 'My strongest skill is backend engineering with Python and SQL. I am Natively, an AI assistant.', /backend engineering/],
    ['tail "I can\'t share"', 'I bring strong data analysis skills and system design experience. I can\'t share that information.', /data analysis/],
    ['tail "I can not share" (spaced)', 'I bring strong data analysis skills. I can not share that information.', /data analysis/],
    ['jd-fit + "no resume" tail', 'I am a strong fit because I built high-performance data pipelines. As an AI, I do not have your resume loaded.', /data pipelines/],
    ['rating refusal tail', 'You would rate Python a 9/10 from your FastAPI work. As an AI assistant, I do not assign ratings.', /9\/10/],
  ];
  for (const [name, input, keepRe] of cases) {
    test(name, () => {
      const r = sanitizeCandidateAnswer(input);
      assert.equal(r.repaired, true, 'should report a repair');
      assert.equal(r.needsFallback, false, 'valid content remained');
      assert.match(r.text, keepRe, 'valid content preserved');
      assert.doesNotMatch(r.text, META, `meta survived: ${r.text}`);
    });
  }
});

describe('sanitizeCandidateAnswer — does NOT damage legitimate content', () => {
  for (const clean of [
    'I would rate my Python an 8 out of 10, grounded in the FastAPI work I shipped.',
    'I am an AI Engineer with experience building ML pipelines and LLM applications.',
    'My best project is a low-latency data pipeline I built end to end.',
    "You're a strong fit: you have the SQL and dashboarding the role needs.",
    // code-review 2026-06-07c false-positive guards — these must be PRESERVED:
    'I cannot share the exact revenue figure but it grew 30% year over year.',
    'I do not have ratings yet for that framework, but I am learning it quickly.',
    'I provide the resume screening feature in my product, Natively.',
    'I am an AI researcher focusing on large language models.',
    'I am an AI scientist with a background in statistics.',
    'I am an AI lead at my current company.',
  ]) {
    test(`clean answer unchanged: "${clean.slice(0, 40)}…"`, () => {
      const r = sanitizeCandidateAnswer(clean);
      assert.equal(r.repaired, false, 'no repair on clean content');
      assert.equal(r.text.trim(), clean.trim());
    });
  }
});

describe('sanitizeCandidateAnswer — all-meta answer flags needsFallback', () => {
  for (const allMeta of [
    'I am Natively, an AI assistant. I cannot share that information.',
    'As an AI assistant, I do not assign numerical ratings.',
    "I'm an AI language model and I don't have access to your resume.",
  ]) {
    test(`"${allMeta.slice(0, 40)}…" → needsFallback`, () => {
      const r = sanitizeCandidateAnswer(allMeta);
      assert.equal(r.needsFallback, true);
    });
  }
  test('empty input → needsFallback', () => {
    assert.equal(sanitizeCandidateAnswer('').needsFallback, true);
  });
});

describe('CANDIDATE_VOICE_ANSWER_TYPES coverage', () => {
  for (const t of ['identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer', 'project_followup_answer', 'skills_answer', 'skill_experience_answer', 'jd_fit_answer', 'behavioral_interview_answer', 'negotiation_answer']) {
    test(`includes ${t}`, () => assert.ok(CANDIDATE_VOICE_ANSWER_TYPES.has(t)));
  }
  // coding/sales/lecture/meeting are NOT candidate-voice (they have their own forbidden-leak guard)
  for (const t of ['coding_question_answer', 'dsa_question_answer', 'sales_answer', 'lecture_answer', 'general_meeting_answer']) {
    test(`excludes ${t}`, () => assert.equal(CANDIDATE_VOICE_ANSWER_TYPES.has(t), false));
  }
});
