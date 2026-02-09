/**
 * MoA Skill Loader
 *
 * Loads OpenClaw-compatible SKILL.md files and makes them available
 * to the AI system prompt. Skills teach the AI what tools and integrations
 * are available.
 *
 * Skill format (SKILL.md):
 * ---
 * name: skill-name
 * description: Human-readable description
 * metadata:
 *   openclaw:
 *     emoji: "🌤️"
 *     requires:
 *       bins: ["curl"]      # Required binaries
 *       env: ["API_KEY"]    # Required env vars
 * ---
 * # Instructions for the AI agent...
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================
// Types
// ============================================

export interface MoASkill {
  name: string;
  description: string;
  emoji: string;
  category: SkillCategory;
  /** Instructions from SKILL.md body (after frontmatter) */
  instructions: string;
  /** Whether this skill's requirements are met on the server */
  eligible: boolean;
  /** Why the skill is ineligible */
  ineligibleReason?: string;
  /** Required environment variables */
  requiredEnv?: string[];
  /** Required binaries */
  requiredBins?: string[];
  /** Source directory */
  sourceDir: string;
}

export type SkillCategory =
  | "weather"
  | "productivity"
  | "media"
  | "communication"
  | "search"
  | "utility"
  | "developer"
  | "system"
  | "other";

// ============================================
// Skill Categorization
// ============================================

const SKILL_CATEGORIES: Record<string, SkillCategory> = {
  weather: "weather",
  "apple-notes": "productivity",
  "apple-reminders": "productivity",
  "bear-notes": "productivity",
  notion: "productivity",
  obsidian: "productivity",
  trello: "productivity",
  "things-mac": "productivity",
  calendar: "productivity",
  "spotify-player": "media",
  "openai-image-gen": "media",
  "openai-whisper": "media",
  "openai-whisper-api": "media",
  "sherpa-onnx-tts": "media",
  "video-frames": "media",
  gifgrep: "media",
  songsee: "media",
  "nano-banana-pro": "media",
  camsnap: "media",
  peekaboo: "media",
  discord: "communication",
  slack: "communication",
  imsg: "communication",
  bluebubbles: "communication",
  wacli: "communication",
  "voice-call": "communication",
  github: "developer",
  "coding-agent": "developer",
  tmux: "developer",
  canvas: "developer",
  himalaya: "utility",
  "1password": "utility",
  "nano-pdf": "utility",
  summarize: "utility",
  "session-logs": "utility",
  "model-usage": "utility",
  "skill-creator": "utility",
  clawhub: "utility",
  "local-places": "search",
  goplaces: "search",
  blogwatcher: "search",
  oracle: "search",
  bird: "other",
  eightctl: "other",
  "food-order": "other",
  gog: "other",
  mcporter: "other",
  ordercli: "other",
  sag: "other",
  sonoscli: "other",
  blucli: "other",
  openhue: "other",
  gemini: "other",
};

// Skills safe and useful for general MoA users (non-technical)
const USER_FRIENDLY_SKILLS = new Set([
  "weather",
  "summarize",
  "openai-image-gen",
  "spotify-player",
  "notion",
  "trello",
  "apple-notes",
  "apple-reminders",
  "things-mac",
  "clawhub",
  "local-places",
  "goplaces",
  "nano-pdf",
  "openai-whisper-api",
  "github",
  "obsidian",
  "bear-notes",
  "himalaya",
  "discord",
  "slack",
  "gifgrep",
  "songsee",
  "blogwatcher",
  "camsnap",
  "peekaboo",
  "voice-call",
]);

// ============================================
// Frontmatter Parser
// ============================================

interface SkillFrontmatter {
  name?: string;
  description?: string;
  homepage?: string;
  metadata?: {
    openclaw?: {
      emoji?: string;
      requires?: {
        bins?: string[];
        env?: string[];
        anyBins?: string[];
        config?: string[];
      };
      primaryEnv?: string;
    };
  };
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const fmRaw = fmMatch[1];
  const body = fmMatch[2].trim();

  // Simple YAML-like parser for skill frontmatter
  // Handles: name, description, homepage, and JSON metadata block
  const frontmatter: SkillFrontmatter = {};

  // Extract simple key-value pairs
  const nameMatch = fmRaw.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontmatter.name = nameMatch[1].trim();

  const descMatch = fmRaw.match(/^description:\s*(.+)$/m);
  if (descMatch) frontmatter.description = descMatch[1].trim();

  const homeMatch = fmRaw.match(/^homepage:\s*(.+)$/m);
  if (homeMatch) frontmatter.homepage = homeMatch[1].trim();

  // Extract metadata JSON block
  const metaMatch = fmRaw.match(/metadata:\s*(\{[\s\S]*\})\s*$/m);
  if (metaMatch) {
    try {
      frontmatter.metadata = JSON.parse(metaMatch[1]);
    } catch {
      // Try extracting just the openclaw part
      try {
        // Handle YAML-style metadata with JSON value
        const jsonStr = metaMatch[1].replace(/\n\s*/g, " ");
        frontmatter.metadata = JSON.parse(jsonStr);
      } catch {
        // Skip metadata if unparseable
      }
    }
  }

  return { frontmatter, body };
}

// ============================================
// Eligibility Check
// ============================================

function checkEligibility(
  fm: SkillFrontmatter,
): { eligible: boolean; reason?: string } {
  const requires = fm.metadata?.openclaw?.requires;
  if (!requires) return { eligible: true };

  // Check required env vars
  if (requires.env?.length) {
    const missing = requires.env.filter((e) => !process.env[e]);
    if (missing.length > 0) {
      return {
        eligible: false,
        reason: `환경변수 필요: ${missing.join(", ")}`,
      };
    }
  }

  // Check primary env
  const primaryEnv = fm.metadata?.openclaw?.primaryEnv;
  if (primaryEnv && !process.env[primaryEnv]) {
    return {
      eligible: false,
      reason: `API 키 필요: ${primaryEnv}`,
    };
  }

  // We skip binary checks since MoA server runs on Railway (Linux)
  // and most binaries (curl, python3) are available

  return { eligible: true };
}

// ============================================
// Skill Loading
// ============================================

/**
 * Load a single skill from a directory containing SKILL.md
 */
function loadSkillFromDir(dir: string): MoASkill | null {
  const skillFile = join(dir, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  try {
    const content = readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const name = frontmatter.name ?? dir.split("/").pop() ?? "unknown";
    const { eligible, reason } = checkEligibility(frontmatter);
    const emoji = frontmatter.metadata?.openclaw?.emoji ?? "🔧";
    const category = SKILL_CATEGORIES[name] ?? "other";

    return {
      name,
      description: frontmatter.description ?? "",
      emoji,
      category,
      instructions: body,
      eligible,
      ineligibleReason: reason,
      requiredEnv: frontmatter.metadata?.openclaw?.requires?.env,
      requiredBins: frontmatter.metadata?.openclaw?.requires?.bins,
      sourceDir: dir,
    };
  } catch (err) {
    console.warn(`[Skills] Failed to load skill from ${dir}:`, err);
    return null;
  }
}

/**
 * Load all skills from a directory containing skill subdirectories
 */
export function loadSkillsFromDirectory(baseDir: string): MoASkill[] {
  if (!existsSync(baseDir)) {
    console.warn(`[Skills] Skills directory not found: ${baseDir}`);
    return [];
  }

  const skills: MoASkill[] = [];
  const entries = readdirSync(baseDir);

  for (const entry of entries) {
    const fullPath = join(baseDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    const skill = loadSkillFromDir(fullPath);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Find the OpenClaw skills directory relative to the project root
 */
export function findSkillsDirectory(): string | null {
  // Try common locations
  const candidates = [
    resolve(import.meta.dirname ?? ".", "../../../../skills"), // From extensions/kakao/src/skills/
    resolve(process.cwd(), "skills"),
    resolve(process.cwd(), "../skills"),
    "/home/user/MoA/skills",
  ];

  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      return dir;
    }
  }

  return null;
}

// ============================================
// Skill Registry (Singleton)
// ============================================

let loadedSkills: MoASkill[] | null = null;

/**
 * Get all loaded skills (loads once, caches)
 */
export function getLoadedSkills(): MoASkill[] {
  if (loadedSkills !== null) return loadedSkills;

  const dir = findSkillsDirectory();
  if (!dir) {
    console.warn("[Skills] No skills directory found");
    loadedSkills = [];
    return loadedSkills;
  }

  console.log(`[Skills] Loading skills from: ${dir}`);
  loadedSkills = loadSkillsFromDirectory(dir);
  console.log(`[Skills] Loaded ${loadedSkills.length} skills (${loadedSkills.filter((s) => s.eligible).length} eligible)`);

  return loadedSkills;
}

/**
 * Get only eligible (usable) skills
 */
export function getEligibleSkills(): MoASkill[] {
  return getLoadedSkills().filter((s) => s.eligible);
}

/**
 * Get user-friendly skills (safe for non-technical users)
 */
export function getUserFriendlySkills(): MoASkill[] {
  return getLoadedSkills().filter(
    (s) => s.eligible && USER_FRIENDLY_SKILLS.has(s.name),
  );
}

/**
 * Get skills by category
 */
export function getSkillsByCategory(category: SkillCategory): MoASkill[] {
  return getEligibleSkills().filter((s) => s.category === category);
}

/**
 * Generate a system prompt section listing available skills
 */
export function getSkillsSystemPrompt(): string {
  const eligible = getEligibleSkills();
  if (eligible.length === 0) return "";

  const byCategory = new Map<SkillCategory, MoASkill[]>();
  for (const skill of eligible) {
    const list = byCategory.get(skill.category) ?? [];
    list.push(skill);
    byCategory.set(skill.category, list);
  }

  const categoryNames: Record<SkillCategory, string> = {
    weather: "날씨",
    productivity: "생산성",
    media: "미디어",
    communication: "소통",
    search: "검색",
    utility: "유틸리티",
    developer: "개발",
    system: "시스템",
    other: "기타",
  };

  let prompt = "\n\n## 사용 가능한 스킬\n";
  prompt += "사용자가 관련 요청을 하면 해당 스킬의 기능을 안내하세요.\n\n";

  for (const [category, skills] of byCategory) {
    prompt += `### ${categoryNames[category]}\n`;
    for (const skill of skills) {
      prompt += `- ${skill.emoji} **${skill.name}**: ${skill.description}\n`;
    }
    prompt += "\n";
  }

  return prompt;
}

/**
 * Get detailed instructions for a specific skill (for tool execution)
 */
export function getSkillInstructions(skillName: string): string | null {
  const skill = getLoadedSkills().find((s) => s.name === skillName);
  if (!skill || !skill.eligible) return null;
  return skill.instructions;
}

/**
 * Reset loaded skills cache (for testing or hot-reload)
 */
export function resetSkillsCache(): void {
  loadedSkills = null;
}
