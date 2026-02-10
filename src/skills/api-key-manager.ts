import type { SkillApiKeyConfig } from "./types.js";

/**
 * Maps skill IDs to their API key configurations.
 * Each skill may require one or more API keys, and each key
 * may have a free fallback strategy when the key is absent.
 */
export const SKILL_API_KEYS: Record<string, SkillApiKeyConfig[]> = {
  "brave-search": [
    {
      envVar: "BRAVE_SEARCH_API_KEY",
      description: "Enables Brave Search API for web search results",
      required: false,
      freeFallback: "DuckDuckGo via curl (no API key needed)",
      validatePattern: /^BSA[a-zA-Z0-9_-]{20,}$/,
    },
  ],
  perplexity: [
    {
      envVar: "PERPLEXITY_API_KEY",
      description: "Enables Perplexity AI for research-grade answers",
      required: false,
      freeFallback: "brave-search + web fetch (cascading fallback)",
      validatePattern: /^pplx-[a-zA-Z0-9]{40,}$/,
    },
  ],
  gamma: [
    {
      envVar: "GAMMA_API_KEY",
      description: "Enables Gamma for slide/presentation generation",
      required: false,
      freeFallback: "Local HTML generation with reveal.js templates",
    },
  ],
  transcriptapi: [
    {
      envVar: "TRANSCRIPT_API_KEY",
      description: "Enables TranscriptAPI for YouTube transcript extraction",
      required: false,
      freeFallback: "yt-dlp --write-auto-sub (requires yt-dlp binary)",
    },
  ],
  audiopod: [
    {
      envVar: "AUDIOPOD_API_KEY",
      description: "Enables Audiopod for podcast-style audio generation",
      required: false,
      freeFallback: "Local ffmpeg + whisper pipeline",
    },
  ],
  "hugging-face-model-trainer": [
    {
      envVar: "HF_TOKEN",
      description: "Enables Hugging Face Hub for model upload and training",
      required: false,
      freeFallback: "Local Unsloth/Ollama for fine-tuning without Hub access",
      validatePattern: /^hf_[a-zA-Z0-9]{30,}$/,
    },
  ],
  "hugging-face-evaluation": [
    {
      envVar: "HF_TOKEN",
      description: "Enables Hugging Face Hub for model evaluation and benchmarks",
      required: false,
      freeFallback: "Local Unsloth/Ollama for evaluation without Hub access",
      validatePattern: /^hf_[a-zA-Z0-9]{30,}$/,
    },
  ],
  "api-gateway": [
    {
      envVar: "API_GATEWAY_KEYS",
      description: "Centrally managed per-service API keys for the gateway",
      required: false,
      freeFallback: "Individual per-skill key configuration",
    },
  ],
  notion: [
    {
      envVar: "NOTION_API_KEY",
      description: "Enables Notion API for pages/databases/blocks management",
      required: false,
      freeFallback: "Local markdown files, Obsidian vault, or SQLite DB",
      validatePattern: /^(ntn_|secret_)[a-zA-Z0-9]+$/,
    },
  ],
  "nano-banana-pro": [
    {
      envVar: "GEMINI_API_KEY",
      description: "Enables Gemini 3 Pro Image for high-quality image generation/editing",
      required: false,
      freeFallback: "Ollama local models, Hugging Face free inference API",
    },
  ],
  gemini: [
    {
      envVar: "GEMINI_API_KEY",
      description: "Enables Gemini CLI for code review, planning, and large-context analysis",
      required: false,
      freeFallback: "Ollama local models (Gemma, Llama) or Google AI Studio free tier",
    },
  ],
  summarize: [
    {
      envVar: "GEMINI_API_KEY",
      description: "Enables high-quality summarization with Gemini or other LLM providers",
      required: false,
      freeFallback: "Default free model (google/gemini-3-flash-preview) or --extract-only mode",
    },
  ],
  "fal-ai": [
    {
      envVar: "FAL_KEY",
      description: "Enables fal.ai for FLUX/SDXL image, video, and audio generation",
      required: false,
      freeFallback: "Ollama local models, openai-whisper for transcription",
    },
  ],
  "fal-text-to-image": [
    {
      envVar: "FAL_KEY",
      description: "Enables fal.ai FLUX/SDXL for text-to-image generation and editing",
      required: false,
      freeFallback: "nano-banana-pro, Hugging Face free inference, Ollama",
    },
  ],
  "replicate-api": [
    {
      envVar: "REPLICATE_API_TOKEN",
      description: "Enables Replicate for running thousands of AI models on cloud GPUs",
      required: false,
      freeFallback: "Ollama local models, Hugging Face free inference",
      validatePattern: /^r8_[a-zA-Z0-9]+$/,
    },
  ],
  "google-search": [
    {
      envVar: "GOOGLE_CSE_API_KEY",
      description: "Enables Google Custom Search for structured search results",
      required: false,
      freeFallback: "brave-search, DuckDuckGo, or openclaw-serper",
    },
  ],
  "openclaw-serper": [
    {
      envVar: "SERPER_API_KEY",
      description: "Enables Serper for Google Search results (2,500 free searches included)",
      required: false,
      freeFallback: "brave-search, DuckDuckGo API",
    },
  ],
  parallel: [
    {
      envVar: "PARALLEL_API_KEY",
      description: "Enables Parallel.ai for high-accuracy web research",
      required: false,
      freeFallback: "brave-search + perplexity cascading fallback",
    },
  ],
  "slack-api": [
    {
      envVar: "SLACK_BOT_TOKEN",
      description: "Enables advanced Slack workspace automation (channels, users, files)",
      required: false,
      freeFallback: "Basic slack skill or Incoming Webhooks",
      validatePattern: /^xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+$/,
    },
  ],
  airtable: [
    {
      envVar: "AIRTABLE_API_KEY",
      description: "Enables Airtable for base/table/record management",
      required: false,
      freeFallback: "Local SQLite, xlsx skill, or JSON files",
      validatePattern: /^pat[a-zA-Z0-9.]+$/,
    },
  ],
  "home-assistant": [
    {
      envVar: "HA_TOKEN",
      description: "Enables Home Assistant for smart home control",
      required: false,
      freeFallback: "openhue (Philips Hue), eightctl (Eight Sleep), macOS Shortcuts",
    },
  ],
  "hugging-face-trackio": [
    {
      envVar: "HF_TOKEN",
      description: "Enables Hugging Face Trackio for ML experiment tracking dashboard",
      required: false,
      freeFallback: "Local TensorBoard, CSV logs, or matplotlib charts",
      validatePattern: /^hf_[a-zA-Z0-9]{30,}$/,
    },
  ],
  "sora-2-nature-documentary": [
    {
      envVar: "OPENAI_API_KEY",
      description: "Enables OpenAI Sora 2 for nature documentary video generation",
      required: false,
      freeFallback: "Pexels/Pixabay stock footage, ffmpeg slideshow generation",
    },
  ],
  "google-imagen-3-portrait-photography": [
    {
      envVar: "GEMINI_API_KEY",
      description: "Enables Google Imagen 3 for photorealistic portrait generation",
      required: false,
      freeFallback: "nano-banana-pro, fal-ai FLUX, Hugging Face free models",
    },
  ],
  "gemini-nano-banana-pro-portraits": [
    {
      envVar: "GEMINI_API_KEY",
      description: "Enables Gemini Nano Banana Pro for portrait photo templates",
      required: false,
      freeFallback: "nano-banana-pro fallback chain (Ollama, HF free inference)",
    },
  ],
};

/**
 * Retrieve an API key for the given skill, checking the environment
 * first and then falling back to process.env lookup by envVar name.
 */
export function getApiKey(skillId: string, envVar: string): string | null {
  const value = process.env[envVar];
  if (!value || value.trim() === "") {
    return null;
  }

  // Validate format if a pattern is configured
  const configs = SKILL_API_KEYS[skillId];
  if (configs) {
    const config = configs.find((c) => c.envVar === envVar);
    if (config?.validatePattern && !config.validatePattern.test(value)) {
      return null;
    }
  }

  return value;
}

/** Check whether an API key is available and valid for a skill. */
export function hasApiKey(skillId: string, envVar: string): boolean {
  return getApiKey(skillId, envVar) !== null;
}

/** Return the free fallback description for a skill, or null if none exists. */
export function getFallbackStrategy(skillId: string): string | null {
  const configs = SKILL_API_KEYS[skillId];
  if (!configs || configs.length === 0) {
    return null;
  }
  // Return the first fallback found across the skill's key configs
  for (const config of configs) {
    if (config.freeFallback) {
      return config.freeFallback;
    }
  }
  return null;
}

/**
 * Return a user-facing message explaining how to set up the API key,
 * what benefit it provides, and what the free fallback is.
 */
export function promptApiKeySetup(skillId: string): string {
  const configs = SKILL_API_KEYS[skillId];
  if (!configs || configs.length === 0) {
    return `No API key configuration found for skill "${skillId}".`;
  }

  const lines: string[] = [`API Key Setup for "${skillId}":\n`];

  for (const config of configs) {
    lines.push(`  Key: ${config.envVar}`);
    lines.push(`  Benefit: ${config.description}`);
    lines.push(`  Set it: export ${config.envVar}="your-key-here"`);
    if (config.freeFallback) {
      lines.push(`  Free alternative: ${config.freeFallback}`);
    }
    if (config.required) {
      lines.push("  Status: REQUIRED (no free fallback available)");
    } else {
      lines.push("  Status: Optional (free fallback available)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * List all known API keys and whether they are currently configured
 * in the environment.
 */
export function getAllConfiguredKeys(): Array<{
  skill: string;
  envVar: string;
  configured: boolean;
}> {
  const results: Array<{ skill: string; envVar: string; configured: boolean }> = [];

  for (const [skillId, configs] of Object.entries(SKILL_API_KEYS)) {
    for (const config of configs) {
      results.push({
        skill: skillId,
        envVar: config.envVar,
        configured: hasApiKey(skillId, config.envVar),
      });
    }
  }

  return results;
}
