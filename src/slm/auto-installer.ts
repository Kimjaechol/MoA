/**
 * MoA SLM Auto-Installer (Simplified)
 *
 * One-click installation: Ollama + Qwen3-0.6B only (~400MB)
 * All advanced tasks use cloud AI (Gemini 3.0 Flash or Claude Opus 4.6).
 */

import { spawn, exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { CLOUD_FALLBACK_MODEL, SLM_CORE_MODEL } from "./ollama-installer.js";

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

export interface AutoInstallConfig {
  onProgress?: (status: InstallStatus) => void;
  onComplete?: (result: InstallResult) => void;
  onError?: (error: Error) => void;
  background?: boolean;
}

export interface InstallStatus {
  progress: number;
  step: InstallStep;
  message: string;
  detail?: string;
}

export type InstallStep =
  | "preparing"
  | "checking"
  | "downloading"
  | "installing"
  | "starting"
  | "model-core"
  | "verifying"
  | "complete"
  | "error";

export interface InstallResult {
  success: boolean;
  coreInstalled: boolean;
  ollamaVersion?: string;
  cloudModel: string;
  error?: string;
  duration: number;
}

// ============================================
// Constants
// ============================================

const OLLAMA_API = "http://127.0.0.1:11434";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const USER_MESSAGES: Record<InstallStep, string> = {
  preparing: "MoA AI 준비 중...",
  checking: "시스템 확인 중...",
  downloading: "AI 엔진 다운로드 중...",
  installing: "AI 엔진 설치 중...",
  starting: "AI 서버 시작 중...",
  "model-core": "코어 AI 모델 설치 중 (~400MB)...",
  verifying: "설치 확인 중...",
  complete: "MoA AI 설치 완료!",
  error: "설치 중 오류 발생",
};

const STEP_PROGRESS: Record<InstallStep, number> = {
  preparing: 0,
  checking: 5,
  downloading: 15,
  installing: 30,
  starting: 45,
  "model-core": 60,
  verifying: 90,
  complete: 100,
  error: -1,
};

// ============================================
// Device Detection
// ============================================

export interface DeviceProfile {
  type: "mobile" | "tablet" | "desktop" | "server";
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCores: number;
}

export function detectDevice(): DeviceProfile {
  const totalMemoryGB = os.totalmem() / 1024 ** 3;
  const freeMemoryGB = os.freemem() / 1024 ** 3;
  const cpuCores = os.cpus().length;

  let type: DeviceProfile["type"] = "desktop";
  if (totalMemoryGB < 4) {
    type = "mobile";
  } else if (totalMemoryGB < 8) {
    type = "tablet";
  } else if (cpuCores >= 8 && totalMemoryGB >= 32) {
    type = "server";
  }

  return {
    type,
    totalMemoryGB: Math.round(totalMemoryGB * 10) / 10,
    availableMemoryGB: Math.round(freeMemoryGB * 10) / 10,
    cpuCores,
  };
}

// ============================================
// Ollama Management (local helpers)
// ============================================

async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execAsync("ollama --version");
    return true;
  } catch {
    return false;
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getOllamaVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("ollama --version");
    return stdout.trim().replace("ollama version ", "");
  } catch {
    return null;
  }
}

async function installOllamaAuto(onProgress: (detail: string) => void): Promise<boolean> {
  const platform = os.platform();

  try {
    if (platform === "darwin") {
      onProgress("macOS용 Ollama 설치 중...");
      try {
        await execAsync("brew install ollama", { timeout: 300000 });
      } catch {
        await execAsync("curl -fsSL https://ollama.com/install.sh | sh", { timeout: 300000 });
      }
    } else if (platform === "linux") {
      onProgress("Linux용 Ollama 설치 중...");
      await execAsync("curl -fsSL https://ollama.com/install.sh | sh", { timeout: 300000 });
    } else if (platform === "win32") {
      onProgress("Windows용 Ollama 다운로드 중...");
      const installerUrl = "https://ollama.com/download/OllamaSetup.exe";
      const installerPath = path.join(os.tmpdir(), "OllamaSetup.exe");

      await execAsync(
        `powershell -Command "Invoke-WebRequest -Uri '${installerUrl}' -OutFile '${installerPath}'"`,
        { timeout: 300000 },
      );

      onProgress("Ollama 설치 프로그램 실행 중...");
      await execAsync(`"${installerPath}" /S`, { timeout: 120000 });

      try {
        fs.unlinkSync(installerPath);
      } catch {
        // ignore cleanup errors
      }
    } else {
      throw new Error(`지원하지 않는 운영체제: ${platform}`);
    }

    return await isOllamaInstalled();
  } catch (error) {
    console.error("Ollama 설치 실패:", error);
    return false;
  }
}

async function startOllamaServer(onProgress: (detail: string) => void): Promise<boolean> {
  if (await isOllamaRunning()) {
    onProgress("Ollama 서버가 이미 실행 중입니다");
    return true;
  }

  onProgress("Ollama 서버 시작 중...");

  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await isOllamaRunning()) {
      onProgress("Ollama 서버 시작 완료");
      return true;
    }
  }

  return false;
}

// ============================================
// Model Management
// ============================================

interface ModelDownloadProgress {
  model: string;
  status: string;
  completed: number;
  total: number;
  percent: number;
}

async function downloadModel(
  modelName: string,
  onProgress: (progress: ModelDownloadProgress) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`모델 다운로드 실패: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };

          if (data.error) throw new Error(data.error);

          onProgress({
            model: modelName,
            status: data.status || "다운로드 중",
            completed: data.completed || 0,
            total: data.total || 1,
            percent: Math.round(((data.completed || 0) / (data.total || 1)) * 100),
          });
        } catch {
          // ignore stream parse errors
        }
      }
    }

    return true;
  } catch (error) {
    console.error(`모델 ${modelName} 다운로드 실패:`, error);
    return false;
  }
}

async function isModelInstalled(modelName: string): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/tags`);
    if (!response.ok) return false;

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const baseModel = modelName.split(":")[0];
    return data.models?.some((m) => m.name.startsWith(baseModel)) || false;
  } catch {
    return false;
  }
}

// ============================================
// Auto-Installer
// ============================================

/**
 * MoA SLM one-click install
 *
 * Installs only core model (~400MB).
 * Advanced tasks use cloud AI (no local download needed).
 */
export async function autoInstallSLM(
  config: AutoInstallConfig = {},
): Promise<InstallResult> {
  const startTime = Date.now();

  const notify = (step: InstallStep, detail?: string, subProgress?: number) => {
    const baseProgress = STEP_PROGRESS[step];
    const nextStep = getNextStep(step);
    const nextProgress = nextStep ? STEP_PROGRESS[nextStep] : 100;
    const stepRange = nextProgress - baseProgress;

    const progress =
      subProgress !== undefined ? baseProgress + (stepRange * subProgress) / 100 : baseProgress;

    config.onProgress?.({
      progress: Math.round(progress),
      step,
      message: USER_MESSAGES[step],
      detail,
    });
  };

  try {
    notify("preparing");
    await sleep(300);

    const device = detectDevice();
    notify("checking", `디바이스: ${device.type}, 메모리: ${device.totalMemoryGB}GB`);

    const ollamaInstalled = await isOllamaInstalled();
    const ollamaRunning = await isOllamaRunning();

    // Install Ollama if needed
    if (!ollamaInstalled) {
      notify("downloading");
      const installed = await retryWithBackoff(
        () => installOllamaAuto((detail) => notify("installing", detail)),
        MAX_RETRIES,
      );
      if (!installed) {
        throw new Error("Ollama 설치에 실패했습니다. 수동으로 설치해주세요.");
      }
    } else {
      notify("installing", "Ollama가 이미 설치되어 있습니다");
    }

    // Start server
    notify("starting");
    if (!ollamaRunning) {
      const started = await startOllamaServer((detail) => notify("starting", detail));
      if (!started) {
        throw new Error("Ollama 서버를 시작할 수 없습니다.");
      }
    }

    // Install core model only (~400MB)
    const coreModel = SLM_CORE_MODEL.ollamaName;
    notify("model-core", "Qwen3-0.6B (코어 게이트키퍼) 다운로드 중...");

    let coreInstalled = await isModelInstalled(coreModel);
    if (!coreInstalled) {
      coreInstalled = await downloadModel(coreModel, (p) => {
        notify("model-core", `${p.status} (${p.percent}%)`, p.percent);
      });
      if (!coreInstalled) {
        throw new Error("코어 AI 모델 설치에 실패했습니다.");
      }
    } else {
      notify("model-core", "코어 AI 모델이 이미 설치되어 있습니다", 100);
    }

    // No Tier 2/3 download - Gemini Flash handles everything else

    // Verify
    notify("verifying");
    const version = await getOllamaVersion();

    notify("complete");

    const result: InstallResult = {
      success: true,
      coreInstalled,
      ollamaVersion: version || undefined,
      cloudModel: CLOUD_FALLBACK_MODEL,
      duration: Date.now() - startTime,
    };

    config.onComplete?.(result);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류";
    notify("error", errorMessage);

    const result: InstallResult = {
      success: false,
      coreInstalled: false,
      cloudModel: CLOUD_FALLBACK_MODEL,
      error: errorMessage,
      duration: Date.now() - startTime,
    };

    config.onError?.(error instanceof Error ? error : new Error(errorMessage));
    config.onComplete?.(result);
    return result;
  }
}

// ============================================
// Formatting
// ============================================

export function formatInstallStatus(status: InstallStatus): string {
  const filled = Math.round(status.progress / 5);
  const empty = 20 - filled;
  const progressBar = "█".repeat(filled) + "░".repeat(empty);
  return `${status.message}\n${progressBar} ${status.progress}%${status.detail ? `\n${status.detail}` : ""}`;
}

export function formatInstallResult(result: InstallResult): string {
  if (!result.success) {
    return `MoA AI 설치 실패\n\n오류: ${result.error}\n\n수동 설치가 필요합니다.`;
  }

  const duration = Math.round(result.duration / 1000);

  let message = `MoA AI 설치 완료!\n\n`;
  message += `설치된 구성요소:\n`;
  message += `  - Ollama ${result.ollamaVersion || ""}\n`;
  message += `  - 코어 AI (Qwen3-0.6B) - 의도분류/라우팅/하트비트\n`;
  message += `  - 클라우드 AI (${result.cloudModel}) - 추론/생성/분석\n`;
  message += `\n소요 시간: ${duration}초`;

  return message;
}

// ============================================
// Helpers
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNextStep(current: InstallStep): InstallStep | null {
  const steps: InstallStep[] = [
    "preparing",
    "checking",
    "downloading",
    "installing",
    "starting",
    "model-core",
    "verifying",
    "complete",
  ];
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        await sleep(RETRY_DELAY * (i + 1));
      }
    }
  }

  throw lastError;
}
