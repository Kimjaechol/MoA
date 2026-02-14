/**
 * Lost Device Handler — Full orchestrator for lost/stolen phone security
 *
 * 이 파일은 분실 기기 보안의 전체 흐름을 관장하는 오케스트레이터입니다.
 *
 * === 전체 보안 흐름 ===
 *
 * 1. 사용자가 /분실신고 입력 (어떤 채널에서든)
 *    ↓
 * 2. reportLostDevice() 호출
 *    ├─ 대상 기기 식별 (이름 또는 자동 선택)
 *    ├─ 클라우드 백업 상태 확인
 *    ├─ 전략 결정: immediate | backup_then_wipe
 *    ├─ 기기 토큰 즉시 폐기 → 절취자 relay 접근 차단
 *    ├─ wipe 전용 토큰 발급
 *    ├─ wipe 명령 큐잉
 *    └─ 사용자에게 확인 메시지 전송
 *    ↓
 * 3. 사용자가 /분실확인 입력
 *    ↓
 * 4. confirmLostDevice() 호출
 *    └─ 이미 위에서 큐잉됨 → "대기 중" 상태 확인
 *    ↓
 * 5. [기기가 온라인 되는 순간] executeDeviceWipe() 호출
 *    ├─ backup_then_wipe인 경우:
 *    │   ├─ 긴급 E2E 암호화 백업 수행
 *    │   ├─ 백업 성공 확인
 *    │   └─ 실패 시: 최대 3회 재시도 → 그래도 실패하면 강제 삭제
 *    ├─ secureWipeAll() 실행 (3중 덮어쓰기)
 *    │   ├─ 벡터 DB 파일 삭제
 *    │   ├─ 채팅 로그 파일 삭제
 *    │   ├─ 인증 정보 삭제
 *    │   ├─ 보안 설정 삭제
 *    │   └─ 메모리 키 제로화
 *    ├─ wipe 결과 보고
 *    └─ 사용자 알림 (원래 채널로)
 *    ↓
 * 6. [사용자가 새 기기 구입]
 *    ├─ MoA 설치 → /기기등록
 *    ├─ /동기화 다운로드 → 클라우드 백업에서 복원
 *    └─ 정상 운영 재개
 */

import { DeviceSecurityManager } from "./device-security.js";
import {
  requestRemoteWipe,
  checkPendingWipe,
  updateWipeBackupStatus,
  markWipeExecuted,
  formatWipeConfirmation,
  formatWipeCompletionNotice,
  type ExtendedWipeCommand,
  type WipeStrategy,
} from "./remote-wipe.js";
import type { WipeCommand } from "../relay/types.js";

// Emergency backup retry configuration
const BACKUP_MAX_RETRIES = 3;
const BACKUP_RETRY_DELAY_MS = 2000;

/**
 * Step 1-2: Report a lost device.
 *
 * Called when user sends /분실신고 from any channel.
 * Handles the entire initial flow: identify device, check backup,
 * revoke tokens, queue wipe.
 */
export async function reportLostDevice(params: {
  userId: string;
  /** Device name (optional — if omitted, shows device list to choose) */
  targetDeviceName?: string;
  /** Target device ID (if known) */
  targetDeviceId?: string;
  /** Who is reporting (user's channel identifier) */
  reportedBy: string;
  /** Channel used to report (/분실신고 in kakao, telegram, etc.) */
  reportChannel: string;
}): Promise<{
  success: boolean;
  /** Confirmation message to show to user */
  confirmationMessage?: string;
  /** Strategy chosen */
  strategy?: WipeStrategy;
  /** Whether the device needs to be selected first */
  needsDeviceSelection?: boolean;
  /** Available devices for selection */
  availableDevices?: Array<{ id: string; name: string; isOnline: boolean }>;
  error?: string;
}> {
  // If no target device specified, we need to list devices
  if (!params.targetDeviceId && !params.targetDeviceName) {
    const { listUserDevices } = await import("../relay/device-auth.js");
    const devices = await listUserDevices(params.userId);

    if (devices.length === 0) {
      return { success: false, error: "등록된 기기가 없습니다." };
    }

    if (devices.length === 1) {
      // Only one device — auto-select it
      params.targetDeviceId = devices[0].id;
      params.targetDeviceName = devices[0].deviceName;
    } else {
      // Multiple devices — ask user to choose
      return {
        success: false,
        needsDeviceSelection: true,
        availableDevices: devices.map((d) => ({
          id: d.id,
          name: d.deviceName,
          isOnline: d.isOnline,
        })),
        error:
          "여러 기기가 등록되어 있습니다. 분실 기기를 지정해주세요:\n" +
          devices
            .map((d, i) => `  ${i + 1}. ${d.deviceName} (${d.isOnline ? "온라인" : "오프라인"})`)
            .join("\n") +
          "\n\n예: /분실신고 " + devices[0].deviceName,
      };
    }
  }

  // Find device by name if ID not provided
  if (!params.targetDeviceId && params.targetDeviceName) {
    const { findDeviceByName } = await import("../relay/device-auth.js");
    const device = await findDeviceByName(params.userId, params.targetDeviceName);
    if (!device) {
      return { success: false, error: `"${params.targetDeviceName}" 기기를 찾을 수 없습니다.` };
    }
    params.targetDeviceId = device.id;
    params.targetDeviceName = device.deviceName;
  }

  // Request the wipe (this handles backup check, token revocation, etc.)
  const result = await requestRemoteWipe({
    userId: params.userId,
    targetDeviceId: params.targetDeviceId!,
    targetDeviceName: params.targetDeviceName!,
    scope: "all",
    requestedBy: params.reportedBy,
    requestChannel: params.reportChannel,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Generate confirmation message
  const confirmationMessage = formatWipeConfirmation({
    deviceName: params.targetDeviceName!,
    scope: "all",
    hasBackup: result.backupVerified ?? false,
    strategy: result.strategy!,
  });

  return {
    success: true,
    confirmationMessage,
    strategy: result.strategy,
  };
}

/**
 * Step 5: Execute wipe on the device (called during device heartbeat).
 *
 * This is the core execution function that runs ON THE DEVICE when it
 * comes back online and finds a pending wipe command.
 *
 * For backup_then_wipe strategy:
 * 1. Perform emergency E2E encrypted backup
 * 2. Verify backup success
 * 3. Then wipe
 */
export async function executeDeviceWipe(params: {
  userId: string;
  deviceId: string;
  wipeCommand: ExtendedWipeCommand;
  /** Security manager instance (for secure wipe operations) */
  securityManager: DeviceSecurityManager;
  /** Paths to DB files on this device */
  dbPaths: string[];
  /** Paths to chat history directories */
  chatDirs: string[];
  /** Paths to credential files */
  credentialPaths: string[];
  /** Function to perform emergency backup (E2E encrypted upload) */
  performEmergencyBackup: () => Promise<{ success: boolean; version?: number; error?: string }>;
  /** Function to notify user through the reporting channel */
  notifyUser: (message: string) => Promise<void>;
}): Promise<{
  success: boolean;
  wipedFiles: number;
  wipedBytes: number;
  backupCompleted: boolean;
  backupVersion?: number;
}> {
  const {
    userId,
    deviceId,
    wipeCommand,
    securityManager,
    dbPaths,
    chatDirs,
    credentialPaths,
    performEmergencyBackup,
    notifyUser,
  } = params;

  let backupCompleted = false;
  let backupVersion: number | undefined;

  // ── Phase 1: Emergency Backup (if needed) ──
  if (wipeCommand.strategy === "backup_then_wipe") {
    await updateWipeBackupStatus({ userId, deviceId, backupStatus: "in_progress" });
    await notifyUser("🔄 분실 기기가 온라인되었습니다. 긴급 백업 진행 중...");

    // Retry backup up to BACKUP_MAX_RETRIES times
    for (let attempt = 1; attempt <= BACKUP_MAX_RETRIES; attempt++) {
      const backupResult = await performEmergencyBackup();

      if (backupResult.success) {
        backupCompleted = true;
        backupVersion = backupResult.version;
        await updateWipeBackupStatus({
          userId,
          deviceId,
          backupStatus: "completed",
          backupVersion,
        });
        await notifyUser(`☁️ 긴급 백업 성공 (버전 ${backupVersion}). 삭제를 시작합니다...`);
        break;
      }

      if (attempt < BACKUP_MAX_RETRIES) {
        await notifyUser(
          `⚠️ 백업 시도 ${attempt}/${BACKUP_MAX_RETRIES} 실패. ${BACKUP_RETRY_DELAY_MS / 1000}초 후 재시도...`,
        );
        await sleep(BACKUP_RETRY_DELAY_MS);
      } else {
        // All retries failed — proceed with wipe anyway (data safety < device security)
        await updateWipeBackupStatus({ userId, deviceId, backupStatus: "failed" });
        await notifyUser(
          "⚠️ 백업 실패 (3회 시도). 보안을 위해 백업 없이 삭제를 진행합니다.\n" +
            "이전 백업이 있다면 그것으로 복구 가능합니다.",
        );
      }
    }
  }

  // ── Phase 2: Secure Wipe ──
  const wipeResult = securityManager.secureWipeAll({
    dbPaths,
    chatDirs,
    credentialPaths,
  });

  // ── Phase 3: Report Results ──
  await markWipeExecuted({
    userId,
    deviceId,
    wipedFiles: wipeResult.wipedFiles,
    wipedBytes: wipeResult.wipedBytes,
    backupCompleted,
    backupVersion,
  });

  // Notify user of completion
  const completionNotice = formatWipeCompletionNotice({
    deviceName: `Device ${deviceId.slice(0, 8)}`,
    wipedFiles: wipeResult.wipedFiles,
    wipedBytes: wipeResult.wipedBytes,
    backupCompleted,
    backupVersion,
  });

  await notifyUser(completionNotice);

  return {
    success: true,
    wipedFiles: wipeResult.wipedFiles,
    wipedBytes: wipeResult.wipedBytes,
    backupCompleted,
    backupVersion,
  };
}

/**
 * Heartbeat integration: check for pending wipe and execute if found.
 *
 * This should be called during the device heartbeat handler.
 * If a wipe is pending, it will:
 * 1. Suspend normal operations
 * 2. Execute the wipe flow (backup if needed, then wipe)
 * 3. Report results
 *
 * Returns true if a wipe was executed (caller should terminate after this).
 */
export async function handleHeartbeatWipeCheck(params: {
  userId: string;
  deviceId: string;
  /** Data directory for security config */
  dataDir: string;
  /** DB file paths */
  dbPaths: string[];
  /** Chat history directories */
  chatDirs: string[];
  /** Credential file paths */
  credentialPaths: string[];
  /** Emergency backup function */
  performEmergencyBackup: () => Promise<{ success: boolean; version?: number; error?: string }>;
  /** User notification function */
  notifyUser: (message: string) => Promise<void>;
}): Promise<{ wipeExecuted: boolean }> {
  const wipeCommand = await checkPendingWipe({
    userId: params.userId,
    deviceId: params.deviceId,
  });

  if (!wipeCommand) {
    return { wipeExecuted: false };
  }

  // Load or create security manager
  const existingConfig = DeviceSecurityManager.loadConfig(params.dataDir);
  const securityManager = new DeviceSecurityManager(params.dataDir, existingConfig ?? undefined);

  await executeDeviceWipe({
    userId: params.userId,
    deviceId: params.deviceId,
    wipeCommand,
    securityManager,
    dbPaths: params.dbPaths,
    chatDirs: params.chatDirs,
    credentialPaths: params.credentialPaths,
    performEmergencyBackup: params.performEmergencyBackup,
    notifyUser: params.notifyUser,
  });

  return { wipeExecuted: true };
}

/**
 * Format the /분실신고 help text.
 */
export function formatLostDeviceHelp(): string {
  return [
    "🔐 분실/절취 기기 관리 (모든 기기 공통)",
    "",
    "📱 휴대폰 · 💻 노트북 · 🖥 데스크톱 · 📱 태블릿 · 🖧 서버",
    "어떤 기기든 동일한 보안이 적용됩니다.",
    "",
    "━━ 명령어 ━━",
    "/분실신고 [기기이름]  — 분실 신고 (원격 삭제 요청)",
    "/분실확인             — 삭제 확인 (실행)",
    "/분실취소             — 삭제 취소",
    "/분실상태             — 삭제 진행 상태 확인",
    "/보안상태             — 전체 기기 보안 상태",
    "",
    "━━ 보안 흐름 ━━",
    "1. /분실신고 → 기기 접근 토큰 즉시 폐기",
    "   (절취자는 MoA 릴레이 접근 불가)",
    "2. 기기 온라인 시 → 자동 백업 → 데이터 삭제",
    "   (3중 덮어쓰기: 0x00 → 0xFF → 랜덤 → 삭제)",
    "3. 새 기기에서 → /동기화 다운로드로 복구",
    "",
    "━━ 예시 ━━",
    "/분실신고 내폰          — 휴대폰 분실 신고",
    "/분실신고 사무실노트북   — 노트북 분실 신고",
    "/분실신고 집PC          — 데스크톱 분실 신고",
    "",
    "💡 백업이 없어도 안전합니다:",
    "   기기가 온라인되면 먼저 백업한 후 삭제합니다.",
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
