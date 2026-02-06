/**
 * Direct Command System (쌍둥이 MoA 직접 호출)
 *
 * 개념: 각 디바이스의 MoA는 독립된 개체이지만 기억(저장장치)을 공유하는 쌍둥이.
 * 사용자는 특정 디바이스의 MoA를 직접 호출하여 명령을 내림.
 * 서버는 단순 메시지 브로커 역할만 수행 (AI 처리 없음).
 *
 * 장점:
 * - 낮은 지연시간 (중간 MoA 없음)
 * - 병렬 명령 가능 (여러 디바이스 동시 호출)
 * - 명확한 개념 (사용자가 직접 지정)
 * - 비용 절감 (AI 호출 1회만)
 * - 강력한 보안 (암호화된 메시지만 전달)
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { findDeviceByName, listUserDevices } from "./device-auth.js";
import { chargeRelayCommand } from "./relay-billing.js";
import {
  sendRelayCommand,
  parseCommandText,
  type SendRelayResult,
} from "./relay-handler.js";

// ============================================
// Multi-Device Parallel Command
// ============================================

export interface MultiDeviceResult {
  /** 전체 성공 여부 (하나라도 실패하면 false) */
  success: boolean;
  /** 각 디바이스별 결과 */
  results: Array<{
    deviceName: string;
    success: boolean;
    commandId?: string;
    confirmationRequired?: boolean;
    safetyWarning?: string;
    error?: string;
  }>;
  /** 성공한 디바이스 수 */
  successCount: number;
  /** 실패한 디바이스 수 */
  failCount: number;
}

/**
 * 여러 디바이스에 동시에 명령을 전송 (병렬 실행)
 *
 * 사용 예:
 * - "@노트북,@태블릿 git pull" → 두 디바이스에 동시에 git pull
 * - "@모두 업데이트" → 모든 온라인 디바이스에 업데이트 명령
 */
export async function sendMultiDeviceCommand(params: {
  userId: string;
  targetDeviceNames: string[]; // ["노트북", "태블릿"] or ["*"] for all
  commandText: string;
  priority?: number;
}): Promise<MultiDeviceResult> {
  const { userId, targetDeviceNames, commandText, priority = 0 } = params;

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      results: [],
      successCount: 0,
      failCount: 1,
    };
  }

  // Handle "@모두" or "*" - send to all online devices
  let deviceNames = targetDeviceNames;
  if (deviceNames.length === 1 && (deviceNames[0] === "*" || deviceNames[0] === "모두" || deviceNames[0] === "all")) {
    const allDevices = await listUserDevices(userId);
    const onlineDevices = allDevices.filter((d) => d.isOnline);
    if (onlineDevices.length === 0) {
      return {
        success: false,
        results: [{ deviceName: "모두", success: false, error: "온라인 상태인 기기가 없습니다." }],
        successCount: 0,
        failCount: 1,
      };
    }
    deviceNames = onlineDevices.map((d) => d.deviceName);
  }

  // Send commands in parallel
  const promises = deviceNames.map((deviceName) =>
    sendRelayCommand({
      userId,
      targetDeviceName: deviceName,
      commandText,
      priority,
    }).then((result) => ({
      deviceName,
      ...result,
    }))
  );

  const results = await Promise.all(promises);

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  return {
    success: failCount === 0,
    results,
    successCount,
    failCount,
  };
}

// ============================================
// Command Parsing for Multi-Device
// ============================================

export interface ParsedDirectCommand {
  /** 대상 디바이스 이름들 */
  targetDevices: string[];
  /** 실행할 명령어 */
  command: string;
  /** 모든 디바이스 대상 여부 */
  isAllDevices: boolean;
}

/**
 * 사용자 입력에서 대상 디바이스와 명령어를 분리
 *
 * 지원 형식:
 * - "@노트북 ls -la" → 단일 디바이스
 * - "@노트북,@태블릿 git pull" → 다중 디바이스 (쉼표 구분)
 * - "@노트북 @태블릿 git pull" → 다중 디바이스 (공백 구분)
 * - "@모두 업데이트" → 모든 온라인 디바이스
 * - "@all df -h" → 모든 온라인 디바이스
 */
export function parseDirectCommand(input: string): ParsedDirectCommand | null {
  const trimmed = input.trim();

  // Must start with @
  if (!trimmed.startsWith("@")) {
    return null;
  }

  // Match all @mentions at the start
  // Pattern: (@디바이스명)+ followed by the command
  const mentionPattern = /^((?:@[\w가-힣]+[\s,]*)+)(.+)$/;
  const match = trimmed.match(mentionPattern);

  if (!match) {
    return null;
  }

  const mentionsPart = match[1];
  const commandPart = match[2].trim();

  // Extract device names from mentions
  const deviceNames = mentionsPart
    .split(/[@,\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.trim());

  if (deviceNames.length === 0 || !commandPart) {
    return null;
  }

  // Check for "all devices" keywords
  const allKeywords = ["모두", "all", "*", "전체", "모든기기"];
  const isAllDevices = deviceNames.length === 1 && allKeywords.includes(deviceNames[0].toLowerCase());

  return {
    targetDevices: isAllDevices ? ["*"] : deviceNames,
    command: commandPart,
    isAllDevices,
  };
}

// ============================================
// Device Status Summary
// ============================================

export interface TwinMoAStatus {
  userId: string;
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  devices: Array<{
    name: string;
    type: string;
    isOnline: boolean;
    lastSeen: Date;
    capabilities: string[];
  }>;
}

/**
 * 사용자의 쌍둥이 MoA 상태 조회
 */
export async function getTwinMoAStatus(userId: string): Promise<TwinMoAStatus> {
  const devices = await listUserDevices(userId);

  const onlineDevices = devices.filter((d) => d.isOnline).length;

  return {
    userId,
    totalDevices: devices.length,
    onlineDevices,
    offlineDevices: devices.length - onlineDevices,
    devices: devices.map((d) => ({
      name: d.deviceName,
      type: d.deviceType,
      isOnline: d.isOnline,
      lastSeen: d.lastHeartbeat,
      capabilities: d.capabilities,
    })),
  };
}

// ============================================
// Format Helpers for KakaoTalk Display
// ============================================

/**
 * 다중 디바이스 명령 결과를 카카오톡 메시지로 포맷
 */
export function formatMultiDeviceResult(result: MultiDeviceResult, command: string): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(`✅ ${result.successCount}개 디바이스에 명령 전송 완료`);
  } else if (result.successCount > 0) {
    lines.push(`⚠️ ${result.successCount}개 성공, ${result.failCount}개 실패`);
  } else {
    lines.push(`❌ 명령 전송 실패`);
  }

  lines.push("");
  lines.push(`📝 명령: ${command.slice(0, 50)}${command.length > 50 ? "..." : ""}`);
  lines.push("");

  for (const r of result.results) {
    if (r.success) {
      if (r.confirmationRequired) {
        lines.push(`🟡 ${r.deviceName}: 확인 필요`);
        if (r.safetyWarning) {
          lines.push(`   ${r.safetyWarning.split("\n")[0]}`);
        }
        lines.push(`   /확인 ${r.commandId?.slice(0, 8)}`);
      } else {
        lines.push(`🟢 ${r.deviceName}: 전송됨 (${r.commandId?.slice(0, 8)})`);
      }
    } else {
      lines.push(`🔴 ${r.deviceName}: ${r.error?.slice(0, 40) ?? "실패"}`);
    }
  }

  return lines.join("\n");
}

/**
 * 쌍둥이 MoA 상태를 카카오톡 메시지로 포맷
 */
export function formatTwinMoAStatus(status: TwinMoAStatus): string {
  const lines: string[] = [];

  lines.push("🤖 나의 쌍둥이 MoA 현황");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`총 ${status.totalDevices}대 | 🟢 온라인 ${status.onlineDevices} | ⚫ 오프라인 ${status.offlineDevices}`);
  lines.push("");

  if (status.devices.length === 0) {
    lines.push("등록된 기기가 없습니다.");
    lines.push("기기에서 moltbot을 실행하고 /기기등록 명령으로 등록하세요.");
  } else {
    for (const d of status.devices) {
      const icon = d.isOnline ? "🟢" : "⚫";
      const typeIcon = getDeviceTypeIcon(d.type);
      lines.push(`${icon} ${typeIcon} ${d.name}`);

      if (d.isOnline) {
        lines.push(`   사용 가능: @${d.name} <명령>`);
      } else {
        const ago = formatTimeAgo(d.lastSeen);
        lines.push(`   마지막 접속: ${ago}`);
      }
    }
  }

  lines.push("");
  lines.push("💡 사용법:");
  lines.push("• @노트북 ls -la (단일 디바이스)");
  lines.push("• @노트북,@태블릿 git pull (다중)");
  lines.push("• @모두 df -h (모든 온라인 기기)");

  return lines.join("\n");
}

function getDeviceTypeIcon(type: string): string {
  switch (type) {
    case "desktop":
    case "laptop":
      return "💻";
    case "phone":
    case "mobile":
      return "📱";
    case "tablet":
      return "📱";
    case "server":
      return "🖥️";
    case "raspberry_pi":
      return "🍓";
    default:
      return "🖥️";
  }
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}일 전`;
}
