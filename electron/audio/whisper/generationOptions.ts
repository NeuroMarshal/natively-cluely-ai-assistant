import { RECOGNITION_LANGUAGES } from '../../config/languages';

type WhisperTask = 'transcribe' | 'translate';

export interface WhisperGenerationOptions {
  task?: WhisperTask;
  language?: string;
  requestedLanguageKey: string;
  supported: boolean;
  reason: 'auto' | 'multilingual-explicit' | 'native-default' | 'unknown-model';
}

const ENGLISH_ONLY_MODELS = new Set([
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium.en',
]);

const MULTILINGUAL_MODELS = new Set([
  'Xenova/whisper-tiny',
  'Xenova/whisper-base',
  'Xenova/whisper-small',
  'Xenova/whisper-medium',
]);

const ISO_TO_WHISPER_LANGUAGE: Record<string, string> = {
  en: 'english',
  id: 'indonesian',
  ru: 'russian',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ja: 'japanese',
  ko: 'korean',
  zh: 'chinese',
  tr: 'turkish',
  uk: 'ukrainian',
};

const BCP47_TO_WHISPER_LANGUAGE: Record<string, string | null> = {
  auto: null,
  'en-US': 'english',
  'en-GB': 'english',
  'en-IN': 'english',
  'en-AU': 'english',
  'en-CA': 'english',
  'id-ID': 'indonesian',
  'ru-RU': 'russian',
  'es-ES': 'spanish',
  'fr-FR': 'french',
  'de-DE': 'german',
  'it-IT': 'italian',
  'pt-PT': 'portuguese',
  'pt-BR': 'portuguese',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
  'zh-CN': 'chinese',
  'zh-TW': 'chinese',
  'tr-TR': 'turkish',
  'uk-UA': 'ukrainian',
};

export function isEnglishOnlyWhisperModel(modelId: string): boolean {
  return ENGLISH_ONLY_MODELS.has(modelId);
}

export function isMultilingualWhisperModel(modelId: string): boolean {
  return MULTILINGUAL_MODELS.has(modelId);
}

function normalizeLanguageKey(languageKey: string | undefined | null): string {
  const key = (languageKey ?? '').trim();
  return key || 'auto';
}

export function resolveWhisperLanguage(languageKey: string | undefined | null): string | null {
  const key = normalizeLanguageKey(languageKey);
  if (key === 'auto') return null;

  const appLanguage = RECOGNITION_LANGUAGES[key];
  if (appLanguage) {
    return ISO_TO_WHISPER_LANGUAGE[appLanguage.iso639] ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(BCP47_TO_WHISPER_LANGUAGE, key)) {
    return BCP47_TO_WHISPER_LANGUAGE[key] ?? null;
  }

  const primaryIso = key.split('-')[0]?.toLowerCase();
  return ISO_TO_WHISPER_LANGUAGE[primaryIso] ?? null;
}

/**
 * User language is a preference, not a hard rule:
 * - auto: let the model/generation config decide.
 * - multilingual model + explicit supported language: pass task/language.
 * - single-language model: do not pass task/language; transformers.js rejects
 *   both for English-only configs, and the model's native language is the only
 *   safe fallback.
 */
export function resolveWhisperGenerationOptions(modelId: string, languageKey: string | undefined | null): WhisperGenerationOptions {
  const requestedLanguageKey = normalizeLanguageKey(languageKey);
  const language = resolveWhisperLanguage(requestedLanguageKey);

  if (requestedLanguageKey === 'auto') {
    return {
      requestedLanguageKey,
      supported: true,
      reason: 'auto',
    };
  }

  if (isMultilingualWhisperModel(modelId)) {
    if (!language) {
      return {
        requestedLanguageKey,
        supported: false,
        reason: 'multilingual-explicit',
      };
    }
    return {
      task: 'transcribe',
      language,
      requestedLanguageKey,
      supported: true,
      reason: 'multilingual-explicit',
    };
  }

  if (isEnglishOnlyWhisperModel(modelId)) {
    return {
      requestedLanguageKey,
      supported: language === 'english',
      reason: 'native-default',
    };
  }

  return {
    requestedLanguageKey,
    supported: false,
    reason: 'unknown-model',
  };
}
