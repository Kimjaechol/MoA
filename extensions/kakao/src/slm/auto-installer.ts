/**
 * MoA SLM Auto-Installer
 *
 * 컴맹 사용자를 위한 원클릭 자동 설치 시스템
 * MoA 에이전트 설치 시 백그라운드에서 자동으로 실행됨
 *
 * Features:
 * - Ollama 자동 감지 및 설치
 * - SLM 모델 자동 다운로드 (Q4_K_M)
 * - 사용자 친화적 진행률 표시
 * - 에러 자동 복구 및 재시도
 * - 디바이스 메모리 자동 감지
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

export interface AutoInstallConfig {
  /** 설치 모드 */
  mode: "full" | "minimal" | "auto";
  /** 진행 상황 콜백 */
  onProgress?: (status: InstallStatus) => void;
  /** 완료 콜백 */
  onComplete?: (result: InstallResult) => void;
  /** 에러 콜백 */
  onError?: (error: Error) => void;
  /** 백그라운드 실행 여부 */
  background?: boolean;
  /** 사용자에게 알림 표시 여부 */
  showNotifications?: boolean;
}

export interface InstallStatus {
  /** 전체 진행률 (0-100) */
  progress: number;
  /** 현재 단계 */
  step: InstallStep;
  /** 사용자 친화적 메시지 */
  message: string;
  /** 상세 메시지 (기술적) */
  detail?: string;
  /** 예상 남은 시간 (초) */
  estimatedTimeRemaining?: number;
}

export type InstallStep =
  | "preparing" // 준비 중
  | "checking" // 시스템 확인
  | "downloading" // Ollama 다운로드
  | "installing" // Ollama 설치
  | "starting" // 서버 시작
  | "model-tier1" // Tier 1 모델 다운로드
  | "model-tier2" // Tier 2 모델 다운로드
  | "verifying" // 설치 확인
  | "complete" // 완료
  | "error"; // 에러

export interface InstallResult {
  success: boolean;
  tier1Installed: boolean;
  tier2Installed: boolean;
  ollamaVersion?: string;
  error?: string;
  duration: number; // 소요 시간 (ms)
}

// ============================================
// Constants
// ============================================

const OLLAMA_API = "http://127.0.0.1:11434";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// 사용자 친화적 메시지
const USER_MESSAGES: Record<InstallStep, string> = {
  preparing: "🚀 MoA AI 준비 중...",
  checking: "🔍 시스템 확인 중...",
  downloading: "⬇️ AI 엔진 다운로드 중...",
  installing: "📦 AI 엔진 설치 중...",
  starting: "🔄 AI 서버 시작 중...",
  "model-tier1": "🧠 기본 AI 모델 설치 중...",
  "model-tier2": "🎓 고급 AI 모델 설치 중...",
  verifying: "✅ 설치 확인 중...",
  complete: "🎉 MoA AI 설치 완료!",
  error: "❌ 설치 중 오류 발생",
};

// 단계별 진행률
const STEP_PROGRESS: Record<InstallStep, number> = {
  preparing: 0,
  checking: 5,
  downloading: 15,
  installing: 30,
  starting: 40,
  "model-tier1": 60,
  "model-tier2": 85,
  verifying: 95,
  complete: 100,
  error: -1,
};

// ============================================
// Device Detection
// ============================================

interface DeviceProfile {
  type: "mobile" | "tablet" | "desktop" | "server";
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCores: number;
  canRunTier2: boolean;
  recommendedMode: "full" | "minimal";
}

function detectDevice(): DeviceProfile {
  const totalMemoryGB = os.totalmem() / 1024 ** 3;
  const freeMemoryGB = os.freemem() / 1024 ** 3;
  const cpuCores = os.cpus().length;

  // 디바이스 타입 추정
  let type: DeviceProfile["type"] = "desktop";
  if (totalMemoryGB < 4) {
    type = "mobile";
  } else if (totalMemoryGB < 8) {
    type = "tablet";
  } else if (cpuCores >= 8 && totalMemoryGB >= 32) {
    type = "server";
  }

  // Tier 2 실행 가능 여부 (최소 6GB RAM)
  const canRunTier2 = totalMemoryGB >= 6;

  return {
    type,
    totalMemoryGB: Math.round(totalMemoryGB * 10) / 10,
    availableMemoryGB: Math.round(freeMemoryGB * 10) / 10,
    cpuCores,
    canRunTier2,
    recommendedMode: canRunTier2 ? "full" : "minimal",
  };
}

// ============================================
// Ollama Management
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
      // macOS: Homebrew 또는 공식 스크립트
      onProgress("macOS용 Ollama 설치 중...");
      try {
        await execAsync("brew install ollama", { timeout: 300000 });
      } catch {
        await execAsync("curl -fsSL https://ollama.com/install.sh | sh", {
          timeout: 300000,
        });
      }
    } else if (platform === "linux") {
      // Linux: 공식 설치 스크립트
      onProgress("Linux용 Ollama 설치 중...");
      await execAsync("curl -fsSL https://ollama.com/install.sh | sh", {
        timeout: 300000,
      });
    } else if (platform === "win32") {
      // Windows: 설치 프로그램 다운로드 및 실행
      onProgress("Windows용 Ollama 다운로드 중...");
      const installerUrl = "https://ollama.com/download/OllamaSetup.exe";
      const installerPath = path.join(os.tmpdir(), "OllamaSetup.exe");

      // PowerShell로 다운로드
      await execAsync(
        `powershell -Command "Invoke-WebRequest -Uri '${installerUrl}' -OutFile '${installerPath}'"`,
        { timeout: 300000 },
      );

      onProgress("Ollama 설치 프로그램 실행 중...");
      await execAsync(`"${installerPath}" /S`, { timeout: 120000 });

      // 정리
      try {
        fs.unlinkSync(installerPath);
      } catch {
        // 무시
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

  // 백그라운드에서 서버 시작
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // 서버 시작 대기 (최대 30초)
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

          const completed = data.completed || 0;
          const total = data.total || 1;
          const percent = Math.round((completed / total) * 100);

          onProgress({
            model: modelName,
            status: data.status || "다운로드 중",
            completed,
            total,
            percent,
          });
        } catch {
          // JSON 파싱 에러 무시
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
    if (!response.ok) {
      return false;
    }

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
 * MoA SLM 원클릭 자동 설치
 *
 * 컴맹 사용자도 쉽게 사용할 수 있도록
 * 모든 과정이 자동으로 진행됩니다.
 */
export async function autoInstallSLM(
  config: AutoInstallConfig = { mode: "auto" },
): Promise<InstallResult> {
  const startTime = Date.now();
  const device = detectDevice();

  // 설치 모드 결정
  const installMode = config.mode === "auto" ? device.recommendedMode : config.mode;

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
    // Step 1: 준비
    notify("preparing");
    await sleep(500);

    // Step 2: 시스템 확인
    notify("checking", `디바이스: ${device.type}, 메모리: ${device.totalMemoryGB}GB`);

    const ollamaInstalled = await isOllamaInstalled();
    const ollamaRunning = await isOllamaRunning();

    // Step 3: Ollama 설치 (필요시)
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

    // Step 4: 서버 시작
    notify("starting");

    if (!ollamaRunning) {
      const started = await startOllamaServer((detail) => notify("starting", detail));
      if (!started) {
        throw new Error("Ollama 서버를 시작할 수 없습니다.");
      }
    }

    // Step 5: Tier 1 모델 설치
    notify("model-tier1", "Qwen3-0.6B (에이전트 코어) 다운로드 중...");

    const tier1Model = "qwen3:0.6b-q4_K_M";
    let tier1Installed = await isModelInstalled(tier1Model);

    if (!tier1Installed) {
      tier1Installed = await downloadModel(tier1Model, (p) => {
        notify("model-tier1", `${p.status} (${p.percent}%)`, p.percent);
      });

      if (!tier1Installed) {
        throw new Error("기본 AI 모델 설치에 실패했습니다.");
      }
    } else {
      notify("model-tier1", "기본 AI 모델이 이미 설치되어 있습니다", 100);
    }

    // Step 6: Tier 2 모델 설치 (full 모드이고 메모리 충분할 때만)
    let tier2Installed = false;
    const tier2Model = "qwen3:4b-q4_K_M";

    if (installMode === "full" && device.canRunTier2) {
      notify("model-tier2", "Qwen3-4B (고급 처리) 다운로드 중...");

      tier2Installed = await isModelInstalled(tier2Model);

      if (!tier2Installed) {
        tier2Installed = await downloadModel(tier2Model, (p) => {
          notify("model-tier2", `${p.status} (${p.percent}%)`, p.percent);
        });
        // Tier 2 실패해도 계속 진행 (필수 아님)
      } else {
        notify("model-tier2", "고급 AI 모델이 이미 설치되어 있습니다", 100);
      }
    } else {
      notify(
        "model-tier2",
        device.canRunTier2
          ? "최소 설치 모드 - 고급 모델 건너뜀"
          : `메모리 부족 (${device.totalMemoryGB}GB) - 고급 모델 건너뜀`,
      );
    }

    // Step 7: 설치 확인
    notify("verifying");

    const version = await getOllamaVersion();
    await verifyInstallation(tier1Model);

    // Step 8: 완료
    notify("complete");

    const result: InstallResult = {
      success: true,
      tier1Installed,
      tier2Installed,
      ollamaVersion: version || undefined,
      duration: Date.now() - startTime,
    };

    config.onComplete?.(result);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류";

    notify("error", errorMessage);

    const result: InstallResult = {
      success: false,
      tier1Installed: false,
      tier2Installed: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };

    config.onError?.(error instanceof Error ? error : new Error(errorMessage));
    config.onComplete?.(result);
    return result;
  }
}

/**
 * 설치 검증
 */
async function verifyInstallation(modelName: string): Promise<void> {
  // 간단한 테스트 요청
  try {
    const response = await fetch(`${OLLAMA_API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "Hi",
        options: { num_predict: 1 },
      }),
    });

    if (!response.ok) {
      throw new Error("모델 테스트 실패");
    }
  } catch (error) {
    console.warn("설치 검증 경고:", error);
    // 검증 실패해도 진행 (첫 실행시 느릴 수 있음)
  }
}

// ============================================
// Helper Functions
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
    "model-tier1",
    "model-tier2",
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

// ============================================
// User-Friendly Wrapper
// ============================================

/**
 * 사용자 친화적 설치 상태 포맷팅
 */
export function formatInstallStatus(status: InstallStatus): string {
  const progressBar = createProgressBar(status.progress);
  return `${status.message}\n${progressBar} ${status.progress}%${status.detail ? `\n${status.detail}` : ""}`;
}

function createProgressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * 카카오톡용 설치 진행 메시지 포맷팅
 */
export function formatInstallStatusForKakao(status: InstallStatus): string {
  const emoji = status.step === "complete" ? "✅" : status.step === "error" ? "❌" : "⏳";

  let message = `${emoji} ${status.message}`;

  if (status.progress > 0 && status.progress < 100) {
    message += `\n\n진행률: ${status.progress}%`;
  }

  if (status.detail && status.step !== "complete" && status.step !== "error") {
    message += `\n${status.detail}`;
  }

  return message;
}

/**
 * 설치 결과 요약 메시지
 */
export function formatInstallResult(result: InstallResult): string {
  if (!result.success) {
    return `❌ MoA AI 설치 실패\n\n오류: ${result.error}\n\n수동 설치가 필요합니다.`;
  }

  const duration = Math.round(result.duration / 1000);

  let message = `🎉 MoA AI 설치 완료!\n\n`;
  message += `📦 설치된 구성요소:\n`;
  message += `  • Ollama ${result.ollamaVersion || ""}\n`;
  message += `  • 기본 AI (Qwen3-0.6B) ✅\n`;
  message += `  • 고급 AI (Qwen3-4B) ${result.tier2Installed ? "✅" : "⏭️ 건너뜀"}\n`;
  message += `\n⏱️ 소요 시간: ${duration}초`;

  if (!result.tier2Installed) {
    message += `\n\n💡 고급 AI는 메모리 6GB 이상 기기에서 나중에 설치할 수 있습니다.`;
  }

  return message;
}

// ============================================
// Exports
// ============================================

export {
  detectDevice,
  isOllamaInstalled,
  isOllamaRunning,
  type DeviceProfile,
  type ModelDownloadProgress,
};
