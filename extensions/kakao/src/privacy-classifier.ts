/**
 * Privacy Classifier - 프라이버시/민감 정보 분류기
 *
 * 사용자 메시지에서 민감한 정보를 감지하여
 * 로컬 SLM 처리가 필요한지 판단합니다.
 *
 * 민감 정보 유형:
 * - 개인식별정보 (PII): 주민번호, 여권번호 등
 * - 금융정보: 계좌번호, 카드번호, 거래내역
 * - 의료정보: 진단서, 처방전, 건강기록
 * - 인증정보: 비밀번호, API 키, 토큰
 * - 개인 파일: 일기, 메모, 사진 경로
 */

// ============================================
// Types
// ============================================

export type SensitiveDataType =
  | "pii_ssn" // 주민등록번호
  | "pii_passport" // 여권번호
  | "pii_driver" // 운전면허번호
  | "pii_phone" // 전화번호 (다량)
  | "financial_account" // 계좌번호
  | "financial_card" // 카드번호
  | "financial_transaction" // 거래내역
  | "medical_diagnosis" // 진단서/진단내용
  | "medical_prescription" // 처방전
  | "medical_record" // 건강기록
  | "auth_password" // 비밀번호
  | "auth_apikey" // API 키
  | "auth_token" // 토큰/시크릿
  | "personal_diary" // 일기/개인 메모
  | "personal_photo" // 사진 경로
  | "personal_location" // 실시간 위치
  | "business_confidential"; // 영업비밀

export type PrivacyLevel = "public" | "private" | "sensitive" | "critical";

export interface PrivacyResult {
  level: PrivacyLevel;
  isPrivate: boolean;
  sensitiveTypes: SensitiveDataType[];
  detectedPatterns: Array<{
    type: SensitiveDataType;
    matchedText: string;
    masked: string;
  }>;
  shouldUseLocalSLM: boolean;
  reason?: string;
  reasonEn?: string;
  warningMessage?: string;
}

// ============================================
// Sensitive Patterns
// ============================================

interface SensitivePattern {
  type: SensitiveDataType;
  patterns: RegExp[];
  level: PrivacyLevel;
  maskFn?: (match: string) => string;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // === 개인식별정보 (PII) ===
  {
    type: "pii_ssn",
    patterns: [
      /\d{6}[-\s]?\d{7}/, // 주민등록번호
      /\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[-\s]?[1-4]\d{6}/, // 더 정확한 패턴
    ],
    level: "critical",
    maskFn: (m) => m.slice(0, 6) + "-*******",
  },
  {
    type: "pii_passport",
    patterns: [
      /[A-Z]{1,2}\d{7,8}/, // 여권번호
    ],
    level: "critical",
    maskFn: (m) => m.slice(0, 2) + "*****" + m.slice(-2),
  },
  {
    type: "pii_driver",
    patterns: [
      /\d{2}-\d{2}-\d{6}-\d{2}/, // 운전면허번호
    ],
    level: "critical",
    maskFn: (m) => m.slice(0, 5) + "**-******-**",
  },

  // === 금융정보 ===
  {
    type: "financial_card",
    patterns: [
      /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/, // 카드번호
      /(4\d{3}|5[1-5]\d{2}|6011)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/, // Visa/Master/Discover
    ],
    level: "critical",
    maskFn: (m) => m.slice(0, 4) + "-****-****-" + m.slice(-4),
  },
  {
    type: "financial_account",
    patterns: [
      /\d{3,4}[-\s]?\d{2,4}[-\s]?\d{4,6}/, // 일반 계좌번호
      /(계좌|통장)\s*:?\s*\d{10,14}/, // "계좌: 1234567890" 형태
    ],
    level: "sensitive",
    maskFn: (m) => m.slice(0, 4) + "****" + m.slice(-4),
  },
  {
    type: "financial_transaction",
    patterns: [
      /(이체|송금|입금|출금)\s*(내역|기록|이력)/,
      /거래\s*(내역|기록|명세)/,
      /잔액\s*:?\s*[\d,]+\s*(원|만원|억)/,
    ],
    level: "sensitive",
  },

  // === 의료정보 ===
  {
    type: "medical_diagnosis",
    patterns: [
      /진단(서|명|결과)\s*:?\s*.+/,
      /(암|당뇨|고혈압|우울증|불안장애|ADHD|자폐)\s*(진단|판정)/,
      /병명\s*:?\s*.+/,
    ],
    level: "sensitive",
  },
  {
    type: "medical_prescription",
    patterns: [
      /처방(전|서)\s*:?\s*.+/,
      /(약|복용량|투약)\s*:?\s*.+/,
      /(항생제|진통제|수면제|항우울제)\s*(처방|복용)/,
    ],
    level: "sensitive",
  },
  {
    type: "medical_record",
    patterns: [
      /건강\s*(기록|검진|결과)/,
      /혈압\s*:?\s*\d+\/\d+/,
      /혈당\s*:?\s*\d+/,
      /체중\s*:?\s*\d+\s*(kg|킬로)/i,
    ],
    level: "private",
  },

  // === 인증정보 ===
  {
    type: "auth_password",
    patterns: [
      /비밀번호\s*:?\s*.+/,
      /password\s*:?\s*.+/i,
      /패스워드\s*:?\s*.+/,
      /pw\s*:?\s*.+/i,
    ],
    level: "critical",
  },
  {
    type: "auth_apikey",
    patterns: [
      /api[-_]?key\s*:?\s*[a-zA-Z0-9_-]{20,}/i,
      /sk[-_][a-zA-Z0-9_-]{20,}/, // OpenAI/Anthropic 형식
      /AIza[a-zA-Z0-9_-]{35}/, // Google API 키
    ],
    level: "critical",
    maskFn: (m) => m.slice(0, 8) + "..." + m.slice(-4),
  },
  {
    type: "auth_token",
    patterns: [
      /token\s*:?\s*[a-zA-Z0-9_.-]{20,}/i,
      /secret\s*:?\s*[a-zA-Z0-9_-]{20,}/i,
      /bearer\s+[a-zA-Z0-9_.-]+/i,
    ],
    level: "critical",
  },

  // === 개인 파일/데이터 ===
  {
    type: "personal_diary",
    patterns: [
      /내\s*일기/,
      /오늘\s*(하루|일과|기분|감정)/,
      /일기\s*(써|작성|정리)/,
      /개인\s*메모/,
    ],
    level: "private",
  },
  {
    type: "personal_photo",
    patterns: [
      /내\s*사진/,
      /(C:|\/Users\/|\/home\/|~\/).*\.(jpg|jpeg|png|gif|heic)/i,
      /셀카|셀피|누드|사적인\s*사진/,
    ],
    level: "sensitive",
  },
  {
    type: "personal_location",
    patterns: [
      /내\s*(위치|현재\s*위치)/,
      /집\s*주소\s*:?\s*.+/,
      /GPS\s*좌표/,
    ],
    level: "private",
  },

  // === 영업비밀 ===
  {
    type: "business_confidential",
    patterns: [
      /기밀|confidential|비밀\s*유지/i,
      /영업\s*비밀/,
      /내부\s*문서|사내\s*자료/,
      /NDA|비밀유지계약/i,
    ],
    level: "sensitive",
  },
];

// ============================================
// Main Classifier
// ============================================

/**
 * 메시지의 프라이버시 수준 분류
 */
export function classifyPrivacy(message: string): PrivacyResult {
  const sensitiveTypes: SensitiveDataType[] = [];
  const detectedPatterns: PrivacyResult["detectedPatterns"] = [];
  let highestLevel: PrivacyLevel = "public";

  const levelPriority: Record<PrivacyLevel, number> = {
    public: 0,
    private: 1,
    sensitive: 2,
    critical: 3,
  };

  for (const sensitivePattern of SENSITIVE_PATTERNS) {
    for (const pattern of sensitivePattern.patterns) {
      const match = message.match(pattern);
      if (match) {
        sensitiveTypes.push(sensitivePattern.type);

        // 마스킹된 버전 생성
        const masked = sensitivePattern.maskFn
          ? sensitivePattern.maskFn(match[0])
          : match[0].slice(0, 3) + "***";

        detectedPatterns.push({
          type: sensitivePattern.type,
          matchedText: match[0],
          masked,
        });

        // 가장 높은 레벨 업데이트
        if (levelPriority[sensitivePattern.level] > levelPriority[highestLevel]) {
          highestLevel = sensitivePattern.level;
        }

        break; // 같은 패턴 그룹에서는 하나만 매칭
      }
    }
  }

  // 중복 제거
  const uniqueTypes = [...new Set(sensitiveTypes)];

  const isPrivate = highestLevel !== "public";
  const shouldUseLocalSLM = highestLevel === "sensitive" || highestLevel === "critical";

  return {
    level: highestLevel,
    isPrivate,
    sensitiveTypes: uniqueTypes,
    detectedPatterns,
    shouldUseLocalSLM,
    reason: isPrivate ? buildPrivacyReason(uniqueTypes) : undefined,
    reasonEn: isPrivate ? buildPrivacyReasonEn(uniqueTypes) : undefined,
    warningMessage: shouldUseLocalSLM ? buildWarningMessage(highestLevel, uniqueTypes) : undefined,
  };
}

// ============================================
// Helper Functions
// ============================================

const TYPE_LABELS: Record<SensitiveDataType, string> = {
  pii_ssn: "주민등록번호",
  pii_passport: "여권번호",
  pii_driver: "운전면허번호",
  pii_phone: "전화번호",
  financial_account: "계좌번호",
  financial_card: "카드번호",
  financial_transaction: "거래내역",
  medical_diagnosis: "진단정보",
  medical_prescription: "처방정보",
  medical_record: "건강기록",
  auth_password: "비밀번호",
  auth_apikey: "API 키",
  auth_token: "인증토큰",
  personal_diary: "개인일기",
  personal_photo: "개인사진",
  personal_location: "위치정보",
  business_confidential: "영업비밀",
};

const TYPE_LABELS_EN: Record<SensitiveDataType, string> = {
  pii_ssn: "Social Security Number",
  pii_passport: "Passport Number",
  pii_driver: "Driver License",
  pii_phone: "Phone Numbers",
  financial_account: "Bank Account",
  financial_card: "Card Number",
  financial_transaction: "Transaction History",
  medical_diagnosis: "Medical Diagnosis",
  medical_prescription: "Prescription",
  medical_record: "Health Records",
  auth_password: "Password",
  auth_apikey: "API Key",
  auth_token: "Auth Token",
  personal_diary: "Personal Diary",
  personal_photo: "Personal Photos",
  personal_location: "Location Data",
  business_confidential: "Confidential Business Info",
};

function buildPrivacyReason(types: SensitiveDataType[]): string {
  const labels = types.map((t) => TYPE_LABELS[t] || t);
  return `민감 정보 감지: ${labels.join(", ")}`;
}

function buildPrivacyReasonEn(types: SensitiveDataType[]): string {
  const labels = types.map((t) => TYPE_LABELS_EN[t] || t);
  return `Sensitive data detected: ${labels.join(", ")}`;
}

function buildWarningMessage(level: PrivacyLevel, types: SensitiveDataType[]): string {
  const labels = types.map((t) => TYPE_LABELS[t] || t);

  if (level === "critical") {
    return `🔴 **매우 민감한 정보가 감지되었습니다**

감지된 정보: ${labels.join(", ")}

⚠️ 이 정보는 외부 서버로 전송되지 않습니다.
🔒 로컬 디바이스에서만 처리됩니다.`;
  }

  return `🟠 **민감한 정보가 감지되었습니다**

감지된 정보: ${labels.join(", ")}

🔒 개인정보 보호를 위해 로컬 처리를 권장합니다.`;
}

// ============================================
// Utility Functions
// ============================================

/**
 * 메시지에서 민감 정보 마스킹
 */
export function maskSensitiveData(message: string): string {
  let masked = message;

  for (const sensitivePattern of SENSITIVE_PATTERNS) {
    for (const pattern of sensitivePattern.patterns) {
      if (sensitivePattern.maskFn) {
        masked = masked.replace(pattern, (match) => sensitivePattern.maskFn!(match));
      } else {
        masked = masked.replace(pattern, (match) => {
          if (match.length <= 6) return "***";
          return match.slice(0, 3) + "***" + match.slice(-2);
        });
      }
    }
  }

  return masked;
}

/**
 * 프라이버시 레벨 이모지
 */
export function getPrivacyEmoji(level: PrivacyLevel): string {
  switch (level) {
    case "public":
      return "🟢";
    case "private":
      return "🟡";
    case "sensitive":
      return "🟠";
    case "critical":
      return "🔴";
  }
}

/**
 * 로컬 SLM 사용 안내 메시지
 */
export function getLocalSLMGuidance(privacy: PrivacyResult): string | null {
  if (!privacy.shouldUseLocalSLM) {
    return null;
  }

  return `🔒 **로컬 처리 모드**

민감한 정보가 포함되어 있어 디바이스 내에서 처리됩니다.
외부 서버로 데이터가 전송되지 않습니다.

💡 로컬 SLM이 설치되어 있지 않다면:
  → "로컬 AI 설치" 라고 입력하세요.`;
}

/**
 * 프라이버시 요약 정보
 */
export function formatPrivacySummary(privacy: PrivacyResult): string {
  if (!privacy.isPrivate) {
    return "🟢 공개 가능한 내용";
  }

  const emoji = getPrivacyEmoji(privacy.level);
  const types = privacy.sensitiveTypes.map((t) => TYPE_LABELS[t]).join(", ");

  return `${emoji} ${privacy.level === "critical" ? "매우 민감" : "민감"}: ${types}`;
}

/**
 * 외부 전송 가능 여부 확인
 */
export function canSendToExternalAPI(privacy: PrivacyResult): boolean {
  // critical 레벨은 절대 외부 전송 금지
  if (privacy.level === "critical") {
    return false;
  }

  // sensitive 레벨은 경고 후 사용자 동의 필요
  // (이 함수는 기본적으로 false 반환, 동의 로직은 별도)
  if (privacy.level === "sensitive") {
    return false;
  }

  return true;
}
