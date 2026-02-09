/**
 * ClawHub Marketplace Integration for MoA
 *
 * Provides curated skill recommendations from clawhub.com
 * and helps users discover new capabilities for their MoA agent.
 *
 * This module does NOT auto-install skills — it recommends skills
 * that users can install via the MoA agent on their device.
 */

// ============================================
// Curated Skill Catalog
// ============================================

export interface ClawhubSkillEntry {
  slug: string;
  name: string;
  description: string;
  descriptionKo: string;
  emoji: string;
  category: ClawhubCategory;
  /** Tags for search */
  tags: string[];
  /** Whether this skill is safe for general (non-technical) users */
  userFriendly: boolean;
  /** Required env vars (if any) */
  requiredEnv?: string[];
  /** Install command */
  installCmd: string;
}

export type ClawhubCategory =
  | "productivity"
  | "media"
  | "communication"
  | "development"
  | "search"
  | "automation"
  | "finance"
  | "education"
  | "health"
  | "entertainment";

/**
 * Curated list of recommended clawhub skills for MoA users.
 * Selected for safety, usefulness, and broad appeal.
 */
const RECOMMENDED_SKILLS: ClawhubSkillEntry[] = [
  // --- Productivity ---
  {
    slug: "notion",
    name: "Notion",
    description: "Manage Notion pages, databases, and notes",
    descriptionKo: "Notion 페이지, 데이터베이스, 노트 관리",
    emoji: "📝",
    category: "productivity",
    tags: ["notion", "notes", "database", "wiki", "노트", "메모"],
    userFriendly: true,
    requiredEnv: ["NOTION_API_KEY"],
    installCmd: "clawhub install notion",
  },
  {
    slug: "trello",
    name: "Trello",
    description: "Manage Trello boards, lists, and cards",
    descriptionKo: "Trello 보드, 리스트, 카드 관리",
    emoji: "📋",
    category: "productivity",
    tags: ["trello", "kanban", "project", "task", "프로젝트", "할일"],
    userFriendly: true,
    requiredEnv: ["TRELLO_API_KEY"],
    installCmd: "clawhub install trello",
  },
  {
    slug: "obsidian",
    name: "Obsidian",
    description: "Manage Obsidian vault notes and knowledge base",
    descriptionKo: "Obsidian 볼트 노트 및 지식 기반 관리",
    emoji: "💎",
    category: "productivity",
    tags: ["obsidian", "notes", "markdown", "knowledge", "노트", "지식"],
    userFriendly: true,
    installCmd: "clawhub install obsidian",
  },
  {
    slug: "summarize",
    name: "Summarize",
    description: "Summarize long texts, articles, and documents",
    descriptionKo: "긴 텍스트, 기사, 문서 요약",
    emoji: "📄",
    category: "productivity",
    tags: ["summarize", "summary", "text", "article", "요약", "정리"],
    userFriendly: true,
    installCmd: "clawhub install summarize",
  },
  {
    slug: "nano-pdf",
    name: "PDF Reader",
    description: "Read and extract text from PDF files",
    descriptionKo: "PDF 파일 읽기 및 텍스트 추출",
    emoji: "📑",
    category: "productivity",
    tags: ["pdf", "document", "reader", "문서", "피디에프"],
    userFriendly: true,
    installCmd: "clawhub install nano-pdf",
  },

  // --- Media ---
  {
    slug: "openai-image-gen",
    name: "AI Image Gen",
    description: "Generate images with DALL-E and GPT Image models",
    descriptionKo: "DALL-E와 GPT로 이미지 생성",
    emoji: "🖼️",
    category: "media",
    tags: ["image", "dalle", "art", "generate", "이미지", "그림", "생성"],
    userFriendly: true,
    requiredEnv: ["OPENAI_API_KEY"],
    installCmd: "clawhub install openai-image-gen",
  },
  {
    slug: "spotify-player",
    name: "Spotify",
    description: "Control Spotify playback and search music",
    descriptionKo: "Spotify 재생 제어 및 음악 검색",
    emoji: "🎵",
    category: "entertainment",
    tags: ["spotify", "music", "play", "song", "음악", "노래", "재생"],
    userFriendly: true,
    installCmd: "clawhub install spotify-player",
  },
  {
    slug: "gifgrep",
    name: "GIF Search",
    description: "Search and share GIFs from the web",
    descriptionKo: "웹에서 GIF 검색 및 공유",
    emoji: "🎞️",
    category: "entertainment",
    tags: ["gif", "meme", "animation", "짤", "움짤"],
    userFriendly: true,
    installCmd: "clawhub install gifgrep",
  },
  {
    slug: "camsnap",
    name: "Camera Snap",
    description: "Take photos with your device camera",
    descriptionKo: "기기 카메라로 사진 촬영",
    emoji: "📸",
    category: "media",
    tags: ["camera", "photo", "capture", "카메라", "사진", "촬영"],
    userFriendly: true,
    installCmd: "clawhub install camsnap",
  },

  // --- Communication ---
  {
    slug: "himalaya",
    name: "Email",
    description: "Read, send, and manage emails",
    descriptionKo: "이메일 읽기, 보내기, 관리",
    emoji: "📧",
    category: "communication",
    tags: ["email", "mail", "inbox", "이메일", "메일"],
    userFriendly: true,
    installCmd: "clawhub install himalaya",
  },

  // --- Search ---
  {
    slug: "local-places",
    name: "Local Places",
    description: "Find nearby restaurants, cafes, and places",
    descriptionKo: "주변 맛집, 카페, 장소 찾기",
    emoji: "📍",
    category: "search",
    tags: ["places", "restaurant", "cafe", "nearby", "맛집", "카페", "장소", "주변"],
    userFriendly: true,
    installCmd: "clawhub install local-places",
  },
  {
    slug: "blogwatcher",
    name: "Blog Watcher",
    description: "Monitor and read blog posts and RSS feeds",
    descriptionKo: "블로그 글과 RSS 피드 모니터링",
    emoji: "📰",
    category: "search",
    tags: ["blog", "rss", "news", "feed", "블로그", "뉴스"],
    userFriendly: true,
    installCmd: "clawhub install blogwatcher",
  },

  // --- Development ---
  {
    slug: "github",
    name: "GitHub",
    description: "Manage GitHub repos, issues, and PRs",
    descriptionKo: "GitHub 저장소, 이슈, PR 관리",
    emoji: "🐙",
    category: "development",
    tags: ["github", "git", "code", "repo", "깃헙", "코드"],
    userFriendly: false,
    installCmd: "clawhub install github",
  },
  {
    slug: "coding-agent",
    name: "Coding Agent",
    description: "AI coding assistant for writing and debugging code",
    descriptionKo: "코드 작성 및 디버깅 AI 코딩 어시스턴트",
    emoji: "💻",
    category: "development",
    tags: ["coding", "programming", "debug", "코딩", "프로그래밍"],
    userFriendly: false,
    installCmd: "clawhub install coding-agent",
  },

  // --- Automation ---
  {
    slug: "apple-reminders",
    name: "Apple Reminders",
    description: "Manage Apple Reminders lists and tasks",
    descriptionKo: "Apple 미리알림 목록 및 작업 관리",
    emoji: "⏰",
    category: "automation",
    tags: ["reminders", "todo", "task", "alarm", "미리알림", "할일", "알람"],
    userFriendly: true,
    installCmd: "clawhub install apple-reminders",
  },
  {
    slug: "apple-notes",
    name: "Apple Notes",
    description: "Search and manage Apple Notes",
    descriptionKo: "Apple 메모 검색 및 관리",
    emoji: "🗒️",
    category: "automation",
    tags: ["notes", "apple", "memo", "메모", "노트"],
    userFriendly: true,
    installCmd: "clawhub install apple-notes",
  },

  // --- Weather (built-in) ---
  {
    slug: "weather",
    name: "Weather",
    description: "Get current weather and forecasts",
    descriptionKo: "현재 날씨 및 일기예보 확인",
    emoji: "🌤️",
    category: "search",
    tags: ["weather", "forecast", "temperature", "날씨", "기온", "예보"],
    userFriendly: true,
    installCmd: "clawhub install weather",
  },
];

// ============================================
// Marketplace API
// ============================================

/**
 * Get all recommended skills
 */
export function getRecommendedSkills(): ClawhubSkillEntry[] {
  return RECOMMENDED_SKILLS;
}

/**
 * Get user-friendly recommended skills only
 */
export function getUserFriendlyRecommendedSkills(): ClawhubSkillEntry[] {
  return RECOMMENDED_SKILLS.filter((s) => s.userFriendly);
}

/**
 * Search skills by query (matches name, description, tags)
 */
export function searchSkills(query: string): ClawhubSkillEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return RECOMMENDED_SKILLS;

  return RECOMMENDED_SKILLS.filter((skill) => {
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.slug.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.descriptionKo.includes(q) ||
      skill.tags.some((t) => t.includes(q))
    );
  });
}

/**
 * Get skills by category
 */
export function getSkillsByMarketCategory(category: ClawhubCategory): ClawhubSkillEntry[] {
  return RECOMMENDED_SKILLS.filter((s) => s.category === category);
}

/**
 * Format skill catalog for display in messaging channels
 */
export function formatSkillCatalog(
  skills: ClawhubSkillEntry[],
  maxLen: number = 2000,
): string {
  let output = "MoA 스킬 마켓플레이스\n\n";

  const byCategory = new Map<ClawhubCategory, ClawhubSkillEntry[]>();
  for (const skill of skills) {
    const list = byCategory.get(skill.category) ?? [];
    list.push(skill);
    byCategory.set(skill.category, list);
  }

  const categoryNames: Record<ClawhubCategory, string> = {
    productivity: "생산성",
    media: "미디어",
    communication: "소통",
    development: "개발",
    search: "검색/정보",
    automation: "자동화",
    finance: "금융",
    education: "교육",
    health: "건강",
    entertainment: "엔터테인먼트",
  };

  for (const [category, catSkills] of byCategory) {
    output += `[${categoryNames[category]}]\n`;
    for (const skill of catSkills) {
      output += `${skill.emoji} ${skill.name} — ${skill.descriptionKo}\n`;
    }
    output += "\n";
  }

  output += `MoA에 설치된 기기에서 "스킬 설치 [이름]"으로 설치할 수 있습니다.\n`;
  output += `자세한 정보: clawhub.com`;

  // Truncate if needed
  if (output.length > maxLen) {
    output = output.slice(0, maxLen - 3) + "...";
  }

  return output;
}

/**
 * Format a single skill detail for display
 */
export function formatSkillDetail(skill: ClawhubSkillEntry): string {
  let output = `${skill.emoji} ${skill.name}\n\n`;
  output += `${skill.descriptionKo}\n\n`;

  if (skill.requiredEnv?.length) {
    output += `필요한 설정: ${skill.requiredEnv.join(", ")}\n`;
  }

  output += `\n설치 방법:\n`;
  output += `MoA가 설치된 기기에서:\n`;
  output += `${skill.installCmd}\n`;

  return output;
}
