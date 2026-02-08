/**
 * Ollama Installer - Automatic SLM Setup for MoA Agent
 *
 * 2-Tier SLM Architecture:
 * - Tier 1: Qwen3-0.6B (~500MB) - Always running agent core
 * - Tier 2: Qwen3-4B (~3-4GB) - On-demand advanced processing
 *
 * Features:
 * - Silent background installation during MoA setup
 * - Platform-specific Ollama binary management
 * - Automatic model pulling with progress tracking
 * - Health checks and auto-recovery
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
  tier: 1 | 2;
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

// MoA SLM Models (2-Tier Architecture)
// Q4_K_M quantization: optimal balance of quality and size
export const SLM_MODELS: SLMModel[] = [
  {
    name: "moa-core",
    ollamaName: "qwen3:0.6b-q4_K_M", // Q4 quantized (~400MB)
    tier: 1,
    sizeGB: 0.4,
    description: "Agent core - routing, intent classification, tool calling",
    alwaysLoaded: true,
  },
  {
    name: "moa-advanced",
    ollamaName: "qwen3:4b-q4_K_M", // Q4 quantized (~2.6GB)
    tier: 2,
    sizeGB: 2.6,
    description: "Advanced processing - offline deep reasoning",
    alwaysLoaded: false,
  },
];

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

// MoA data directory
const MOA_DATA_DIR = path.join(os.homedir(), ".moa");
const MOA_OLLAMA_DIR = path.join(MOA_DATA_DIR, "ollama");

// ============================================
// Ollama Binary Management
// ============================================

/**
 * Check if Ollama is installed
 */
export async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execAsync("ollama --version");
    return true;
  } catch {
    // Check platform-specific paths
    const platform = os.platform();
    const ollamaPath = OLLAMA_PATHS[platform];
    if (ollamaPath && fs.existsSync(ollamaPath)) {
      return true;
    }
    return false;
  }
}

/**
 * Get Ollama version
 */
export async function getOllamaVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("ollama --version");
    const match = stdout.match(/ollama version (\S+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if Ollama server is running
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start Ollama server in background
 */
export async function startOllamaServer(): Promise<boolean> {
  if (await isOllamaRunning()) {
    return true;
  }

  try {
    // Start ollama serve in background
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

    // Wait for server to start
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

/**
 * Install Ollama binary (platform-specific)
 */
export async function installOllama(onProgress?: ProgressCallback): Promise<boolean> {
  const platform = os.platform();

  onProgress?.({
    phase: "installing-ollama",
    message: "Ollama 설치 중...",
  });

  try {
    if (platform === "darwin") {
      // macOS: Use brew or direct download
      try {
        await execAsync("brew install ollama");
      } catch {
        // Fallback to curl
        await execAsync("curl -fsSL https://ollama.com/install.sh | sh");
      }
    } else if (platform === "linux") {
      // Linux: Use install script
      await execAsync("curl -fsSL https://ollama.com/install.sh | sh");
    } else if (platform === "win32") {
      // Windows: Download and run installer
      const downloadUrl = OLLAMA_URLS.win32;
      const installerPath = path.join(os.tmpdir(), "ollama-installer.exe");

      // Download installer
      const response = await fetch(downloadUrl);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(installerPath, Buffer.from(buffer));

      // Run installer silently
      await execAsync(`"${installerPath}" /S`);

      // Cleanup
      fs.unlinkSync(installerPath);
    }

    // Verify installation
    const installed = await isOllamaInstalled();
    if (installed) {
      onProgress?.({
        phase: "ready",
        message: "Ollama 설치 완료",
      });
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

/**
 * Get list of installed models
 */
export async function getInstalledModels(): Promise<string[]> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) || [];
  } catch {
    return [];
  }
}

/**
 * Check if a specific model is installed
 */
export async function isModelInstalled(modelName: string): Promise<boolean> {
  const models = await getInstalledModels();
  return models.some((m) => m.startsWith(modelName.split(":")[0]));
}

/**
 * Pull a model with progress tracking
 */
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
    const response = await fetch("http://127.0.0.1:11434/api/pull", {
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
          // Ignore parse errors
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

/**
 * Delete a model
 */
export async function deleteModel(modelName: string): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/delete", {
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
// MoA SLM Installation
// ============================================

/**
 * Get full Ollama status
 */
export async function getOllamaStatus(): Promise<OllamaStatus> {
  const installed = await isOllamaInstalled();
  const running = await isOllamaRunning();
  const version = installed ? await getOllamaVersion() : undefined;
  const models = running ? await getInstalledModels() : [];

  return { installed, running, version, models };
}

/**
 * Check which MoA SLM models are installed
 */
export async function checkMoaSLMStatus(): Promise<{
  tier1Ready: boolean;
  tier2Ready: boolean;
  missingModels: SLMModel[];
}> {
  const installedModels = await getInstalledModels();

  const tier1Model = SLM_MODELS.find((m) => m.tier === 1)!;
  const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;

  const tier1Ready = installedModels.some((m) => m.includes(tier1Model.ollamaName.split(":")[0]));
  const tier2Ready = installedModels.some((m) => m.includes(tier2Model.ollamaName.split(":")[0]));

  const missingModels: SLMModel[] = [];
  if (!tier1Ready) {
    missingModels.push(tier1Model);
  }
  if (!tier2Ready) {
    missingModels.push(tier2Model);
  }

  return { tier1Ready, tier2Ready, missingModels };
}

/**
 * Install MoA SLM models (embedded in agent installation)
 *
 * This function is designed to run silently during MoA agent setup.
 * It installs Ollama (if needed) and pulls both tier models.
 */
export async function installMoaSLM(
  onProgress?: ProgressCallback,
  options?: {
    skipTier2?: boolean; // Skip Tier 2 for mobile/low-memory devices
    forceReinstall?: boolean;
  },
): Promise<boolean> {
  const { skipTier2 = false, forceReinstall = false } = options || {};

  try {
    // Phase 1: Check/Install Ollama
    onProgress?.({
      phase: "checking",
      message: "시스템 확인 중...",
    });

    const ollamaInstalled = await isOllamaInstalled();
    if (!ollamaInstalled) {
      const installed = await installOllama(onProgress);
      if (!installed) {
        return false;
      }
    }

    // Phase 2: Start Ollama server
    onProgress?.({
      phase: "checking",
      message: "로컬 AI 서버 시작 중...",
    });

    const serverStarted = await startOllamaServer();
    if (!serverStarted) {
      onProgress?.({
        phase: "error",
        message: "로컬 AI 서버 시작 실패",
        error: "Ollama server failed to start",
      });
      return false;
    }

    // Phase 3: Check existing models
    const slmStatus = await checkMoaSLMStatus();

    // Phase 4: Install Tier 1 (always required)
    const tier1Model = SLM_MODELS.find((m) => m.tier === 1)!;
    if (!slmStatus.tier1Ready || forceReinstall) {
      onProgress?.({
        phase: "pulling-model",
        model: tier1Model.ollamaName,
        progress: 0,
        message: `에이전트 코어 설치 중 (${tier1Model.sizeGB}GB)...`,
      });

      const tier1Success = await pullModel(tier1Model.ollamaName, onProgress);
      if (!tier1Success) {
        return false;
      }
    } else {
      onProgress?.({
        phase: "ready",
        model: tier1Model.ollamaName,
        message: "에이전트 코어 준비 완료",
      });
    }

    // Phase 5: Install Tier 2 (optional for mobile)
    if (!skipTier2) {
      const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;
      if (!slmStatus.tier2Ready || forceReinstall) {
        onProgress?.({
          phase: "pulling-model",
          model: tier2Model.ollamaName,
          progress: 0,
          message: `고급 처리 모듈 설치 중 (${tier2Model.sizeGB}GB)...`,
        });

        const tier2Success = await pullModel(tier2Model.ollamaName, onProgress);
        if (!tier2Success) {
          // Tier 2 failure is not critical
          console.warn("Tier 2 model installation failed, but continuing...");
        }
      } else {
        onProgress?.({
          phase: "ready",
          model: tier2Model.ollamaName,
          message: "고급 처리 모듈 준비 완료",
        });
      }
    }

    // Phase 6: Final status
    onProgress?.({
      phase: "ready",
      message: "MoA 로컬 AI 설치 완료",
    });

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
  tier1Loaded: boolean;
  tier2Available: boolean;
  message: string;
}> {
  try {
    const running = await isOllamaRunning();
    if (!running) {
      return {
        healthy: false,
        tier1Loaded: false,
        tier2Available: false,
        message: "Ollama 서버가 실행되지 않음",
      };
    }

    const status = await checkMoaSLMStatus();

    return {
      healthy: status.tier1Ready,
      tier1Loaded: status.tier1Ready,
      tier2Available: status.tier2Ready,
      message: status.tier1Ready ? "MoA 로컬 AI 정상 작동 중" : "에이전트 코어 모델 없음",
    };
  } catch (error) {
    return {
      healthy: false,
      tier1Loaded: false,
      tier2Available: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Auto-recover: Start server and load models if needed
 */
export async function autoRecover(): Promise<boolean> {
  const health = await healthCheck();

  if (health.healthy) {
    return true;
  }

  // Try to start server
  if (!(await isOllamaRunning())) {
    await startOllamaServer();
  }

  // Check again
  const newHealth = await healthCheck();
  return newHealth.healthy;
}
