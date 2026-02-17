/**
 * Ollama Installer - Core SLM Setup for MoA
 *
 * Single-Tier Architecture:
 * - Tier 1: Qwen3-0.6B (~400MB) - Always running, lightweight gatekeeper
 *   Handles: intent classification, routing, heartbeat checks, privacy detection
 * - All other tasks: Gemini 2.0 Flash (cloud, cost-effective)
 *
 * Qwen3-0.6B is bundled with the MoA app and auto-installed on first run.
 */

import { spawn, exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

export interface SLMModel {
  name: string;
  ollamaName: string;
  sizeGB: number;
  description: string;
  alwaysLoaded: boolean;
}

export interface InstallProgress {
  phase: "checking" | "installing-ollama" | "pulling-model" | "ready" | "error";
  model?: string;
  progress?: number;
  message: string;
  error?: string;
}

export type ProgressCallback = (progress: InstallProgress) => void;

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  models: string[];
}

// ============================================
// Constants
// ============================================

/**
 * Qwen3-0.6B: MoA's always-on local gatekeeper
 *
 * Capabilities (100% reliable at this model size):
 * - Intent classification: simple/medium/complex/specialized (JSON output)
 * - Greeting detection and basic response
 * - Keyword extraction from messages
 * - Binary decisions: "does this need further processing?" (yes/no)
 * - Heartbeat status: read task list, decide if pending tasks exist
 * - Tool routing: which tool to invoke (calendar, search, file, etc.)
 * - Privacy detection: flag messages containing sensitive patterns
 *
 * Limitations (delegate to cloud):
 * - Substantive response generation (beyond simple greetings)
 * - Reasoning, analysis, problem-solving
 * - Code generation/review
 * - Translation, math, document analysis
 * - Deep conversation, creative writing
 *
 * Cloud delegation (online):
 * - Context summary + task delegation JSON → cloud model handles response
 * - Can attach problem description for cloud to generate user-facing question
 *
 * Offline behavior:
 * - Queue tasks locally for cloud processing when back online
 * - Notify user: "고급 AI가 필요합니다. 인터넷 연결 후 답변드리겠습니다"
 * - Heartbeat detects online recovery → auto-dispatch queued tasks
 */
export const SLM_CORE_MODEL: SLMModel = {
  name: "moa-core",
  ollamaName: "qwen3:0.6b-q4_K_M",
  sizeGB: 0.4,
  description: "Agent gatekeeper - intent classification, routing, heartbeat, privacy detection",
  alwaysLoaded: true,
};

/**
 * Cloud model strategy:
 * - "cost_effective" (가성비): Gemini 3.0 Flash — fast, cheap, good enough
 * - "max_performance" (최고성능): Claude Opus 4.6 — highest quality reasoning
 */
export type CloudStrategy = "cost_effective" | "max_performance";

export const CLOUD_MODELS: Record<CloudStrategy, { model: string; provider: string }> = {
  cost_effective: { model: "gemini-3.0-flash", provider: "google" },
  max_performance: { model: "claude-opus-4-6", provider: "anthropic" },
};

/** Default cloud fallback (가성비 전략) */
export const CLOUD_FALLBACK_MODEL = "gemini-3.0-flash";
export const CLOUD_FALLBACK_PROVIDER = "google" as const;

// Ollama API endpoint
export const OLLAMA_API = "http://127.0.0.1:11434";

// Ollama download URLs by platform
const OLLAMA_URLS: Record<string, string> = {
  darwin: "https://ollama.com/download/ollama-darwin",
  linux: "https://ollama.com/download/ollama-linux-amd64",
  win32: "https://ollama.com/download/ollama-windows-amd64.exe",
};

// Default Ollama paths
const OLLAMA_PATHS: Record<string, string> = {
  darwin: "/usr/local/bin/ollama",
  linux: "/usr/local/bin/ollama",
  win32: path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
};

// MoA data directory for model storage
const MOA_DATA_DIR = path.join(os.homedir(), ".moa");
const MOA_OLLAMA_DIR = path.join(MOA_DATA_DIR, "ollama");

// ============================================
// Ollama Binary Management
// ============================================

export async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execAsync("ollama --version");
    return true;
  } catch {
    const platform = os.platform();
    const ollamaPath = OLLAMA_PATHS[platform];
    if (ollamaPath && fs.existsSync(ollamaPath)) {
      return true;
    }
    return false;
  }
}

export async function getOllamaVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("ollama --version");
    const match = stdout.match(/ollama version (\S+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startOllamaServer(): Promise<boolean> {
  if (await isOllamaRunning()) {
    return true;
  }

  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_MODELS: MOA_OLLAMA_DIR,
      },
    });
    child.unref();

    // Wait for server to start (max 15 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await isOllamaRunning()) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function installOllama(onProgress?: ProgressCallback): Promise<boolean> {
  const platform = os.platform();

  onProgress?.({
    phase: "installing-ollama",
    message: "Ollama 설치 중...",
  });

  try {
    if (platform === "darwin") {
      try {
        await execAsync("brew install ollama");
      } catch {
        await execAsync("curl -fsSL https://ollama.com/install.sh | sh");
      }
    } else if (platform === "linux") {
      await execAsync("curl -fsSL https://ollama.com/install.sh | sh");
    } else if (platform === "win32") {
      const downloadUrl = OLLAMA_URLS.win32;
      const installerPath = path.join(os.tmpdir(), "ollama-installer.exe");

      const response = await fetch(downloadUrl);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(installerPath, Buffer.from(buffer));

      await execAsync(`"${installerPath}" /S`);
      fs.unlinkSync(installerPath);
    }

    const installed = await isOllamaInstalled();
    if (installed) {
      onProgress?.({ phase: "ready", message: "Ollama 설치 완료" });
    }
    return installed;
  } catch (error) {
    onProgress?.({
      phase: "error",
      message: "Ollama 설치 실패",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

// ============================================
// Model Management
// ============================================

export async function getInstalledModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/tags`);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) || [];
  } catch {
    return [];
  }
}

export async function isModelInstalled(modelName: string): Promise<boolean> {
  const models = await getInstalledModels();
  return models.some((m) => m.startsWith(modelName.split(":")[0]));
}

export async function pullModel(
  modelName: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    phase: "pulling-model",
    model: modelName,
    progress: 0,
    message: `${modelName} 다운로드 시작...`,
  });

  try {
    const response = await fetch(`${OLLAMA_API}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };

          if (data.error) {
            throw new Error(data.error);
          }

          if (data.completed && data.total) {
            const progress = Math.round((data.completed / data.total) * 100);
            onProgress?.({
              phase: "pulling-model",
              model: modelName,
              progress,
              message: `${modelName} 다운로드 중... ${progress}%`,
            });
          } else if (data.status) {
            onProgress?.({
              phase: "pulling-model",
              model: modelName,
              message: data.status,
            });
          }
        } catch {
          // Ignore parse errors in stream
        }
      }
    }

    onProgress?.({
      phase: "ready",
      model: modelName,
      progress: 100,
      message: `${modelName} 설치 완료`,
    });

    return true;
  } catch (error) {
    onProgress?.({
      phase: "error",
      model: modelName,
      message: `${modelName} 설치 실패`,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

export async function deleteModel(modelName: string): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================
// MoA SLM Installation (Tier 1 Only)
// ============================================

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const installed = await isOllamaInstalled();
  const running = await isOllamaRunning();
  const version = installed ? await getOllamaVersion() : undefined;
  const models = running ? await getInstalledModels() : [];

  return { installed, running, version, models };
}

export async function checkCoreModelStatus(): Promise<{
  coreReady: boolean;
  missingCore: boolean;
}> {
  const installedModels = await getInstalledModels();
  const coreReady = installedModels.some((m) =>
    m.includes(SLM_CORE_MODEL.ollamaName.split(":")[0]),
  );

  return { coreReady, missingCore: !coreReady };
}

/**
 * Install MoA core SLM model (Tier 1 only, ~400MB)
 *
 * Tier 2/3 are NOT installed locally - all advanced tasks
 * go to Gemini 2.0 Flash (cloud, cost-effective).
 */
export async function installMoaSLM(
  onProgress?: ProgressCallback,
  options?: { forceReinstall?: boolean },
): Promise<boolean> {
  const { forceReinstall = false } = options || {};

  try {
    // Phase 1: Check/Install Ollama
    onProgress?.({ phase: "checking", message: "시스템 확인 중..." });

    const ollamaInstalled = await isOllamaInstalled();
    if (!ollamaInstalled) {
      const installed = await installOllama(onProgress);
      if (!installed) {
        return false;
      }
    }

    // Phase 2: Start Ollama server
    onProgress?.({ phase: "checking", message: "로컬 AI 서버 시작 중..." });

    const serverStarted = await startOllamaServer();
    if (!serverStarted) {
      onProgress?.({
        phase: "error",
        message: "로컬 AI 서버 시작 실패",
        error: "Ollama server failed to start",
      });
      return false;
    }

    // Phase 3: Install core model (Tier 1 only, ~400MB)
    const status = await checkCoreModelStatus();

    if (!status.coreReady || forceReinstall) {
      onProgress?.({
        phase: "pulling-model",
        model: SLM_CORE_MODEL.ollamaName,
        progress: 0,
        message: `에이전트 코어 설치 중 (${SLM_CORE_MODEL.sizeGB}GB)...`,
      });

      const success = await pullModel(SLM_CORE_MODEL.ollamaName, onProgress);
      if (!success) {
        return false;
      }
    } else {
      onProgress?.({
        phase: "ready",
        model: SLM_CORE_MODEL.ollamaName,
        message: "에이전트 코어 준비 완료",
      });
    }

    // Done - no Tier 2/3 (Gemini 2.0 Flash handles everything else)
    onProgress?.({ phase: "ready", message: "MoA 로컬 AI 설치 완료 (코어 + Gemini Flash 연동)" });

    return true;
  } catch (error) {
    onProgress?.({
      phase: "error",
      message: "MoA 로컬 AI 설치 실패",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

/**
 * Quick health check for MoA SLM
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  coreLoaded: boolean;
  message: string;
}> {
  try {
    const running = await isOllamaRunning();
    if (!running) {
      return {
        healthy: false,
        coreLoaded: false,
        message: "Ollama 서버가 실행되지 않음",
      };
    }

    const status = await checkCoreModelStatus();

    return {
      healthy: status.coreReady,
      coreLoaded: status.coreReady,
      message: status.coreReady ? "MoA 로컬 AI 정상 작동 중" : "에이전트 코어 모델 없음",
    };
  } catch (error) {
    return {
      healthy: false,
      coreLoaded: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Auto-recover: Start server if needed
 */
export async function autoRecover(): Promise<boolean> {
  const health = await healthCheck();
  if (health.healthy) {
    return true;
  }

  if (!(await isOllamaRunning())) {
    await startOllamaServer();
  }

  const newHealth = await healthCheck();
  return newHealth.healthy;
}
