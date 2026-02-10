/**
 * MoA Advanced Memory System - AI Auto-Classification & Tagging Engine
 *
 * Extracts entities, relationships, tags, and metadata from natural language input.
 * Uses LLM-based analysis to classify and tag memory entries across 7 dimensions:
 * type, temporal, people, case, place, domain, importance.
 */

import type {
  ClassificationResult,
  DomainType,
  EmotionType,
  ExtractedEntity,
  ExtractedRelationship,
  MemoryEntryType,
  NodeType,
} from "./types.js";

// ─── Classification Prompt ───

/**
 * Build the LLM prompt for auto-classification.
 * Includes existing entities/tags/cases for context and dedup.
 */
export function buildClassificationPrompt(params: {
  content: string;
  existingEntities?: Array<{ id: string; name: string; type: string }>;
  existingTags?: string[];
  existingCases?: string[];
  language?: string;
}): string {
  const entityList =
    params.existingEntities?.map((e) => `${e.id} (${e.name}, ${e.type})`).join(", ") || "none";
  const tagList = params.existingTags?.join(", ") || "none";
  const caseList = params.existingCases?.join(", ") || "none";

  return `You are a personal information classifier for a universal AI assistant that serves people worldwide across all professions, languages, and life domains.

Analyze the following text and extract structured metadata. The system manages ALL life episodes: daily conversations, work meetings, neighbor disputes, travel plans, cooking experiments, study sessions, health tracking, financial transactions, creative projects, legal matters, and more.

## Existing context
- Known entities: ${entityList}
- Known tags: ${tagList}
- Known cases/episodes: ${caseList}

## Rules
1. If an entity matches an existing one, reuse the existing ID and set is_new=false
2. Create new entities for previously unknown people, organizations, places, events, or topics
3. A "case" is any episode/project/issue in someone's life (not just legal) — a neighbor dispute, a trip plan, a cooking experiment, a work project, a friendship event
4. Always extract relationships between entities
5. Detect emotion when present in the text
6. Assign importance (1-10) based on: ongoing conflict=8, deadline-approaching=9, resolved=4, work-project=7, casual-conversation=3, health-related=7, financial=6
7. Classify domain accurately from the full list

## Text to analyze
${params.content}

## Output (JSON only, no markdown)
{
  "type": "conversation|dispute|meeting|project|plan|transaction|learning|health|social|creative|knowledge|personal_note|legal|financial",
  "entities": [
    {"id": "type_slugname", "name": "display name", "type": "person|organization|case|topic|place|document|concept|event|knowledge", "is_new": true}
  ],
  "relationships": [
    {"from": "entity_id", "to": "entity_id", "type": "participant|neighbor|colleague|friend|family|counterpart|mediator|advisor|manager|involved_in|located_at|related_to|part_of|references"}
  ],
  "tags": ["tag1", "tag2"],
  "importance": 5,
  "emotion": "happy|grateful|excited|neutral|tired|frustrated|angry|anxious|sad",
  "domain": "daily|work|learning|health|finance|social|hobby|travel|cooking|parenting|legal|medical|realestate|technology|creative",
  "temporal": {"event_date": "YYYY-MM-DD or null", "deadline": "YYYY-MM-DD or null"},
  "suggested_links": ["existing_file_path_or_entity_id"],
  "people": ["person names mentioned"],
  "case": "case_slug_name or null",
  "place": "place name or null"
}`;
}

/**
 * Parse the LLM classification response.
 * Handles both clean JSON and JSON wrapped in markdown code blocks.
 */
export function parseClassificationResponse(response: string): ClassificationResult | null {
  // Strip markdown code block markers if present
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned) as RawClassificationResponse;
    return normalizeClassification(parsed);
  } catch {
    // Try to extract JSON from mixed content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as RawClassificationResponse;
        return normalizeClassification(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── Fallback Rule-Based Classification ───

/**
 * Rule-based classification when LLM is unavailable.
 * Uses keyword matching and heuristics for basic entity extraction.
 */
export function classifyWithRules(content: string): ClassificationResult {
  const lower = content.toLowerCase();
  const type = detectType(lower);
  const emotion = detectEmotion(lower);
  const domain = detectDomain(lower);
  const importance = estimateImportance(type, emotion, lower);
  const people = extractPeopleHeuristic(content);
  const place = extractPlaceHeuristic(content);
  const tags = extractTagsHeuristic(content, type, domain);
  const temporal = extractTemporalHeuristic(content);

  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];

  // Create entities for detected people
  for (const person of people) {
    const id = `person_${slugify(person)}`;
    entities.push({ id, name: person, type: "person", isNew: true });
  }

  // Create entity for place if detected
  if (place) {
    const id = `place_${slugify(place)}`;
    entities.push({ id, name: place, type: "place", isNew: true });
  }

  return {
    type,
    entities,
    relationships,
    tags,
    importance,
    emotion: emotion !== "neutral" ? emotion : undefined,
    domain,
    temporal: temporal.eventDate || temporal.deadline ? temporal : undefined,
    people,
    place: place ?? undefined,
  };
}

// ─── Type Detection ───

function detectType(lower: string): MemoryEntryType {
  // Dispute/conflict markers (multilingual)
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

  // Legal markers (check before conversation so "변호사와 상담" → legal, not conversation)
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

  // Conversation markers (check before project/meeting to avoid "이직 상담" → project)
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
      "v2",
      "v3",
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
      "exercise",
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
      "약",
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

function detectEmotion(lower: string): EmotionType {
  if (
    matchesAny(lower, [
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
    ])
  ) {
    return "angry";
  }
  if (matchesAny(lower, ["frustrated", "annoyed", "답답", "짜증", "언성", "말다툼", "스트레스"])) {
    return "frustrated";
  }
  if (matchesAny(lower, ["anxious", "worried", "nervous", "걱정", "불안", "조마조마"])) {
    return "anxious";
  }
  if (matchesAny(lower, ["sad", "depressed", "슬프", "우울", "속상", "서운"])) {
    return "sad";
  }
  if (matchesAny(lower, ["tired", "exhausted", "피곤", "지쳤", "힘들"])) {
    return "tired";
  }
  if (matchesAny(lower, ["happy", "glad", "기뻐", "행복", "좋았", "좋아", "즐거"])) {
    return "happy";
  }
  if (matchesAny(lower, ["grateful", "thankful", "감사", "고마"])) {
    return "grateful";
  }
  if (matchesAny(lower, ["excited", "thrilled", "신나", "흥분", "기대", "설레"])) {
    return "excited";
  }
  return "neutral";
}

// ─── Domain Detection ───

function detectDomain(lower: string): DomainType {
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
  // Social check before work: social context (friends, neighbors) takes priority
  // over work-related terms that may appear within a social conversation
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
  let base = 5;

  // Type-based adjustments
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
  base = typeScores[type] ?? 5;

  // Emotion-based adjustments
  if (emotion === "angry" || emotion === "anxious") {
    base = Math.min(10, base + 1);
  }
  if (emotion === "frustrated") {
    base = Math.min(10, base + 1);
  }

  // Urgency markers
  if (
    matchesAny(lower, ["urgent", "긴급", "immediately", "즉시", "asap", "deadline", "마감", "기한"])
  ) {
    base = Math.min(10, base + 2);
  }

  // Resolution markers (lower importance)
  if (matchesAny(lower, ["resolved", "해결", "done", "완료", "finished", "끝났"])) {
    base = Math.max(1, base - 2);
  }

  return base;
}

// ─── Heuristic Entity Extraction ───

function extractPeopleHeuristic(content: string): string[] {
  const people: string[] = [];
  const seen = new Set<string>();

  // Korean-style name patterns: [Title/Prefix] [Name]
  const koreanPatterns = [
    /(?:옆집|이웃|친구|절친|동료|상사|부하|선배|후배|언니|오빠|누나|형|동생)\s*[가-힣]{1,4}(?:씨|님|이|가|와|랑|한테|에게)?/g,
    /[가-힣]{1,2}(?:과장|부장|대리|사원|팀장|실장|차장|이사|사장|교수|선생님|의사|변호사|씨|님)/g,
    /절친\s*[A-Z]/g,
    /친구\s*[A-Z]/g,
  ];

  for (const pattern of koreanPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const name = match[0].replace(/[이가와랑한테에게]$/, "").trim();
      if (name.length >= 2 && !seen.has(name)) {
        seen.add(name);
        people.push(name);
      }
    }
  }

  // English-style: Mr./Mrs./Dr./Prof. [Name]
  const englishPatterns = [
    /(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g,
    /(?:my (?:friend|neighbor|colleague|boss|teacher|doctor))\s+[A-Z][a-z]+/gi,
  ];

  for (const pattern of englishPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const name = match[0].trim();
      if (!seen.has(name)) {
        seen.add(name);
        people.push(name);
      }
    }
  }

  return people;
}

function extractPlaceHeuristic(content: string): string | null {
  // Korean place patterns
  const koreanPlaces = [
    /(?:에서|에|앞|뒤|옆|안|근처)\s+/,
    /(앞마당|뒷마당|사무실|카페|학교|병원|집|회사|식당|공원|역|공항|호텔|아파트)/,
  ];

  for (const pattern of koreanPlaces) {
    const match = content.match(pattern);
    if (match) {
      return match[1] ?? match[0]?.trim();
    }
  }

  // English place patterns
  const englishPlaces = [
    /(?:at|in|near|by)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /(?:office|home|café|restaurant|park|school|hospital|airport|hotel|studio)/i,
  ];

  for (const pattern of englishPlaces) {
    const match = content.match(pattern);
    if (match) {
      return match[1] ?? match[0]?.trim();
    }
  }

  return null;
}

function extractTagsHeuristic(
  content: string,
  type: MemoryEntryType,
  domain: DomainType,
): string[] {
  const tags: string[] = [type, domain];

  // Extract hashtag-style tags
  const hashtags = content.matchAll(/#([a-zA-Z0-9가-힣_]+)/g);
  for (const match of hashtags) {
    if (match[1] && match[1].length > 1) {
      tags.push(match[1]);
    }
  }

  return [...new Set(tags)];
}

function extractTemporalHeuristic(content: string): { eventDate?: string; deadline?: string } {
  const result: { eventDate?: string; deadline?: string } = {};

  // ISO date patterns
  const isoMatch = content.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    result.eventDate = isoMatch[1];
  }

  // Korean date patterns (YYYY년 MM월 DD일)
  const koreanDateMatch = content.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (koreanDateMatch) {
    const [, year, month, day] = koreanDateMatch;
    result.eventDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Deadline keywords
  if (matchesAny(content.toLowerCase(), ["deadline", "마감", "기한", "까지", "due"])) {
    // Use detected date as deadline instead
    if (result.eventDate) {
      result.deadline = result.eventDate;
      result.eventDate = undefined;
    }
  }

  return result;
}

// ─── Normalization ───

type RawClassificationResponse = {
  type?: string;
  entities?: Array<{
    id?: string;
    name?: string;
    type?: string;
    is_new?: boolean;
  }>;
  relationships?: Array<{
    from?: string;
    to?: string;
    type?: string;
  }>;
  tags?: string[];
  importance?: number;
  emotion?: string;
  domain?: string;
  temporal?: {
    event_date?: string;
    deadline?: string;
  };
  suggested_links?: string[];
  people?: string[];
  case?: string;
  place?: string;
};

function normalizeClassification(raw: RawClassificationResponse): ClassificationResult {
  const validTypes: MemoryEntryType[] = [
    "conversation",
    "dispute",
    "meeting",
    "project",
    "plan",
    "transaction",
    "learning",
    "health",
    "social",
    "creative",
    "knowledge",
    "personal_note",
    "legal",
    "financial",
  ];
  const validEmotions: EmotionType[] = [
    "happy",
    "grateful",
    "excited",
    "neutral",
    "tired",
    "frustrated",
    "angry",
    "anxious",
    "sad",
  ];
  const validDomains: DomainType[] = [
    "daily",
    "work",
    "learning",
    "health",
    "finance",
    "social",
    "hobby",
    "travel",
    "cooking",
    "parenting",
    "legal",
    "medical",
    "realestate",
    "technology",
    "creative",
  ];
  const validNodeTypes = new Set<NodeType>([
    "person",
    "organization",
    "case",
    "topic",
    "place",
    "document",
    "concept",
    "event",
    "knowledge",
  ]);

  const type = validTypes.includes(raw.type as MemoryEntryType)
    ? (raw.type as MemoryEntryType)
    : "personal_note";

  const entities: ExtractedEntity[] = (raw.entities ?? [])
    .filter((e): e is Required<typeof e> => Boolean(e.id && e.name && e.type))
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: validNodeTypes.has(e.type as NodeType) ? (e.type as NodeType) : "topic",
      isNew: e.is_new ?? true,
    }));

  const relationships: ExtractedRelationship[] = (raw.relationships ?? [])
    .filter((r): r is Required<typeof r> => Boolean(r.from && r.to && r.type))
    .map((r) => ({
      from: r.from,
      to: r.to,
      type: r.type,
    }));

  const emotion = validEmotions.includes(raw.emotion as EmotionType)
    ? (raw.emotion as EmotionType)
    : undefined;

  const domain = validDomains.includes(raw.domain as DomainType)
    ? (raw.domain as DomainType)
    : undefined;

  return {
    type,
    entities,
    relationships,
    tags: (raw.tags ?? []).filter((t) => typeof t === "string" && t.length > 0),
    importance: Math.min(10, Math.max(1, raw.importance ?? 5)),
    emotion,
    domain,
    temporal:
      raw.temporal?.event_date || raw.temporal?.deadline
        ? {
            eventDate: raw.temporal.event_date ?? undefined,
            deadline: raw.temporal.deadline ?? undefined,
          }
        : undefined,
    suggestedLinks: raw.suggested_links,
    people: raw.people?.filter((p) => typeof p === "string" && p.length > 0),
    case: typeof raw.case === "string" && raw.case.length > 0 ? raw.case : undefined,
    place: typeof raw.place === "string" && raw.place.length > 0 ? raw.place : undefined,
  };
}

// ─── Utilities ───

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u314e\u314f-\u3163\uac00-\ud7a3\u4e00-\u9fff]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}
