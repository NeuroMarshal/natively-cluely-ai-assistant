// electron/llm/index.ts
// Central export for all LLM modules

export { AnswerLLM } from "./AnswerLLM";
export { AssistLLM } from "./AssistLLM";
export { BrainstormLLM } from "./BrainstormLLM";
export { ClarifyLLM } from "./ClarifyLLM";
export { CodeHintLLM } from "./CodeHintLLM";
export { FollowUpLLM } from "./FollowUpLLM";
export { FollowUpQuestionsLLM } from "./FollowUpQuestionsLLM";
export { RecapLLM } from "./RecapLLM";
export { WhatToAnswerLLM } from "./WhatToAnswerLLM";
export { shouldThrottleTrigger } from "./triggerGate";
export type { TriggerGateInput } from "./triggerGate";
export { clampResponse, validateResponse, reduceDashes, reduceDashesInChunk, StreamingDashReducer } from "./postProcessor";
export {
    cleanTranscript,
    sparsifyTranscript,
    formatTranscriptForLLM,
    prepareTranscriptForWhatToAnswer
} from "./transcriptCleaner";
export type { TranscriptTurn } from "./transcriptCleaner";
export { extractLatestQuestion, toCandidateFraming } from "./transcriptQuestionExtractor";
export type { ExtractedQuestion, ExtractedQuestionType, DetectedSpeaker } from "./transcriptQuestionExtractor";
export {
    buildTemporalContext,
    formatTemporalContextForPrompt
} from "./TemporalContextBuilder";
export type { TemporalContext, AssistantResponse } from "./TemporalContextBuilder";
export {
    classifyIntent,
    getAnswerShapeGuidance,
    warmupIntentClassifier
} from "./IntentClassifier";
export type { ConversationIntent, IntentResult } from "./IntentClassifier";
export { planNextAssistantAction } from "./PlannerDecision";
export type { PlannerDecision, PlannerDecisionKind, PlannerInput } from "./PlannerDecision";
export { planAnswer, formatAnswerPlanForPrompt, isCodingAnswerType, shouldScaffold, isStealthEvasionQuestion } from "./AnswerPlanner";
export type { AnswerPlan, AnswerSource, AnswerType, ContextLayer, OutputPerspective, SpeakerPerspective } from "./AnswerPlanner";
export { resolveFollowUp, resolveFollowUpOrClarify, isBareFollowUp, buildContextFreeClarification } from "./FollowUpResolver";
export { classifyProviderError, isClarificationStall } from "./providerErrorClassifier";
export type { ProviderErrorKind, ProviderErrorClassification } from "./providerErrorClassifier";
export { SessionMemory, isKindAllowedInMode } from "./SessionMemory";
export type { MemoryMode, MemoryItemKind, MemoryItem, MemoryQuery, MemoryRecall } from "./SessionMemory";
export { resolveSessionFollowup } from "./sessionFollowupResolver";
export type { SessionFollowupInput, SessionFollowupResult } from "./sessionFollowupResolver";
export {
  raceStreamWithDeadline, firstUsefulDeadlineMs,
  LIVE_FIRST_USEFUL_BUDGET_MS, LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS,
  LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS, LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_INTER_TOKEN_STALL_MS, BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS,
} from "./liveDeadlines";
export type { FollowUpContext, ResolvedFollowUp, FollowUpSurface } from "./FollowUpResolver";
export { renderCodingAnswerMarkdown, repairCodingAnswer, repairCodingMarkdown, validateAnswerStructure, validateCodingMarkdown, buildCodingScaffold } from "./AnswerValidator";
export type { AnswerValidationResult, CodingAnswer } from "./AnswerValidator";
export { validateProfileOutput, buildProfileRepairInstruction, stripProfileTokensFromCoding, sanitizeCandidateAnswer, CANDIDATE_VOICE_ANSWER_TYPES } from "./ProfileOutputValidator";
export type { ProfileValidationResult, ProfileViolation, ProfileViolationCode, ProfileValidationInput, CandidateSanitizeResult } from "./ProfileOutputValidator";
export { validateProfileEvidence } from "./profileEvidenceValidator";
export type { EvidenceValidationResult, EvidenceViolation, EvidenceViolationCode, EvidenceValidationInput } from "./profileEvidenceValidator";
export { decideProfileIntelligence } from "./ProfileIntelligenceRouter";
export type { ProfileIntelligenceDecision, ProfileContextType, AnswerPerspective, DecideProfileInput } from "./ProfileIntelligenceRouter";
export { CODING_CONTRACT, CODING_CONTRACT_TINY, CODING_SECTIONS, CODING_SECTION_HEADINGS, CODING_VERIFICATION_INSTRUCTION, VERIFICATION_SPEC_RE, stripVerificationSpec, StreamingSpecStripper } from "./codingContract";
export { verifyCodingAnswer } from "./codeVerification/verifyCodingAnswer";
export type { VerifyCodingOptions, CorrectionFn } from "./codeVerification/verifyCodingAnswer";
export type { Verdict, VerificationOutcome, VerifyLanguage, TestCase, RunResult, VerificationSpec } from "./codeVerification/types";
export { extractVerificationSpec, parseProblemExamples, extractCodeBlock } from "./codeVerification/extractTests";
export { buildContextRoute, isLayerAllowed, summarizeContextRoute } from "./contextRoute";
export type { ContextRoute, ContextRouteLayer } from "./contextRoute";
export {
    classifyCustomContext,
    splitCustomContextChunks,
    selectCustomContextForAnswer,
    buildScopedCustomContext,
    summarizeCustomContextSelection,
} from "./customContextClassifier";
export type { CustomContextCategory, CustomContextChunk, ClassifiedCustomContext, CustomContextSelection } from "./customContextClassifier";
export { routeLLMProviders } from "./ProviderRouter";
export type { LLMProviderId, ProviderAttempt, ProviderAttemptStatus, ProviderAvailabilityState, ProviderCapability, ProviderModelState, ProviderRouteOptions, ProviderUnavailableReason } from "./ProviderRouter";
export { MODE_CONFIGS } from "./types";
export type { GenerationConfig, GeminiContent, LLMClient } from "./types";
export {
    HARD_SYSTEM_PROMPT,
    ANSWER_MODE_PROMPT,
    ASSIST_MODE_PROMPT,
    FOLLOWUP_MODE_PROMPT,
    WHAT_TO_ANSWER_PROMPT,
    GROQ_TITLE_PROMPT,
    GROQ_SUMMARY_JSON_PROMPT,
    FOLLOWUP_EMAIL_PROMPT,
    GROQ_FOLLOWUP_EMAIL_PROMPT,
    CODE_HINT_PROMPT,
    buildCodeHintMessage,
    BRAINSTORM_MODE_PROMPT
} from "./prompts";
export {
    TINY_CORE,
    TINY_SYSTEM_PROMPT,
    TINY_ANSWER_PROMPT,
    TINY_WHAT_TO_ANSWER_PROMPT,
    TINY_ASSIST_PROMPT,
    TINY_RECAP_PROMPT,
    TINY_FOLLOWUP_PROMPT,
    TINY_FOLLOW_UP_QUESTIONS_PROMPT,
    TINY_BRAINSTORM_PROMPT,
    TINY_CLARIFY_PROMPT,
    TINY_CODE_HINT_PROMPT,
    TINY_TITLE_PROMPT,
    TINY_SUMMARY_JSON_PROMPT,
    TINY_FOLLOWUP_EMAIL_PROMPT,
    TINY_MODE_GENERAL_PROMPT,
    TINY_MODE_LOOKING_FOR_WORK_PROMPT,
    TINY_MODE_SALES_PROMPT,
    TINY_MODE_RECRUITING_PROMPT,
    TINY_MODE_TEAM_MEET_PROMPT,
    TINY_MODE_LECTURE_PROMPT,
    TINY_MODE_TECHNICAL_INTERVIEW_PROMPT,
    TINY_PROMPTS_SET
} from "./tinyPrompts";
export {
    getModelCapabilities,
    selectPromptTier,
    estimateTokens,
    truncateTranscriptToFit,
    parseOllamaSize,
    getOpenAiMaxOutput
} from "./modelCapabilities";
export type { ModelCapabilities, ModelTier, PromptTier } from "./modelCapabilities";
