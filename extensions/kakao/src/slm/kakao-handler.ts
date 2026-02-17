/**
 * MoA SLM KakaoTalk Handler
 *
 * 카카오톡 사용자를 위한 SLM 설치 및 관리 인터페이스
 * 모든 메시지는 비기술적 사용자를 위해 쉽게 작성됨
 */

import {
  autoInstallSLM,
  formatInstallStatus,
  formatInstallResult,
  detectDevice,
  isOllamaRunning,
  healthCheck,
  getSLMInfo,
  CLOUD_FALLBACK_MODEL,
  type InstallStatus,
  type InstallResult,
  type DeviceProfile,
} from "../../../../src/slm/index.js";

// ============================================
// Types
// ============================================

export interface KakaoInstallSession {
  userId: string;
  status: "idle" | "installing" | "complete" | "error";
  startTime?: Date;
  lastUpdate?: InstallStatus;
  result?: InstallResult;
}

// ============================================
// State Management
// ============================================

// 설치 세션 관리 (메모리)
const installSessions = new Map<string, KakaoInstallSession>();

// ============================================
// Command Handlers
// ============================================

/**
 * "MoA 설치" 또는 "AI 설치" 명령 처리
 */
export async function handleInstallCommand(
  kakaoUserId: string,
): Promise<{ message: string; needsFollowUp: boolean }> {
  // 이미 설치 중인지 확인
  const existingSession = installSessions.get(kakaoUserId);
  if (existingSession?.status === "installing" && existingSession.lastUpdate) {
    return {
      message: formatInstallStatus(existingSession.lastUpdate),
      needsFollowUp: true,
    };
  }

  // 이미 설치되어 있는지 확인
  const health = await healthCheck();
  if (health.healthy) {
    const info = await getSLMInfo();
    return {
      message:
        `✅ MoA AI가 이미 설치되어 있습니다!\n\n` +
        `📦 설치 구성:\n` +
        `  • 코어 AI: ${info.core.model} ${info.core.status === "ready" ? "✅" : "❌"}\n` +
        `  • 클라우드 AI: ${info.cloudFallback.model} (${info.cloudFallback.provider}) ☁️\n\n` +
        `💡 "AI 상태" 라고 말하면 상세 정보를 볼 수 있어요.`,
      needsFollowUp: false,
    };
  }

  // 디바이스 정보 확인
  const device = detectDevice();

  return {
    message:
      `🚀 MoA AI 설치를 시작합니다!\n\n` +
      `📱 디바이스 정보:\n` +
      `  • 타입: ${getDeviceTypeKorean(device.type)}\n` +
      `  • 메모리: ${device.totalMemoryGB}GB\n\n` +
      `📦 설치 내용:\n` +
      `  • 코어 AI (Qwen3-0.6B, ~400MB) - 의도분류/라우팅\n` +
      `  • 클라우드 AI (${CLOUD_FALLBACK_MODEL}) - 추론/생성\n\n` +
      `⏱️ 예상 소요 시간: 1-2분\n\n` +
      `설치를 시작하시겠습니까?\n` +
      `"설치 시작" 이라고 말해주세요.`,
    needsFollowUp: true,
  };
}

/**
 * "설치 시작" 명령 처리 - 실제 설치 실행
 */
export async function handleInstallStart(
  kakaoUserId: string,
  onProgress?: (message: string) => Promise<void>,
): Promise<{ message: string; success: boolean }> {
  // 세션 생성
  const session: KakaoInstallSession = {
    userId: kakaoUserId,
    status: "installing",
    startTime: new Date(),
  };
  installSessions.set(kakaoUserId, session);

  try {
    // 진행 상황 알림 (선택적)
    let lastNotifyTime = 0;
    const notifyThrottle = 3000; // 3초마다 알림

    const result = await autoInstallSLM({
      onProgress: async (status) => {
        session.lastUpdate = status;

        // 진행 상황 알림 (쓰로틀링)
        const now = Date.now();
        if (onProgress && now - lastNotifyTime > notifyThrottle) {
          lastNotifyTime = now;
          await onProgress(formatInstallStatus(status));
        }
      },
    });

    // 세션 업데이트
    session.status = result.success ? "complete" : "error";
    session.result = result;

    return {
      message: formatInstallResult(result),
      success: result.success,
    };
  } catch (error) {
    session.status = "error";

    return {
      message:
        `❌ 설치 중 오류가 발생했습니다.\n\n` +
        `${error instanceof Error ? error.message : "알 수 없는 오류"}\n\n` +
        `다시 시도하려면 "MoA 설치"라고 말해주세요.`,
      success: false,
    };
  }
}

/**
 * "AI 상태" 명령 처리
 */
export async function handleStatusCommand(_kakaoUserId: string): Promise<string> {
  const running = await isOllamaRunning();

  if (!running) {
    return (
      `🔴 MoA AI 상태: 꺼짐\n\n` +
      `로컬 AI 서버가 실행되고 있지 않습니다.\n\n` +
      `💡 "MoA 설치"라고 말하면 AI를 설치/시작할 수 있어요.`
    );
  }

  const info = await getSLMInfo();
  const device = detectDevice();

  let message = `🟢 MoA AI 상태: 정상\n\n`;

  // 코어 AI 상태
  message += `📦 코어 AI (항시 실행 - 의도분류/라우팅/하트비트)\n`;
  message += `  모델: ${info.core.model}\n`;
  message += `  상태: ${info.core.status === "ready" ? "✅ 준비됨" : "❌ 미설치"}\n\n`;

  // 클라우드 AI
  message += `☁️ 클라우드 AI (추론/생성/분석)\n`;
  message += `  모델: ${info.cloudFallback.model} (${info.cloudFallback.provider})\n`;
  message += `  상태: ✅ 온라인\n`;

  // 전략 정보
  message += `\n🎯 클라우드 전략\n`;
  message += `  가성비: ${info.cloudStrategies.cost_effective.model}\n`;
  message += `  최고성능: ${info.cloudStrategies.max_performance.model}\n`;

  // 오프라인 대기열
  if (info.offlineQueueSize > 0) {
    message += `\n📋 오프라인 대기 작업: ${info.offlineQueueSize}건\n`;
  }

  message += `\n📱 디바이스\n`;
  message += `  타입: ${getDeviceTypeKorean(device.type)}\n`;
  message += `  메모리: ${device.availableMemoryGB}GB / ${device.totalMemoryGB}GB\n`;

  message += `\n💡 사용 팁\n`;
  message += `  • 개인정보가 포함된 질문은 자동으로 로컬 AI가 처리해요\n`;
  message += `  • 복잡한 질문은 클라우드 AI가 빠르고 정확하게 답변해요`;

  return message;
}

/**
 * "AI 삭제" 명령 처리
 */
export async function handleUninstallCommand(_kakaoUserId: string): Promise<string> {
  return (
    `⚠️ MoA AI 삭제\n\n` +
    `정말로 로컬 AI를 삭제하시겠습니까?\n` +
    `삭제하면 오프라인 AI 기능을 사용할 수 없게 됩니다.\n\n` +
    `삭제하려면 "삭제 확인"이라고 말해주세요.\n` +
    `취소하려면 아무 말이나 해주세요.`
  );
}

// ============================================
// Intent Detection
// ============================================

export type SLMCommand =
  | "install" // MoA 설치, AI 설치
  | "install-start" // 설치 시작, 설치 진행
  | "status" // AI 상태, MoA 상태
  | "uninstall" // AI 삭제, MoA 삭제
  | "help" // AI 도움말
  | null;

/**
 * 사용자 메시지에서 SLM 관련 명령 감지
 */
export function detectSLMCommand(message: string): SLMCommand {
  const normalized = message.trim().toLowerCase();

  // 설치 시작
  if (/^(설치\s*시작|시작|설치\s*진행|진행)$/.test(normalized)) {
    return "install-start";
  }

  // 설치
  if (
    /(moa|ai|에이아이)\s*(설치|설정|시작|활성화)/.test(normalized) ||
    /로컬\s*(ai|에이아이)\s*설치/.test(normalized) ||
    /^설치$/.test(normalized)
  ) {
    return "install";
  }

  // 상태
  if (
    /(moa|ai|에이아이)\s*(상태|정보|확인)/.test(normalized) ||
    /로컬\s*(ai|에이아이)\s*상태/.test(normalized)
  ) {
    return "status";
  }

  // 삭제
  if (/(moa|ai|에이아이)\s*(삭제|제거|비활성화)/.test(normalized)) {
    return "uninstall";
  }

  // 도움말
  if (/(moa|ai|에이아이)\s*(도움말|도움|사용법|안내)/.test(normalized)) {
    return "help";
  }

  return null;
}

/**
 * SLM 명령 처리 (통합)
 */
export async function handleSLMCommand(
  kakaoUserId: string,
  message: string,
  onProgress?: (message: string) => Promise<void>,
): Promise<{ handled: boolean; response?: string }> {
  const command = detectSLMCommand(message);

  if (!command) {
    return { handled: false };
  }

  let response: string;

  switch (command) {
    case "install": {
      const result = await handleInstallCommand(kakaoUserId);
      response = result.message;
      break;
    }

    case "install-start": {
      const result = await handleInstallStart(kakaoUserId, onProgress);
      response = result.message;
      break;
    }

    case "status":
      response = await handleStatusCommand(kakaoUserId);
      break;

    case "uninstall":
      response = await handleUninstallCommand(kakaoUserId);
      break;

    case "help":
      response = getSLMHelpMessage();
      break;

    default:
      return { handled: false };
  }

  return { handled: true, response };
}

// ============================================
// Help Messages
// ============================================

function getSLMHelpMessage(): string {
  return (
    `🤖 MoA AI 안내\n\n` +
    `MoA는 로컬 AI + 클라우드 AI 하이브리드 구조입니다.\n\n` +
    `📦 코어 AI (Qwen3-0.6B, 로컬)\n` +
    `  의도분류, 라우팅, 하트비트, 프라이버시 감지\n` +
    `  민감한 정보가 외부로 전송되지 않도록 보호\n\n` +
    `☁️ 클라우드 AI\n` +
    `  가성비: Gemini 3.0 Flash / 최고성능: Claude Opus 4.6\n` +
    `  추론, 생성, 분석, 번역 등 모든 고급 작업\n\n` +
    `📋 사용 가능한 명령어\n` +
    `  • "AI 설치" - 로컬 AI 설치 (~400MB)\n` +
    `  • "AI 상태" - 설치 상태 확인\n` +
    `  • "AI 삭제" - 로컬 AI 삭제\n\n` +
    `💡 로컬 AI가 처리하는 경우\n` +
    `  • 주민등록번호, 카드번호 등 개인정보\n` +
    `  • 비밀번호, 인증 정보\n` +
    `  • 의료, 금융 관련 민감 정보`
  );
}

function getDeviceTypeKorean(type: DeviceProfile["type"]): string {
  const types: Record<string, string> = {
    mobile: "모바일",
    tablet: "태블릿",
    desktop: "데스크탑",
    server: "서버",
  };
  return types[type] || type;
}

// ============================================
// Background Installation (앱 시작시)
// ============================================

/**
 * 앱 시작시 백그라운드 자동 설치 체크
 *
 * MoA 에이전트가 처음 실행될 때 호출되어
 * 필요시 백그라운드에서 SLM을 설치합니다.
 */
export async function checkAndInstallOnStartup(
  onStatusChange?: (message: string) => void,
): Promise<void> {
  try {
    // 이미 설치되어 있으면 스킵
    const health = await healthCheck();
    if (health.healthy) {
      onStatusChange?.("✅ MoA 로컬 AI 준비 완료");
      return;
    }

    // MoA Security: 자동 소프트웨어 다운로드/설치는 관리자 승인 필요
    // MOA_AUTO_SLM_INSTALL=1 환경변수가 설정된 경우에만 자동 설치 실행
    if (process.env.MOA_AUTO_SLM_INSTALL !== "1") {
      onStatusChange?.(
        "ℹ️ 로컬 SLM이 설치되지 않았습니다. 관리자가 수동으로 설치하거나 MOA_AUTO_SLM_INSTALL=1 환경변수를 설정하세요.",
      );
      console.info(
        "[MoA 보안 정책] SLM 자동 설치가 비활성화되어 있습니다. " +
        "활성화하려면 MOA_AUTO_SLM_INSTALL=1 환경변수를 설정하세요. " +
        "클라우드 AI는 정상적으로 사용 가능합니다.",
      );
      return;
    }

    // 관리자 승인 하에 백그라운드 설치 시작
    onStatusChange?.("🔄 MoA 로컬 AI 설정 중...");

    const result = await autoInstallSLM({
      background: true,
      onProgress: (status) => {
        // 주요 단계만 알림
        if (["model-core", "complete", "error"].includes(status.step)) {
          onStatusChange?.(status.message);
        }
      },
    });

    if (result.success) {
      onStatusChange?.("✅ MoA 로컬 AI 자동 설치 완료");
    } else {
      // 실패해도 앱은 정상 동작 (클라우드 AI 사용)
      console.warn("SLM 자동 설치 실패:", result.error);
    }
  } catch (error) {
    console.error("SLM 스타트업 체크 실패:", error);
    // 에러가 발생해도 앱은 정상 동작
  }
}
