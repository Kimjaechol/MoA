/**
 * Lost Device Handler — Full orchestrator for lost/stolen phone security
 *
 * 이 파일은 분실 기기 보안의 전체 흐름을 관장하는 오케스트레이터입니다.
 *
 * === 핵심 원칙 ===
 *
 * GPS 추적과 데이터 삭제는 동시에 시작되지만,
 * 데이터 삭제 후에도 GPS 추적은 계속됩니다.
 *
 * MoA 데이터 외에도 문자, 카톡, 사진, 이메일, 금융앱 등
 * 중요한 개인정보가 기기에 남아있으므로 반드시 회수해야 합니다.
 * 절취범이 MoA 앱을 찾아 삭제하지 않는 한,
 * GPS 좌표는 72시간까지 계속 서버로 전송됩니다.
 *
 * === 전체 보안 흐름 ===
 *
 * 1. 사용자가 /분실신고 입력 (어떤 채널에서든)
 *    ↓
 * 2. reportLostDevice() 호출 — 삭제 + GPS 추적 동시 시작
 *    ├─ 대상 기기 식별 (이름 또는 자동 선택)
 *    ├─ [동시 실행 A] 원격 삭제 요청
 *    │   ├─ 클라우드 백업 상태 확인
 *    │   ├─ 전략 결정: immediate | backup_then_wipe
 *    │   ├─ 기기 토큰 즉시 폐기 → 절취자 relay 접근 차단
 *    │   └─ wipe 명령 큐잉
 *    ├─ [동시 실행 B] GPS 추적 활성화
 *    │   ├─ Supabase에 tracking session 생성
 *    │   └─ 30초 간격, 고정밀 모드, 72시간 만료
 *    └─ 사용자에게 확인 메시지 전송
 *    ↓
 * 3. [기기가 온라인 되는 순간]
 *    ├─ GPS 추적 시작 (30초마다 좌표 전송)
 *    ├─ 삭제 직전 GPS 좌표 전송
 *    ├─ secureWipeAll() 실행 (MoA 데이터만 3중 덮어쓰기)
 *    ├─ wipe 결과 보고
 *    └─ GPS 추적은 계속! (MoA 앱은 살아있으므로)
 *    ↓
 * 4. [사용자가 /기기위치로 실시간 위치 확인 → 기기 회수]
 *    ↓
 * 5. [기기 회수 후] /추적종료 — GPS 추적 종료
 *    ↓
 * 6. [새 기기에서]
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
import {
  activateLocationTracking,
  reportDeviceLocation,
  formatTrackingActivated,
  type GpsCoordinate,
} from "./device-location-tracker.js";
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
  /** GPS 추적 세션 ID (추적 활성화 시) */
  trackingSessionId?: string;
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

  // ━━ 동시 실행: 원격 삭제 요청 + GPS 추적 활성화 ━━
  const [wipeResult, trackingResult] = await Promise.all([
    // 1) 원격 삭제 요청 (백업 확인, 토큰 폐기, 명령 큐잉)
    requestRemoteWipe({
      userId: params.userId,
      targetDeviceId: params.targetDeviceId!,
      targetDeviceName: params.targetDeviceName!,
      scope: "all",
      requestedBy: params.reportedBy,
      requestChannel: params.reportChannel,
    }),
    // 2) GPS 실시간 추적 활성화 (분실 기기 회수용)
    activateLocationTracking({
      userId: params.userId,
      deviceId: params.targetDeviceId!,
      deviceName: params.targetDeviceName!,
      config: {
        intervalSec: 30,
        highAccuracy: true,
        expirationHours: 72,
      },
    }),
  ]);

  if (!wipeResult.success) {
    return { success: false, error: wipeResult.error };
  }

  // wipe 명령 ID를 추적 세션에 연결
  if (trackingResult.success && trackingResult.sessionId && wipeResult.wipeId) {
    // 비동기 업데이트 (실패해도 무시)
    activateLocationTracking({
      userId: params.userId,
      deviceId: params.targetDeviceId!,
      deviceName: params.targetDeviceName!,
      wipeCommandId: wipeResult.wipeId,
    }).catch(() => {});
  }

  // 확인 메시지 = 삭제 안내 + GPS 추적 안내
  const wipeConfirmation = formatWipeConfirmation({
    deviceName: params.targetDeviceName!,
    scope: "all",
    hasBackup: wipeResult.backupVerified ?? false,
    strategy: wipeResult.strategy!,
  });

  const trackingNotice = trackingResult.success
    ? "\n\n" + formatTrackingActivated({
        deviceName: params.targetDeviceName!,
        intervalSec: 30,
        expiresInHours: 72,
      })
    : "";

  const confirmationMessage = wipeConfirmation + trackingNotice;

  return {
    success: true,
    confirmationMessage,
    strategy: wipeResult.strategy,
    trackingSessionId: trackingResult.sessionId,
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
 * 3. Then wipe MoA data (DB, chat, credentials)
 *
 * 중요: wipe는 MoA 데이터만 삭제합니다. MoA 앱 자체는 유지됩니다.
 * GPS 추적은 wipe 후에도 계속됩니다 (기기 회수를 위해).
 * 추적 종료는 사용자가 /추적종료 또는 72시간 만료 시에만.
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
  /** Function to get current GPS coordinates (for last-known-location before wipe) */
  getCurrentLocation?: () => Promise<GpsCoordinate | null>;
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

  // ── Phase 1.5: 삭제 직전 GPS 좌표 전송 ──
  if (params.getCurrentLocation) {
    try {
      const lastCoord = await params.getCurrentLocation();
      if (lastCoord) {
        await reportDeviceLocation({
          userId,
          deviceId,
          coordinate: lastCoord,
        });
        await notifyUser(
          `📍 삭제 직전 위치: ${lastCoord.latitude.toFixed(5)}, ${lastCoord.longitude.toFixed(5)}\nhttps://map.kakao.com/?q=${lastCoord.latitude},${lastCoord.longitude}`,
        );
      }
    } catch {
      // 위치 수집 실패해도 삭제는 계속 진행
    }
  }

  // ── Phase 2: Secure Wipe (MoA 데이터만 삭제 — 앱 자체는 유지) ──
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

  // ── Phase 3.5: GPS 추적은 계속됨 (삭제 완료 후에도!) ──
  // MoA 데이터는 삭제되었지만, 기기에는 문자/카톡/사진/이메일 등
  // 중요한 개인 데이터가 남아있으므로 기기 회수를 위해 GPS 추적 지속.
  // 추적 종료: 사용자가 /추적종료 또는 72시간 만료 시에만.

  // Notify user of completion + tracking continues
  const completionNotice = formatWipeCompletionNotice({
    deviceName: `Device ${deviceId.slice(0, 8)}`,
    wipedFiles: wipeResult.wipedFiles,
    wipedBytes: wipeResult.wipedBytes,
    backupCompleted,
    backupVersion,
  });

  const trackingContinuesNotice = [
    "",
    "📡 GPS 추적은 계속됩니다!",
    "MoA 데이터는 삭제되었지만, 기기의 문자/카톡/사진 등",
    "중요 데이터가 남아있으므로 회수를 위해 위치 추적을 유지합니다.",
    "",
    "📍 /기기위치 — 현재 위치 확인",
    "📍 /분실추적 — 이동 경로 확인",
    "⏹️ /추적종료 — 기기 회수 후 추적 종료",
  ].join("\n");

  await notifyUser(completionNotice + trackingContinuesNotice);

  return {
    success: true,
    wipedFiles: wipeResult.wipedFiles,
    wipedBytes: wipeResult.wipedBytes,
    backupCompleted,
    backupVersion,
  };
}

/**
 * Heartbeat integration: check for pending wipe and/or active GPS tracking.
 *
 * 이 함수는 기기의 heartbeat 핸들러에서 호출됩니다.
 *
 * 중요: wipe와 GPS 추적은 독립적으로 처리됩니다.
 * - wipe가 대기 중이면: 백업 → 삭제 실행
 * - GPS 추적이 활성이면: 위치 수집 및 전송 (wipe 여부 무관)
 * - 둘 다 해당하면: 둘 다 실행 (삭제 후에도 GPS 계속)
 *
 * wipe 후에도 이 함수는 계속 호출될 수 있으며,
 * GPS 추적은 사용자가 /추적종료 하거나 72시간 만료될 때까지 유지됩니다.
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
  /** GPS location getter — wipe 전 마지막 위치 전송 + 추적 모드에서 주기적 전송 */
  getCurrentLocation?: () => Promise<GpsCoordinate | null>;
}): Promise<{
  wipeExecuted: boolean;
  /** GPS 추적이 활성 상태인지 (true면 caller는 GPS 수집을 계속해야 함) */
  trackingActive: boolean;
  /** 추적 세션 설정 (caller가 GPS 수집 간격/정밀도 조정용) */
  trackingConfig?: {
    sessionId: string;
    intervalSec: number;
    highAccuracy: boolean;
  };
}> {
  const { checkActiveTracking } = await import("./device-location-tracker.js");

  // ── 1. wipe 대기 명령 확인 및 실행 ──
  let wipeExecuted = false;
  const wipeCommand = await checkPendingWipe({
    userId: params.userId,
    deviceId: params.deviceId,
  });

  if (wipeCommand) {
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
      getCurrentLocation: params.getCurrentLocation,
    });

    wipeExecuted = true;
  }

  // ── 2. GPS 추적 상태 확인 (wipe 완료 여부 무관!) ──
  // wipe가 끝나도 추적 세션은 살아있으므로 GPS를 계속 보내야 함
  const tracking = await checkActiveTracking({
    userId: params.userId,
    deviceId: params.deviceId,
  });

  // GPS 좌표 전송 (추적 활성 && 위치 함수가 있으면)
  if (tracking.tracking && params.getCurrentLocation) {
    try {
      const coord = await params.getCurrentLocation();
      if (coord) {
        await reportDeviceLocation({
          userId: params.userId,
          deviceId: params.deviceId,
          coordinate: coord,
        });
      }
    } catch {
      // GPS 실패해도 heartbeat는 계속
    }
  }

  return {
    wipeExecuted,
    trackingActive: tracking.tracking,
    trackingConfig: tracking.tracking
      ? {
          sessionId: tracking.sessionId!,
          intervalSec: tracking.intervalSec!,
          highAccuracy: tracking.highAccuracy!,
        }
      : undefined,
  };
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
    "━━ 분실 관리 명령어 ━━",
    "/분실신고 [기기이름]  — 분실 신고 (원격 삭제 + GPS 추적 동시 시작)",
    "/분실확인             — 삭제 확인 (실행)",
    "/분실취소             — 삭제 취소",
    "/분실상태             — 삭제 진행 상태 확인",
    "/보안상태             — 전체 기기 보안 상태",
    "",
    "━━ GPS 추적 명령어 ━━",
    "/기기위치             — 분실 기기 최신 GPS 좌표 + 지도 링크",
    "/분실추적             — 기기 이동 경로 (위치 이력)",
    "/추적상태             — GPS 추적 활성 상태 확인",
    "/추적종료             — GPS 추적 종료",
    "",
    "━━ 보안 흐름 ━━",
    "1. /분실신고 → 기기 접근 토큰 즉시 폐기 + GPS 추적 활성화",
    "   (절취자는 MoA 릴레이 접근 불가)",
    "   (기기 위치는 30초마다 서버로 전송)",
    "2. 기기 온라인 시 → GPS 추적 시작 + 자동 백업 → MoA 데이터 삭제",
    "   (3중 덮어쓰기: 0x00 → 0xFF → 랜덤 → 삭제)",
    "3. 삭제 후에도 GPS 추적 계속!",
    "   (문자, 카톡, 사진 등 중요 데이터가 남아있으므로 회수 필수)",
    "   (MoA 앱이 기기에 있는 한 위치 계속 전송)",
    "4. /기기위치로 실시간 위치 확인 → 기기 회수",
    "5. 기기 회수 후 /추적종료",
    "6. 새 기기에서 → /동기화 다운로드로 복구",
    "",
    "━━ 예시 ━━",
    "/분실신고 내폰          — 휴대폰 분실 신고",
    "/분실신고 사무실노트북   — 노트북 분실 신고",
    "/기기위치 내폰          — 분실 폰 현재 위치 확인",
    "",
    "💡 백업이 없어도 안전합니다:",
    "   기기가 온라인되면 먼저 백업한 후 삭제합니다.",
    "",
    "📡 GPS 추적은 72시간 후 자동 만료됩니다.",
    "   위치 데이터는 30일간 보관됩니다.",
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
