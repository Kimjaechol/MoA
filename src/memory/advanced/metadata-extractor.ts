/**
 * MoA Advanced Memory v2 — Metadata Extraction Engine
 *
 * Rule-based (regex) metadata extraction from natural language text.
 * Fills YAML frontmatter fields without LLM classification.
 *
 * Pipeline: regex extraction → SLM gap-filling (optional) → YAML generation
 *
 * Key principle: metadata = classification. No separate classification step.
 */

import type {
  DomainType,
  EmotionType,
  ExtractedMetadata,
  MemoryEntryType,
  PersonEntry,
} from "./types.js";

// ─── Main Extraction Function ───

/**
 * Extract metadata from content using regex patterns.
 * This replaces the LLM-based classification engine from v1.
 *
 * @param content - Raw text input
 * @param existingEntities - Known entity names for matching
 */
export function extractMetadata(content: string, existingEntities?: string[]): ExtractedMetadata {
  const lower = content.toLowerCase();

  const type = detectType(lower);
  const { type: emotion, raw: emotionRaw } = detectEmotionWithRaw(content, lower);
  const domain = detectDomain(lower);
  const importance = estimateImportance(type, emotion, lower);
  const people = extractPeople(content);
  const place = extractPlace(content);
  const tags = extractTags(content, type, domain);
  const temporal = extractTemporal(content);
  const caseRef = matchExistingCase(content, existingEntities);

  return {
    type,
    people,
    place: place ?? undefined,
    tags,
    importance,
    emotion: emotion !== "neutral" ? emotion : undefined,
    emotionRaw: emotion !== "neutral" ? emotionRaw : undefined,
    domain,
    status: "active",
    caseRef: caseRef ?? undefined,
    deadline: temporal.deadline,
    eventDate: temporal.eventDate,
  };
}

// ─── Type Detection ───

function detectType(lower: string): MemoryEntryType {
  // Dispute/conflict markers
  if (
    matchesAny(lower, [
      "dispute",
      "argument",
      "conflict",
      "fight",
      "quarrel",
      "complain",
      "lawsuit",
      "분쟁",
      "말다툼",
      "갈등",
      "다툼",
      "언쟁",
      "항의",
      "소송",
      "다퉜",
      "트러블",
    ])
  ) {
    return "dispute";
  }

  // Legal markers (before conversation: "변호사와 상담" → legal)
  if (
    matchesAny(lower, [
      "법률",
      "법원",
      "court",
      "lawyer",
      "attorney",
      "변호사",
      "판결",
      "verdict",
      "소장",
      "고소",
      "합의",
      "과실",
      "교통사고",
    ])
  ) {
    return "legal";
  }

  // Conversation markers (before project: "이직 상담" → conversation)
  if (
    matchesAny(lower, [
      "said",
      "told",
      "asked",
      "talked",
      "말했",
      "얘기했",
      "이야기했",
      "대화",
      "conversation",
      "chat",
      "상담",
      "고민",
      "조언",
    ])
  ) {
    return "conversation";
  }

  // Meeting markers
  if (
    matchesAny(lower, [
      "meeting",
      "미팅",
      "회의",
      "리뷰",
      "review",
      "standup",
      "sync",
      "1:1",
      "one-on-one",
      "스크럼",
      "scrum",
    ])
  ) {
    return "meeting";
  }

  // Project markers
  if (
    matchesAny(lower, [
      "project",
      "프로젝트",
      "개발",
      "develop",
      "sprint",
      "milestone",
      "배포",
      "deploy",
      "release",
      "릴리즈",
    ])
  ) {
    return "project";
  }

  // Plan markers
  if (
    matchesAny(lower, [
      "plan",
      "계획",
      "준비",
      "예정",
      "schedule",
      "예약",
      "booking",
      "reservation",
      "일정",
      "여행",
      "travel",
      "trip",
    ])
  ) {
    return "plan";
  }

  // Transaction markers
  if (
    matchesAny(lower, [
      "purchase",
      "buy",
      "sell",
      "구매",
      "판매",
      "거래",
      "transaction",
      "계약",
      "contract",
      "견적",
      "quote",
      "invoice",
      "결제",
      "payment",
    ])
  ) {
    return "transaction";
  }

  // Learning markers
  if (
    matchesAny(lower, [
      "learn",
      "study",
      "학습",
      "공부",
      "tutorial",
      "course",
      "lesson",
      "레슨",
      "연습",
      "practice",
    ])
  ) {
    return "learning";
  }

  // Health markers
  if (
    matchesAny(lower, [
      "health",
      "건강",
      "exercise",
      "운동",
      "workout",
      "diet",
      "다이어트",
      "병원",
      "hospital",
      "doctor",
      "의사",
      "진료",
      "medication",
    ])
  ) {
    return "health";
  }

  // Creative markers
  if (
    matchesAny(lower, [
      "create",
      "write",
      "paint",
      "draw",
      "compose",
      "design",
      "창작",
      "글쓰기",
      "그림",
      "작곡",
      "디자인",
      "photography",
      "사진",
    ])
  ) {
    return "creative";
  }

  // Knowledge markers
  if (
    matchesAny(lower, [
      "knowledge",
      "지식",
      "reference",
      "참고",
      "definition",
      "정의",
      "concept",
      "개념",
      "theory",
      "이론",
      "recipe",
      "레시피",
      "실험",
      "발효",
      "반죽",
    ])
  ) {
    return "knowledge";
  }

  // Financial markers
  if (
    matchesAny(lower, [
      "invest",
      "투자",
      "stock",
      "주식",
      "fund",
      "펀드",
      "savings",
      "저축",
      "budget",
      "예산",
      "income",
      "수입",
      "expense",
      "지출",
    ])
  ) {
    return "financial";
  }

  // Social markers
  if (
    matchesAny(lower, [
      "friend",
      "친구",
      "절친",
      "bestie",
      "party",
      "파티",
      "birthday",
      "생일",
      "wedding",
      "결혼",
      "gathering",
      "모임",
    ])
  ) {
    return "social";
  }

  return "personal_note";
}

// ─── Emotion Detection ───

/** Emotion keyword groups: [category, keywords[]] */
const EMOTION_KEYWORDS: Array<[EmotionType, string[]]> = [
  [
    "angry",
    [
      "angry",
      "furious",
      "화나",
      "화났",
      "화가",
      "분노",
      "열받",
      "짜증나",
      "빡치",
      "빡쳤",
      "참을 수",
    ],
  ],
  ["frustrated", ["frustrated", "annoyed", "답답", "짜증", "언성", "말다툼", "스트레스"]],
  ["anxious", ["anxious", "worried", "nervous", "걱정", "불안", "조마조마"]],
  ["sad", ["sad", "depressed", "슬프", "우울", "속상", "서운"]],
  ["tired", ["tired", "exhausted", "피곤", "지쳤", "힘들"]],
  ["happy", ["happy", "glad", "기뻐", "행복", "좋았", "좋아", "즐거"]],
  ["grateful", ["grateful", "thankful", "감사", "고마"]],
  ["excited", ["excited", "thrilled", "신나", "흥분", "기대", "설레"]],
];

/**
 * Detect emotion AND capture the original sentence containing the emotional expression.
 *
 * Why capture the raw phrase: classifying "참을 수 없을 정도로 화가 났다" as just "angry"
 * loses critical nuance. The original wording conveys the intensity and context of the
 * emotion far more accurately than any label can. We store both the category (for filtering)
 * and the verbatim sentence (for faithful recall).
 *
 * @param content - Original text (preserves case and punctuation)
 * @param lower - Lowercased text (for keyword matching)
 */
function detectEmotionWithRaw(content: string, lower: string): { type: EmotionType; raw?: string } {
  for (const [emotionType, keywords] of EMOTION_KEYWORDS) {
    const matchedKeyword = keywords.find((kw) => lower.includes(kw));
    if (matchedKeyword) {
      // Extract the sentence/clause containing the emotional expression from the original text
      const raw = extractEmotionContext(content, matchedKeyword);
      return { type: emotionType, raw };
    }
  }
  return { type: "neutral" };
}

/**
 * Extract the sentence or clause containing the matched emotion keyword.
 * Preserves the original text as-is (no lowercasing, no summarization).
 */
function extractEmotionContext(content: string, keyword: string): string {
  const lowerContent = content.toLowerCase();
  const idx = lowerContent.indexOf(keyword);
  if (idx === -1) {
    return keyword;
  }

  // Find sentence boundaries around the keyword
  // Korean: period(.), newline, or sentence-ending particles (다., 요., 죠.)
  // English: period, exclamation, question mark, newline
  const sentenceBreaks = /[.!?\n]/;

  let start = idx;
  while (start > 0) {
    if (sentenceBreaks.test(content[start - 1]!)) {
      break;
    }
    start--;
  }

  let end = idx + keyword.length;
  while (end < content.length) {
    if (sentenceBreaks.test(content[end]!)) {
      end++; // include the punctuation
      break;
    }
    end++;
  }

  const raw = content.slice(start, end).trim();
  // If too short (just the keyword), expand to surrounding context (up to 80 chars)
  if (raw.length <= keyword.length + 2) {
    const ctxStart = Math.max(0, idx - 30);
    const ctxEnd = Math.min(content.length, idx + keyword.length + 50);
    return content.slice(ctxStart, ctxEnd).trim();
  }
  return raw;
}

// ─── Domain Detection ───

function detectDomain(lower: string): DomainType {
  // Specific domains first (before generic ones)
  if (
    matchesAny(lower, [
      "cook",
      "recipe",
      "bake",
      "요리",
      "레시피",
      "빵",
      "bread",
      "음식",
      "food",
      "meal",
      "발효",
      "반죽",
    ])
  ) {
    return "cooking";
  }

  if (
    matchesAny(lower, [
      "travel",
      "trip",
      "flight",
      "여행",
      "비행기",
      "호텔",
      "hotel",
      "관광",
      "tour",
    ])
  ) {
    return "travel";
  }

  if (matchesAny(lower, ["study", "learn", "course", "공부", "학습", "수업", "강의", "교육"])) {
    return "learning";
  }

  if (
    matchesAny(lower, ["exercise", "workout", "health", "운동", "건강", "병원", "diet", "의사"])
  ) {
    return "health";
  }

  if (
    matchesAny(lower, ["invest", "money", "bank", "투자", "돈", "은행", "예산", "budget", "재무"])
  ) {
    return "finance";
  }

  if (matchesAny(lower, ["법률", "변호사", "court", "lawyer", "소송", "법원"])) {
    return "legal";
  }
  if (matchesAny(lower, ["child", "아이", "육아", "parenting", "baby", "아기"])) {
    return "parenting";
  }

  // Social before work: social context (friends) takes priority
  if (matchesAny(lower, ["friend", "친구", "절친", "이웃", "neighbor"])) {
    return "social";
  }

  if (
    matchesAny(lower, [
      "work",
      "office",
      "meeting",
      "team",
      "업무",
      "사무실",
      "회사",
      "팀",
      "프로젝트",
      "미팅",
      "상사",
      "부장",
      "과장",
      "대리",
    ])
  ) {
    return "work";
  }

  if (
    matchesAny(lower, ["code", "program", "app", "코드", "프로그래밍", "개발", "앱", "software"])
  ) {
    return "technology";
  }

  if (matchesAny(lower, ["hobby", "game", "취미", "게임", "music", "음악", "sport", "스포츠"])) {
    return "hobby";
  }

  if (matchesAny(lower, ["art", "write", "creative", "예술", "글", "창작", "그림", "paint"])) {
    return "creative";
  }

  if (matchesAny(lower, ["house", "집", "부동산", "realestate", "rent", "임대", "아파트"])) {
    return "realestate";
  }
  if (matchesAny(lower, ["doctor", "hospital", "의료", "진료", "치료", "medical"])) {
    return "medical";
  }

  return "daily";
}

// ─── Importance Estimation ───

function estimateImportance(type: MemoryEntryType, emotion: EmotionType, lower: string): number {
  const typeScores: Partial<Record<MemoryEntryType, number>> = {
    dispute: 8,
    legal: 8,
    meeting: 6,
    project: 7,
    health: 7,
    financial: 6,
    transaction: 6,
    plan: 5,
    social: 4,
    conversation: 3,
    personal_note: 3,
  };
  let base = typeScores[type] ?? 5;

  if (emotion === "angry" || emotion === "anxious" || emotion === "frustrated") {
    base = Math.min(10, base + 1);
  }

  if (
    matchesAny(lower, ["urgent", "긴급", "immediately", "즉시", "asap", "deadline", "마감", "기한"])
  ) {
    base = Math.min(10, base + 2);
  }

  if (matchesAny(lower, ["resolved", "해결", "done", "완료", "finished", "끝났"])) {
    base = Math.max(1, base - 2);
  }

  return base;
}

// ─── People Extraction ───

export function extractPeople(content: string): PersonEntry[] {
  const people: PersonEntry[] = [];
  const seen = new Set<string>();

  // Korean-style name patterns
  const koreanPatterns = [
    /(?:옆집|이웃|친구|절친|동료|상사|부하|선배|후배|언니|오빠|누나|형|동생)\s*[가-힣]{1,4}(?:씨|님)?/g,
    /[가-힣]{1,2}(?:과장|부장|대리|사원|팀장|실장|차장|이사|사장|교수|선생님|의사|변호사|씨|님)/g,
    /절친\s*[A-Z]/g,
    /친구\s*[A-Z]/g,
  ];

  for (const pattern of koreanPatterns) {
    for (const match of content.matchAll(pattern)) {
      const raw = match[0].replace(/[이가와랑한테에게]$/, "").trim();
      if (raw.length >= 2 && !seen.has(raw)) {
        seen.add(raw);
        // Extract identifier from context (prefix like 옆집, 회사)
        const prefix = match[0].match(/^(옆집|이웃|친구|절친|동료|상사|선배|후배)/);
        people.push({
          name: raw,
          identifier: prefix ? prefix[1] : undefined,
        });
      }
    }
  }

  // English-style
  const englishPatterns = [
    /(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g,
    /(?:my (?:friend|neighbor|colleague|boss|teacher|doctor))\s+[A-Z][a-z]+/gi,
  ];

  for (const pattern of englishPatterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[0].trim();
      if (!seen.has(name)) {
        seen.add(name);
        people.push({ name });
      }
    }
  }

  return people;
}

// ─── Place Extraction ───

function extractPlace(content: string): string | null {
  // Korean place patterns — longer compound words first, then standalone
  const koreanMatches = content.match(
    /(앞마당|뒷마당|사무실|카페|학교|병원|회사|식당|공원|공항|호텔|아파트|우리\s*집)/,
  );
  if (koreanMatches) {
    return koreanMatches[1];
  }

  // English place patterns
  const englishMatches = content.match(
    /(?:at|in|near|by)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
  );
  if (englishMatches?.[1]) {
    return englishMatches[1];
  }

  return null;
}

// ─── Tag Extraction ───

function extractTags(content: string, type: MemoryEntryType, domain: DomainType): string[] {
  const tags: string[] = [type, domain];

  // Hashtag-style tags
  for (const match of content.matchAll(/#([a-zA-Z0-9가-힣_]+)/g)) {
    if (match[1] && match[1].length > 1) {
      tags.push(match[1]);
    }
  }

  return [...new Set(tags)];
}

// ─── Temporal Extraction ───

function extractTemporal(content: string): { eventDate?: string; deadline?: string } {
  const result: { eventDate?: string; deadline?: string } = {};

  // ISO date
  const isoMatch = content.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch?.[1]) {
    result.eventDate = isoMatch[1];
  }

  // Korean date (YYYY년 MM월 DD일)
  const koreanDate = content.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (koreanDate) {
    result.eventDate = `${koreanDate[1]}-${String(koreanDate[2]).padStart(2, "0")}-${String(koreanDate[3]).padStart(2, "0")}`;
  }

  // Deadline keywords
  if (matchesAny(content.toLowerCase(), ["deadline", "마감", "기한", "까지", "due"])) {
    if (result.eventDate) {
      result.deadline = result.eventDate;
      result.eventDate = undefined;
    }
  }

  return result;
}

// ─── Case Matching ───

function matchExistingCase(content: string, existingEntities?: string[]): string | null {
  if (!existingEntities?.length) {
    return null;
  }

  // Try to find existing case/entity references
  for (const entity of existingEntities) {
    if (content.includes(entity)) {
      return entity;
    }
  }

  return null;
}

// ─── Utilities ───

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}
