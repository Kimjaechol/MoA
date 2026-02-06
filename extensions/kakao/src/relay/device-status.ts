/**
 * 실시간 디바이스 상태 모니터링
 *
 * 기능:
 * - 디바이스 온라인/오프라인 상태 실시간 추적
 * - 연결 품질 모니터링 (지연시간, 안정성)
 * - 디바이스 활동 로그
 * - 알림 시스템 (디바이스 연결/해제 알림)
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

// ============================================
// Types
// ============================================

export interface DeviceStatus {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  platform: string | null;
  /** 온라인 여부 */
  isOnline: boolean;
  /** 연결 상태 */
  connectionState: "connected" | "connecting" | "disconnected" | "unstable";
  /** 마지막 heartbeat 시간 */
  lastHeartbeat: Date | null;
  /** 마지막 활동 시간 */
  lastActivity: Date | null;
  /** 평균 응답 시간 (ms) */
  avgResponseTime: number | null;
  /** 연결 안정성 (0-100) */
  stability: number;
  /** 현재 실행 중인 명령 수 */
  activeCommands: number;
  /** 오늘 실행한 명령 수 */
  todayCommands: number;
  /** 기능 목록 */
  capabilities: string[];
}

export interface DeviceActivity {
  deviceId: string;
  type: "connect" | "disconnect" | "command_start" | "command_end" | "heartbeat" | "error";
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ConnectionAlert {
  deviceId: string;
  deviceName: string;
  alertType: "connected" | "disconnected" | "unstable" | "recovered";
  message: string;
  timestamp: Date;
}

// ============================================
// Device Status Queries
// ============================================

/**
 * 사용자의 모든 디바이스 상태 조회 (상세)
 */
export async function getDetailedDeviceStatus(userId: string): Promise<DeviceStatus[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  // 디바이스 기본 정보
  const { data: devices, error } = await supabase
    .from("relay_devices")
    .select("*")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });

  if (error || !devices) return [];

  // 각 디바이스의 활동 정보 조회
  const deviceStatuses: DeviceStatus[] = [];

  for (const device of devices) {
    // 오늘 명령 수
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from("relay_commands")
      .select("id", { count: "exact", head: true })
      .eq("target_device_id", device.id)
      .gte("created_at", today.toISOString());

    // 현재 실행 중인 명령 수
    const { count: activeCount } = await supabase
      .from("relay_commands")
      .select("id", { count: "exact", head: true })
      .eq("target_device_id", device.id)
      .in("status", ["pending", "delivered", "executing"]);

    // 연결 상태 계산
    const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
    const connectionState = calculateConnectionState(device.is_online, lastSeen);
    const stability = calculateStability(lastSeen, device.is_online);

    deviceStatuses.push({
      deviceId: device.id,
      deviceName: device.device_name,
      deviceType: device.device_type,
      platform: device.platform,
      isOnline: device.is_online,
      connectionState,
      lastHeartbeat: lastSeen,
      lastActivity: lastSeen, // TODO: 별도 추적
      avgResponseTime: null, // TODO: 평균 응답 시간 계산
      stability,
      activeCommands: activeCount ?? 0,
      todayCommands: todayCount ?? 0,
      capabilities: device.capabilities ?? [],
    });
  }

  return deviceStatuses;
}

/**
 * 특정 디바이스의 상세 상태
 */
export async function getDeviceStatusById(
  userId: string,
  deviceId: string
): Promise<DeviceStatus | null> {
  const allStatuses = await getDetailedDeviceStatus(userId);
  return allStatuses.find((d) => d.deviceId === deviceId) ?? null;
}

/**
 * 온라인 디바이스만 조회
 */
export async function getOnlineDevices(userId: string): Promise<DeviceStatus[]> {
  const allStatuses = await getDetailedDeviceStatus(userId);
  return allStatuses.filter((d) => d.isOnline);
}

// ============================================
// Connection State Calculation
// ============================================

function calculateConnectionState(
  isOnline: boolean,
  lastSeen: Date | null
): DeviceStatus["connectionState"] {
  if (!isOnline) return "disconnected";

  if (!lastSeen) return "connecting";

  const now = new Date();
  const diffMs = now.getTime() - lastSeen.getTime();
  const diffMins = diffMs / 60000;

  // 30초 이내: connected
  // 30초~2분: connecting (약간 지연)
  // 2분~5분: unstable
  // 5분 이상: disconnected (is_online이 false가 됨)

  if (diffMins < 0.5) return "connected";
  if (diffMins < 2) return "connecting";
  return "unstable";
}

function calculateStability(lastSeen: Date | null, isOnline: boolean): number {
  if (!isOnline || !lastSeen) return 0;

  const now = new Date();
  const diffMs = now.getTime() - lastSeen.getTime();
  const diffMins = diffMs / 60000;

  // 최근 heartbeat 기준 안정성 점수
  // 30초 이내: 100점
  // 1분: 80점
  // 2분: 50점
  // 3분: 20점
  // 4분 이상: 0점

  if (diffMins < 0.5) return 100;
  if (diffMins < 1) return 80;
  if (diffMins < 2) return 50;
  if (diffMins < 3) return 20;
  return 0;
}

// ============================================
// Activity Logging
// ============================================

/**
 * 디바이스 활동 로그 기록
 */
export async function logDeviceActivity(
  deviceId: string,
  activity: Omit<DeviceActivity, "deviceId" | "timestamp">
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();

  await supabase.from("moa_device_activity").insert({
    device_id: deviceId,
    type: activity.type,
    message: activity.message,
    metadata: activity.metadata ?? {},
    created_at: new Date().toISOString(),
  });
}

/**
 * 디바이스 활동 로그 조회
 */
export async function getDeviceActivityLog(
  deviceId: string,
  limit = 20
): Promise<DeviceActivity[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("moa_device_activity")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    deviceId: row.device_id,
    type: row.type as DeviceActivity["type"],
    message: row.message,
    timestamp: new Date(row.created_at),
    metadata: row.metadata as Record<string, unknown> | undefined,
  }));
}

// ============================================
// Connection Alerts
// ============================================

/**
 * 연결 알림 확인 (새로운 연결/해제)
 */
export async function checkConnectionAlerts(
  userId: string,
  since?: Date
): Promise<ConnectionAlert[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const sinceTime = since ?? new Date(Date.now() - 5 * 60 * 1000); // 기본 5분

  // 연결/해제 이벤트 조회
  const { data, error } = await supabase
    .from("moa_device_activity")
    .select("device_id, type, message, created_at, relay_devices!inner(device_name, user_id)")
    .in("type", ["connect", "disconnect"])
    .gte("created_at", sinceTime.toISOString())
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data
    .filter((row) => {
      const deviceData = row.relay_devices as unknown as { user_id: string };
      return deviceData.user_id === userId;
    })
    .map((row) => {
      const deviceData = row.relay_devices as unknown as { device_name: string };
      return {
        deviceId: row.device_id,
        deviceName: deviceData.device_name,
        alertType: row.type === "connect" ? "connected" : "disconnected",
        message: row.message,
        timestamp: new Date(row.created_at),
      } as ConnectionAlert;
    });
}

// ============================================
// Format Helpers
// ============================================

/**
 * 디바이스 상태 요약 (카카오톡용)
 */
export function formatDeviceStatusSummary(devices: DeviceStatus[]): string {
  const lines: string[] = [];

  const online = devices.filter((d) => d.isOnline);
  const offline = devices.filter((d) => !d.isOnline);

  lines.push("📡 **실시간 디바이스 상태**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`총 ${devices.length}대 | 🟢 온라인 ${online.length} | ⚫ 오프라인 ${offline.length}`);
  lines.push("");

  // 온라인 디바이스
  if (online.length > 0) {
    lines.push("**🟢 온라인**");
    for (const d of online) {
      const stateIcon = getConnectionStateIcon(d.connectionState);
      const stabilityBar = getStabilityBar(d.stability);
      lines.push(`${stateIcon} ${getDeviceIcon(d.deviceType)} **${d.deviceName}**`);
      lines.push(`   안정성: ${stabilityBar} ${d.stability}%`);
      if (d.activeCommands > 0) {
        lines.push(`   실행 중: ${d.activeCommands}개 명령`);
      }
      lines.push(`   오늘 명령: ${d.todayCommands}회`);
    }
  }

  // 오프라인 디바이스
  if (offline.length > 0) {
    lines.push("");
    lines.push("**⚫ 오프라인**");
    for (const d of offline) {
      const lastSeen = d.lastHeartbeat ? formatTimeAgo(d.lastHeartbeat) : "접속 기록 없음";
      lines.push(`⚫ ${getDeviceIcon(d.deviceType)} ${d.deviceName}`);
      lines.push(`   마지막 접속: ${lastSeen}`);
    }
  }

  lines.push("");
  lines.push("💡 명령: @기기명 <명령>");

  return lines.join("\n");
}

/**
 * 단일 디바이스 상세 상태
 */
export function formatDeviceStatusDetail(device: DeviceStatus): string {
  const lines: string[] = [];

  const stateIcon = device.isOnline ? "🟢" : "⚫";
  const stateText = device.isOnline ? "온라인" : "오프라인";

  lines.push(`${stateIcon} **${device.deviceName}** (${stateText})`);
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");

  lines.push(`📱 타입: ${device.deviceType}`);
  lines.push(`💻 플랫폼: ${device.platform ?? "알 수 없음"}`);

  if (device.isOnline) {
    lines.push("");
    lines.push("**연결 상태**");
    lines.push(`   상태: ${getConnectionStateText(device.connectionState)}`);
    lines.push(`   안정성: ${getStabilityBar(device.stability)} ${device.stability}%`);
    if (device.avgResponseTime) {
      lines.push(`   응답시간: ${device.avgResponseTime}ms`);
    }
  }

  lines.push("");
  lines.push("**활동**");
  lines.push(`   실행 중: ${device.activeCommands}개 명령`);
  lines.push(`   오늘 명령: ${device.todayCommands}회`);

  if (device.lastHeartbeat) {
    lines.push(`   마지막 통신: ${formatTimeAgo(device.lastHeartbeat)}`);
  }

  if (device.capabilities.length > 0) {
    lines.push("");
    lines.push("**기능**");
    lines.push(`   ${device.capabilities.join(", ")}`);
  }

  return lines.join("\n");
}

function getConnectionStateIcon(state: DeviceStatus["connectionState"]): string {
  switch (state) {
    case "connected":
      return "🟢";
    case "connecting":
      return "🟡";
    case "unstable":
      return "🟠";
    case "disconnected":
      return "⚫";
  }
}

function getConnectionStateText(state: DeviceStatus["connectionState"]): string {
  switch (state) {
    case "connected":
      return "연결됨 ✅";
    case "connecting":
      return "연결 중... 🔄";
    case "unstable":
      return "불안정 ⚠️";
    case "disconnected":
      return "연결 끊김 ❌";
  }
}

function getDeviceIcon(type: string): string {
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

function getStabilityBar(stability: number): string {
  const filled = Math.round(stability / 20);
  const empty = 5 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return `${diffSecs}초 전`;

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}분 전`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}일 전`;
}
