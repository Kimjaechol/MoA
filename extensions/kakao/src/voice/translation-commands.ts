/**
 * Translation & Interpretation Commands for KakaoTalk
 *
 * Handles user commands for:
 * - Text translation (/번역, /translate)
 * - Real-time interpretation (/통역, /interpret)
 * - Language settings
 */

import {
  translateText,
  parseLanguageCode,
  formatLanguageList,
  formatPopularPairs,
  SUPPORTED_LANGUAGES,
  type LanguageCode,
  type TranslationResult,
  type InterpreterConfig,
} from "./realtime-interpreter.js";

// ============================================
// Command Types
// ============================================

export type TranslationCommandType =
  | "translate"      // Text translation
  | "interpret"      // Start real-time interpretation
  | "interpret_stop" // Stop interpretation
  | "languages"      // List supported languages
  | "set_language"   // Set default language
  | "help";          // Help

export interface TranslationCommand {
  isCommand: boolean;
  type?: TranslationCommandType;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  text?: string;
  bidirectional?: boolean;
}

export interface TranslationCommandResult {
  success: boolean;
  message: string;
  audioBase64?: string;
  audioFormat?: string;
  quickReplies?: string[];
  sessionId?: string; // For interpretation sessions
}

// ============================================
// Command Parsing
// ============================================

// Language pair shortcuts (한영, 영한, 한일, etc.)
const LANGUAGE_PAIR_SHORTCUTS: Record<string, [LanguageCode, LanguageCode]> = {
  // Korean pairs
  "한영": ["ko", "en"], "영한": ["en", "ko"],
  "한일": ["ko", "ja"], "일한": ["ja", "ko"],
  "한중": ["ko", "zh"], "중한": ["zh", "ko"],
  "한불": ["ko", "fr"], "불한": ["fr", "ko"],
  "한독": ["ko", "de"], "독한": ["de", "ko"],
  "한서": ["ko", "es"], "서한": ["es", "ko"],
  "한러": ["ko", "ru"], "러한": ["ru", "ko"],
  "한아": ["ko", "ar"], "아한": ["ar", "ko"],
  "한태": ["ko", "th"], "태한": ["th", "ko"],
  "한베": ["ko", "vi"], "베한": ["vi", "ko"],
  // English pairs
  "영일": ["en", "ja"], "일영": ["ja", "en"],
  "영중": ["en", "zh"], "중영": ["zh", "en"],
  "영불": ["en", "fr"], "불영": ["fr", "en"],
  "영독": ["en", "de"], "독영": ["de", "en"],
  "영서": ["en", "es"], "서영": ["es", "en"],
  // Japanese pairs
  "일중": ["ja", "zh"], "중일": ["zh", "ja"],
};

/**
 * Check if message is a translation command
 */
export function isTranslationCommand(message: string): boolean {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Slash commands
  if (/^[/\/](번역|translate|통역|interpret|언어|languages?)/i.test(trimmed)) {
    return true;
  }

  // Translation verb patterns
  const translationVerbs = [
    // 번역 variations
    /번역/, /번역해/, /번역\s*해\s*줘/, /번역\s*해\s*주세요/, /번역\s*해\s*줄래/,
    /번역\s*좀/, /번역\s*부탁/, /번역\s*해\s*봐/, /번역\s*해\s*볼래/,
    /번역기/, /번역\s*기능/, /번역\s*서비스/,
    // 바꿔/옮겨 patterns
    /로\s*바꿔/, /로\s*옮겨/, /로\s*변환/,
    // Question patterns
    /로\s*뭐/, /어로\s*뭐/, /어로는\s*뭐/, /로\s*어떻게/,
    /어로\s*말해/, /어로\s*써/, /어로\s*적어/,
    // English
    /translate/i, /translation/i,
  ];

  for (const pattern of translationVerbs) {
    if (pattern.test(trimmed)) return true;
  }

  // Interpretation verb patterns
  const interpretVerbs = [
    // 통역 variations
    /통역/, /통역해/, /통역\s*해\s*줘/, /통역\s*해\s*주세요/,
    /통역\s*좀/, /통역\s*부탁/, /통역\s*시작/, /통역\s*켜/,
    /통역\s*모드/, /통역기/, /통역\s*기능/, /통역\s*서비스/,
    /통역사/, /통역\s*종료/, /통역\s*끝/, /통역\s*중지/, /통역\s*꺼/,
    // Real-time variations
    /실시간\s*통역/, /동시\s*통역/, /라이브\s*통역/, /live\s*통역/i,
    // English
    /interpret/i, /interpretation/i,
  ];

  for (const pattern of interpretVerbs) {
    if (pattern.test(trimmed)) return true;
  }

  // Language pair shortcuts (한영, 영한, etc.)
  for (const shortcut of Object.keys(LANGUAGE_PAIR_SHORTCUTS)) {
    if (trimmed.includes(shortcut)) return true;
  }

  // Language list patterns
  const langListPatterns = [
    /언어\s*목록/, /언어\s*리스트/, /지원\s*언어/, /사용.*언어/,
    /어떤\s*언어/, /무슨\s*언어/, /언어\s*종류/,
  ];

  for (const pattern of langListPatterns) {
    if (pattern.test(trimmed)) return true;
  }

  // 영작, 일작, etc. (writing in language)
  if (/^(영|일|중|불|독|서)작/.test(trimmed)) return true;

  return false;
}

/**
 * Parse translation command from message
 */
export function parseTranslationCommand(message: string): TranslationCommand {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // ============================================
  // Help Commands
  // ============================================
  const helpPatterns = [
    /^[/\/]?(번역|통역)\s*(도움말|도움|헬프|help|사용법|사용\s*방법|어떻게)/i,
    /^(번역|통역)\s*(어떻게|뭐야|뭐지|뭔가요)/i,
  ];
  for (const pattern of helpPatterns) {
    if (pattern.test(trimmed)) {
      return { isCommand: true, type: "help" };
    }
  }

  // ============================================
  // Language List Commands
  // ============================================
  const langListPatterns = [
    /^[/\/]?(언어|languages?|언어\s*목록|지원\s*언어|언어\s*리스트)$/i,
    /^(어떤|무슨|사용\s*가능한)\s*언어/i,
    /^언어\s*(종류|목록|리스트)/i,
    /^지원.*언어.*뭐/i,
  ];
  for (const pattern of langListPatterns) {
    if (pattern.test(trimmed)) {
      return { isCommand: true, type: "languages" };
    }
  }

  // ============================================
  // Stop Interpretation Commands
  // ============================================
  const stopPatterns = [
    /^[/\/]?(통역\s*(종료|끝|중지|멈춰|스탑|stop|그만|해제|끄기))/i,
    /^[/\/]?(통역\s*(꺼|꺼줘|꺼주세요))/i,
    /^(통역\s*(그만|멈춰|중단))/i,
    /^(interpret\s*stop|stop\s*interpret)/i,
  ];
  for (const pattern of stopPatterns) {
    if (pattern.test(trimmed)) {
      return { isCommand: true, type: "interpret_stop" };
    }
  }

  // ============================================
  // Language Pair Shortcuts for Interpretation
  // ============================================
  // "한영 통역", "영한통역 시작", "한일 통역해줘" etc.
  for (const [shortcut, [src, tgt]] of Object.entries(LANGUAGE_PAIR_SHORTCUTS)) {
    const pairInterpretPatterns = [
      new RegExp(`^[/\\/]?${shortcut}\\s*(통역|interpret)`, "i"),
      new RegExp(`^${shortcut}\\s*통역\\s*(해|해줘|해주세요|시작|켜)?`, "i"),
    ];
    for (const pattern of pairInterpretPatterns) {
      if (pattern.test(trimmed)) {
        return {
          isCommand: true,
          type: "interpret",
          sourceLanguage: src,
          targetLanguage: tgt,
          bidirectional: true,
        };
      }
    }
  }

  // ============================================
  // Real-time Interpretation Commands
  // ============================================

  // /통역 한국어 영어 or /통역 ko en [양방향]
  const interpretWithLangsMatch = trimmed.match(
    /^[/\/]?(통역|interpret|실시간\s*통역|동시\s*통역|라이브\s*통역)\s+(\S+)\s+(\S+)(?:\s+(양방향|bidirectional|bi|쌍방향))?$/i,
  );
  if (interpretWithLangsMatch) {
    const srcLang = parseLanguageCode(interpretWithLangsMatch[2]);
    const tgtLang = parseLanguageCode(interpretWithLangsMatch[3]);
    const bidirectional = !!interpretWithLangsMatch[4];

    return {
      isCommand: true,
      type: "interpret",
      sourceLanguage: srcLang ?? undefined,
      targetLanguage: tgtLang ?? undefined,
      bidirectional,
    };
  }

  // Various interpretation start patterns (default to Korean ↔ English)
  const simpleInterpretPatterns = [
    /^[/\/]?(통역|interpret)$/i,
    /^(통역\s*(해|해줘|해주세요|해줄래|시작|켜|켜줘|켜주세요))$/i,
    /^(통역\s*좀\s*(해|해줘|해주세요))$/i,
    /^(통역\s*부탁\s*(해|해요|드려요|합니다)?)$/i,
    /^(실시간|동시|라이브)\s*통역\s*(해|해줘|해주세요|시작)?$/i,
    /^통역\s*모드\s*(시작|켜|켜줘|on)?$/i,
    /^통역기\s*(켜|시작|실행)?$/i,
    /^통역\s*서비스\s*(시작|이용)?$/i,
    /^통역사\s*(모드)?$/i,
  ];
  for (const pattern of simpleInterpretPatterns) {
    if (pattern.test(trimmed)) {
      return {
        isCommand: true,
        type: "interpret",
        sourceLanguage: "ko",
        targetLanguage: "en",
        bidirectional: true,
      };
    }
  }

  // ============================================
  // Language Pair Shortcuts for Translation
  // ============================================
  // "한영 번역 안녕하세요", "영한번역: hello" etc.
  for (const [shortcut, [src, tgt]] of Object.entries(LANGUAGE_PAIR_SHORTCUTS)) {
    const pairTranslateMatch = trimmed.match(
      new RegExp(`^${shortcut}\\s*(번역)?[:\\s]*(.+)$`, "i"),
    );
    if (pairTranslateMatch && pairTranslateMatch[2]) {
      return {
        isCommand: true,
        type: "translate",
        sourceLanguage: src,
        targetLanguage: tgt,
        text: pairTranslateMatch[2].trim(),
      };
    }
  }

  // ============================================
  // Text Translation Commands
  // ============================================

  // /번역 영어 [text] or /번역 ko->en [text]
  const translateWithLangMatch = trimmed.match(
    /^[/\/]?(번역|translate)\s+(?:(\S+)\s*(?:->|→|에서|to|부터)\s*)?(\S+)\s+(.+)$/i,
  );
  if (translateWithLangMatch) {
    const srcInput = translateWithLangMatch[2];
    const tgtInput = translateWithLangMatch[3];
    const text = translateWithLangMatch[4];

    const srcLang = srcInput ? parseLanguageCode(srcInput) : undefined;
    const tgtLang = parseLanguageCode(tgtInput);

    if (tgtLang) {
      return {
        isCommand: true,
        type: "translate",
        sourceLanguage: srcLang ?? undefined,
        targetLanguage: tgtLang,
        text,
      };
    }
  }

  // 영작, 일작, etc. (영작 안녕하세요 = translate to English)
  const writingMatch = trimmed.match(/^(영|일|중|불|독|서)작\s*[:\s]*(.+)$/i);
  if (writingMatch) {
    const langMap: Record<string, LanguageCode> = {
      "영": "en", "일": "ja", "중": "zh", "불": "fr", "독": "de", "서": "es",
    };
    const tgtLang = langMap[writingMatch[1]];
    if (tgtLang) {
      return {
        isCommand: true,
        type: "translate",
        sourceLanguage: "ko",
        targetLanguage: tgtLang,
        text: writingMatch[2].trim(),
      };
    }
  }

  // Simple /번역 [text] (auto-detect)
  const simpleTranslateMatch = trimmed.match(/^[/\/]?(번역|translate)\s+(.+)$/i);
  if (simpleTranslateMatch) {
    const text = simpleTranslateMatch[2];
    const hasKorean = /[\uAC00-\uD7AF]/.test(text);

    return {
      isCommand: true,
      type: "translate",
      targetLanguage: hasKorean ? "en" : "ko",
      text,
    };
  }

  // "[language]로 번역해줘: [text]" variations
  const naturalTranslatePatterns = [
    // "영어로 번역해줘: text" / "영어로 번역해 주세요: text"
    /^(\S+?)(?:로|으로)\s*번역\s*(?:해|해줘|해주세요|해\s*줘|해\s*주세요|해줄래|부탁)[:\s]+(.+)$/i,
    // "영어로 바꿔줘: text"
    /^(\S+?)(?:로|으로)\s*(?:바꿔|바꿔줘|바꿔주세요|옮겨|옮겨줘|변환)[:\s]+(.+)$/i,
    // "영어로 말해줘: text"
    /^(\S+?)(?:로|으로)\s*(?:말해|말해줘|말해주세요)[:\s]+(.+)$/i,
    // "영어로 써줘: text"
    /^(\S+?)(?:로|으로)\s*(?:써|써줘|써주세요|적어|적어줘)[:\s]+(.+)$/i,
  ];
  for (const pattern of naturalTranslatePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const tgtLang = parseLanguageCode(match[1]);
      const text = match[2].trim();
      if (tgtLang && text) {
        return {
          isCommand: true,
          type: "translate",
          targetLanguage: tgtLang,
          text,
        };
      }
    }
  }

  // "[text]를 [language]로 번역" variations
  const reversePatterns = [
    // "안녕하세요를 영어로 번역해줘"
    /^(.+?)[를을이가]\s*(\S+?)(?:로|으로)\s*번역\s*(?:해|해줘|해주세요|해\s*줘)?$/i,
    // "안녕하세요를 영어로 바꿔줘"
    /^(.+?)[를을이가]\s*(\S+?)(?:로|으로)\s*(?:바꿔|바꿔줘|옮겨|변환)$/i,
    // "안녕하세요 영어로 번역"
    /^(.+?)\s+(\S+?)(?:로|으로)\s*번역$/i,
  ];
  for (const pattern of reversePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const text = match[1].trim();
      const tgtLang = parseLanguageCode(match[2]);
      if (tgtLang && text) {
        return {
          isCommand: true,
          type: "translate",
          targetLanguage: tgtLang,
          text,
        };
      }
    }
  }

  // "이거/이것 [language]로" patterns
  const thisPatterns = [
    // "이거 영어로 번역해줘"
    /^(?:이거|이것|이걸)\s*(\S+?)(?:로|으로)\s*(?:번역|바꿔|옮겨)?(?:해|해줘|해주세요)?$/i,
  ];
  for (const pattern of thisPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const tgtLang = parseLanguageCode(match[1]);
      if (tgtLang) {
        return {
          isCommand: true,
          type: "translate",
          targetLanguage: tgtLang,
          // Note: text would come from previous message context
          text: undefined,
        };
      }
    }
  }

  // Question patterns: "[language]로 뭐야?", "[language]로는 어떻게?"
  const questionPatterns = [
    // "영어로 뭐야?" / "영어로는 뭐야?"
    /^(.+?)\s*(\S+?)(?:로|으로)(?:는|은)?\s*(?:뭐야|뭐지|뭔가요|뭐라고|어떻게|어떻게\s*해|어떻게\s*말해)\??$/i,
  ];
  for (const pattern of questionPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const text = match[1].trim();
      const tgtLang = parseLanguageCode(match[2]);
      if (tgtLang && text && text.length > 0) {
        return {
          isCommand: true,
          type: "translate",
          targetLanguage: tgtLang,
          text,
        };
      }
    }
  }

  // "번역해줘 [text]" (verb first, text after)
  const verbFirstPatterns = [
    /^번역\s*(?:해|해줘|해주세요|해\s*줘|좀\s*해줘)[:\s]+(.+)$/i,
    /^(?:좀\s*)?번역\s*(?:해|해줘|부탁)[:\s]+(.+)$/i,
  ];
  for (const pattern of verbFirstPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const text = match[1].trim();
      const hasKorean = /[\uAC00-\uD7AF]/.test(text);
      return {
        isCommand: true,
        type: "translate",
        targetLanguage: hasKorean ? "en" : "ko",
        text,
      };
    }
  }

  return { isCommand: false };
}

// ============================================
// Command Handlers
// ============================================

/**
 * Handle translation command
 */
export async function handleTranslationCommand(
  cmd: TranslationCommand,
  userId: string,
  apiKey?: string,
): Promise<TranslationCommandResult> {
  switch (cmd.type) {
    case "translate":
      return handleTextTranslation(cmd, apiKey);

    case "interpret":
      return handleStartInterpretation(cmd, userId);

    case "interpret_stop":
      return handleStopInterpretation(userId);

    case "languages":
      return {
        success: true,
        message: formatLanguageList() + "\n" + formatPopularPairs(),
        quickReplies: ["번역 영어", "번역 일본어", "통역 한영"],
      };

    case "help":
      return {
        success: true,
        message: formatTranslationHelp(),
        quickReplies: ["번역 도움말", "언어목록", "통역 한영"],
      };

    default:
      return {
        success: false,
        message: "알 수 없는 명령입니다. '/번역 도움말'을 입력해주세요.",
      };
  }
}

/**
 * Handle text translation
 */
async function handleTextTranslation(
  cmd: TranslationCommand,
  apiKey?: string,
): Promise<TranslationCommandResult> {
  if (!cmd.text) {
    return {
      success: false,
      message: "번역할 텍스트를 입력해주세요.\n\n예시: /번역 영어 안녕하세요",
      quickReplies: ["번역 영어 안녕하세요", "번역 일본어 감사합니다"],
    };
  }

  if (!cmd.targetLanguage) {
    return {
      success: false,
      message: "대상 언어를 지정해주세요.\n\n예시: /번역 영어 [텍스트]",
      quickReplies: ["언어목록"],
    };
  }

  const result = await translateText(
    {
      text: cmd.text,
      sourceLanguage: cmd.sourceLanguage,
      targetLanguage: cmd.targetLanguage,
      formality: "neutral",
    },
    apiKey,
  );

  if (!result.success) {
    return {
      success: false,
      message: `번역 실패: ${result.error}`,
    };
  }

  const targetLang = SUPPORTED_LANGUAGES[cmd.targetLanguage];
  const sourceLang = cmd.sourceLanguage
    ? SUPPORTED_LANGUAGES[cmd.sourceLanguage]
    : null;

  let message = `${targetLang.flag} **${targetLang.nativeName} 번역**\n\n`;
  message += `${result.translatedText}`;

  if (sourceLang) {
    message += `\n\n---\n${sourceLang.flag} 원문: ${cmd.text}`;
  }

  return {
    success: true,
    message,
    quickReplies: [`번역 ${targetLang.code}`, "언어목록"],
  };
}

/**
 * Handle start interpretation
 */
function handleStartInterpretation(
  cmd: TranslationCommand,
  userId: string,
): TranslationCommandResult {
  if (!cmd.sourceLanguage || !cmd.targetLanguage) {
    return {
      success: false,
      message: `언어를 지정해주세요.

**사용법:**
\`/통역 한국어 영어\` - 한↔영 통역 시작
\`/통역 ko en bi\` - 양방향 통역

**지원 언어:**
한국어(ko), 영어(en), 일본어(ja), 중국어(zh), 스페인어(es), 프랑스어(fr) 등

'/언어목록'으로 전체 언어를 확인하세요.`,
      quickReplies: ["언어목록", "통역 한영", "통역 한일"],
    };
  }

  const srcLang = SUPPORTED_LANGUAGES[cmd.sourceLanguage];
  const tgtLang = SUPPORTED_LANGUAGES[cmd.targetLanguage];

  const modeText = cmd.bidirectional
    ? `${srcLang.flag} ${srcLang.nativeName} ↔ ${tgtLang.flag} ${tgtLang.nativeName} (양방향)`
    : `${srcLang.flag} ${srcLang.nativeName} → ${tgtLang.flag} ${tgtLang.nativeName}`;

  // Note: Actual session creation would be done by the voice handler
  // This returns instructions for starting the session
  return {
    success: true,
    message: `🎙️ **실시간 통역 준비**

${modeText}

**시작 방법:**
1. 음성 메시지를 보내주세요
2. AI가 실시간으로 통역합니다
3. '/통역 종료'로 종료

**특징:**
• 실시간 음성-음성 통역
• ~500ms 이하 지연
• 자연스러운 음성 출력

음성 메시지로 말씀해주세요! 🎤`,
    quickReplies: ["통역 종료", "언어목록"],
    sessionId: `pending-${userId}-${cmd.sourceLanguage}-${cmd.targetLanguage}`,
  };
}

/**
 * Handle stop interpretation
 */
function handleStopInterpretation(userId: string): TranslationCommandResult {
  // Note: Actual session termination would be done by the voice handler
  return {
    success: true,
    message: `✅ **통역 세션 종료**

통역 서비스를 종료했습니다.
다시 시작하려면 '/통역'을 입력하세요.`,
    quickReplies: ["통역 한영", "통역 한일", "번역 도움말"],
  };
}

/**
 * Format translation help
 */
function formatTranslationHelp(): string {
  return `📖 **번역/통역 도움말**

**텍스트 번역**
• \`/번역 영어 안녕하세요\` - 영어로 번역
• \`/번역 ko->en Hello\` - 한국어→영어
• \`영어로 번역해줘: 감사합니다\`
• \`이것을 일본어로 번역\`

**실시간 통역**
• \`/통역 한국어 영어\` - 한↔영 통역
• \`/통역 ko en bi\` - 양방향 통역
• \`/통역 종료\` - 통역 세션 종료

**언어 코드**
\`ko\` 한국어, \`en\` 영어, \`ja\` 일본어
\`zh\` 중국어, \`es\` 스페인어, \`fr\` 프랑스어

**실시간 통역 특징**
• Gemini 2.5 Flash Native Audio 사용
• 음성→음성 직접 통역 (STT/TTS 분리 없음)
• 초저지연 (~500ms)
• 24개 언어 지원

'/언어목록'으로 전체 언어를 확인하세요.`;
}

// ============================================
// Billing for Translation
// ============================================

export interface TranslationBillingResult {
  creditsUsed: number;
  breakdown: {
    textCredits: number;
    voiceCredits: number;
    multiplier: number;
  };
}

/** Credits per 1000 characters of text translation */
const TEXT_CREDITS_PER_1K_CHARS = 1;

/** Credits per minute of real-time interpretation */
const INTERPRET_CREDITS_PER_MINUTE = 30;

/** Multiplier for real-time interpretation (2x) */
const INTERPRET_MULTIPLIER = 2.0;

/**
 * Calculate credits for text translation
 */
export function calculateTranslationCredits(textLength: number): TranslationBillingResult {
  const textCredits = Math.ceil(textLength / 1000) * TEXT_CREDITS_PER_1K_CHARS;

  return {
    creditsUsed: textCredits,
    breakdown: {
      textCredits,
      voiceCredits: 0,
      multiplier: 1.0,
    },
  };
}

/**
 * Calculate credits for real-time interpretation
 */
export function calculateInterpretationCredits(durationMs: number): TranslationBillingResult {
  const minutes = Math.ceil(durationMs / 60000);
  const baseCredits = minutes * INTERPRET_CREDITS_PER_MINUTE;
  const totalCredits = Math.ceil(baseCredits * INTERPRET_MULTIPLIER);

  return {
    creditsUsed: totalCredits,
    breakdown: {
      textCredits: 0,
      voiceCredits: baseCredits,
      multiplier: INTERPRET_MULTIPLIER,
    },
  };
}

/**
 * Format billing info for display
 */
export function formatTranslationBillingInfo(result: TranslationBillingResult): string {
  if (result.breakdown.voiceCredits > 0) {
    return `💳 실시간 통역: ${result.creditsUsed} 크레딧 (${result.breakdown.multiplier}x 배율)`;
  }
  return `💳 텍스트 번역: ${result.creditsUsed} 크레딧`;
}
