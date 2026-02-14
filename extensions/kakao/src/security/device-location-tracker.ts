/**
 * Device Location Tracker — 분실 기기 실시간 GPS 추적
 *
 * 분실 신고 시 원격 삭제와 **동시에** GPS 좌표를 실시간으로 서버에 전송하여
 * 분실 기기를 회수할 수 있게 합니다.
 *
 * === 핵심 흐름 ===
 *
 * 1. 사용자가 /분실신고 입력
 *    ↓ (remote-wipe와 병렬 실행)
 * 2. activateLocationTracking() — GPS 추적 활성화 명령 큐잉
 *    ├─ Supabase에 tracking session 생성
 *    ├─ 기기에 "location_tracking" 명령 전달
 *    └─ 추적 간격: 기본 30초 (배터리 절약 모드: 60초)
 *    ↓
 * 3. 기기가 온라인 되면:
 *    ├─ heartbeat에서 추적 명령 감지
 *    ├─ GPS 수집 시작 (고정밀 모드)
 *    ├─ 30초마다 서버로 좌표 전송
 *    └─ wipe 완료 시까지 계속 전송 (wipe 직전 마지막 좌표 전송)
 *    ↓
 * 4. 사용자가 /기기위치 또는 /분실추적 입력
 *    ├─ 최신 GPS 좌표 + 지도 링크 표시
 *    ├─ 위치 이력 (경로) 표시
 *    └─ 마지막 업데이트 시간 표시
 *    ↓
 * 5. wipe 완료 후 또는 /추적종료
 *    └─ 추적 세션 종료
 *
 * === 보안 ===
 * - GPS 좌표는 서버(Supabase)에만 저장 (기기에 남지 않음)
 * - 추적 명령은 wipe 전용 토큰으로만 인증 가능
 * - 세션 만료: 기본 72시간 (3일) 후 자동 종료
 * - 위치 데이터는 30일 후 자동 삭제
 */

import { randomUUID } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";

// ============================================
// Types
// ============================================

/** GPS 좌표 */
export interface GpsCoordinate {
  /** 위도 (-90 ~ 90) */
  latitude: number;
  /** 경도 (-180 ~ 180) */
  longitude: number;
  /** 정확도 (미터 단위) */
  accuracy: number;
  /** 고도 (미터, 선택) */
  altitude?: number;
  /** 속도 (m/s, 선택) */
  speed?: number;
  /** 방향 (degrees, 0-360, 선택) */
  bearing?: number;
  /** 측정 시각 (ISO 8601) */
  timestamp: string;
  /** 위치 제공자 (gps, network, fused) */
  provider?: "gps" | "network" | "fused";
}

/** 위치 추적 세션 */
export interface LocationTrackingSession {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  /** 추적 상태 */
  status: "active" | "paused" | "completed" | "expired";
  /** 추적 간격 (초) */
  intervalSec: number;
  /** 마지막 수신 좌표 */
  lastLocation?: GpsCoordinate;
  /** 총 수신 좌표 수 */
  totalPoints: number;
  /** 세션 시작 시각 */
  startedAt: string;
  /** 세션 만료 시각 */
  expiresAt: string;
  /** 세션 종료 시각 */
  endedAt?: string;
  /** 연결된 wipe 명령 ID */
  wipeCommandId?: string;
}

/** 위치 기록 항목 */
export interface LocationEntry {
  id: string;
  sessionId: string;
  coordinate: GpsCoordinate;
  /** 배터리 잔량 (%, 선택) */
  batteryLevel?: number;
  /** 네트워크 상태 (wifi, cellular, none) */
  networkType?: "wifi" | "cellular" | "none";
  /** 기기가 이동 중인지 */
  isMoving?: boolean;
  createdAt: string;
}

/** 추적 설정 */
export interface TrackingConfig {
  /** 추적 간격 (초, 기본 30) */
  intervalSec?: number;
  /** 고정밀 GPS 모드 (기본 true) */
  highAccuracy?: boolean;
  /** 세션 만료 시간 (시간 단위, 기본 72) */
  expirationHours?: number;
  /** 배터리 절약 모드 (true면 간격 2배) */
  batterySaver?: boolean;
}

// 기본값
const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_EXPIRATION_HOURS = 72; // 3일
const BATTERY_SAVER_MULTIPLIER = 2;
const LOCATION_RETENTION_DAYS = 30;

// ============================================
// 추적 세션 관리
// ============================================

/**
 * GPS 추적 활성화
 *
 * 분실 신고 시 호출됨. remote wipe와 동시에 실행.
 * Supabase에 추적 세션을 생성하고, 기기에 추적 명령을 큐잉합니다.
 */
export async function activateLocationTracking(params: {
  userId: string;
  deviceId: string;
  deviceName: string;
  /** 연결된 wipe 명령 ID (있으면) */
  wipeCommandId?: string;
  config?: TrackingConfig;
}): Promise<{
  success: boolean;
  sessionId?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // 이미 활성 추적 세션이 있는지 확인
  const { data: existing } = await supabase
    .from("device_location_sessions")
    .select("id")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .eq("status", "active")
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      success: true,
      sessionId: existing[0].id,
      error: "이미 추적 중인 세션이 있습니다.",
    };
  }

  const intervalSec = params.config?.batterySaver
    ? (params.config?.intervalSec ?? DEFAULT_INTERVAL_SEC) * BATTERY_SAVER_MULTIPLIER
    : (params.config?.intervalSec ?? DEFAULT_INTERVAL_SEC);

  const expirationHours = params.config?.expirationHours ?? DEFAULT_EXPIRATION_HOURS;

  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expirationHours * 60 * 60 * 1000);

  const { error } = await supabase.from("device_location_sessions").insert({
    id: sessionId,
    user_id: params.userId,
    device_id: params.deviceId,
    device_name: params.deviceName,
    status: "active",
    interval_sec: intervalSec,
    high_accuracy: params.config?.highAccuracy ?? true,
    total_points: 0,
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    wipe_command_id: params.wipeCommandId ?? null,
  });

  if (error) {
    return { success: false, error: `추적 세션 생성 실패: ${error.message}` };
  }

  return { success: true, sessionId };
}

/**
 * 기기에서 GPS 좌표 수신
 *
 * 기기가 30초마다 호출하여 현재 위치를 서버에 전송합니다.
 * wipe 전용 토큰으로 인증됩니다.
 */
export async function reportDeviceLocation(params: {
  userId: string;
  deviceId: string;
  coordinate: GpsCoordinate;
  batteryLevel?: number;
  networkType?: "wifi" | "cellular" | "none";
  isMoving?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // 활성 추적 세션 확인
  const { data: session } = await supabase
    .from("device_location_sessions")
    .select("id, status, expires_at")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .eq("status", "active")
    .limit(1);

  if (!session || session.length === 0) {
    return { success: false, error: "활성 추적 세션이 없습니다." };
  }

  const trackingSession = session[0];

  // 만료 체크
  if (new Date(trackingSession.expires_at) < new Date()) {
    await supabase
      .from("device_location_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString() })
      .eq("id", trackingSession.id);
    return { success: false, error: "추적 세션이 만료되었습니다." };
  }

  // 위치 기록 저장
  const entryId = randomUUID();
  const { error: insertError } = await supabase.from("device_location_entries").insert({
    id: entryId,
    session_id: trackingSession.id,
    latitude: params.coordinate.latitude,
    longitude: params.coordinate.longitude,
    accuracy: params.coordinate.accuracy,
    altitude: params.coordinate.altitude ?? null,
    speed: params.coordinate.speed ?? null,
    bearing: params.coordinate.bearing ?? null,
    provider: params.coordinate.provider ?? "fused",
    battery_level: params.batteryLevel ?? null,
    network_type: params.networkType ?? null,
    is_moving: params.isMoving ?? null,
    measured_at: params.coordinate.timestamp,
    created_at: new Date().toISOString(),
  });

  if (insertError) {
    return { success: false, error: `위치 저장 실패: ${insertError.message}` };
  }

  // 세션의 최신 위치 + 카운터 업데이트
  await supabase
    .from("device_location_sessions")
    .update({
      last_latitude: params.coordinate.latitude,
      last_longitude: params.coordinate.longitude,
      last_accuracy: params.coordinate.accuracy,
      last_location_at: params.coordinate.timestamp,
      total_points: (trackingSession as { total_points?: number }).total_points
        ? Number((trackingSession as { total_points?: number }).total_points) + 1
        : 1,
    })
    .eq("id", trackingSession.id);

  return { success: true };
}

/**
 * 추적 세션 종료
 */
export async function deactivateLocationTracking(params: {
  userId: string;
  deviceId: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("device_location_sessions")
    .update({ status: "completed", ended_at: now })
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .eq("status", "active")
    .select("id");

  if (error || !data || data.length === 0) {
    return { success: false, error: "활성 추적 세션이 없습니다." };
  }

  return { success: true };
}

// ============================================
// 위치 조회
// ============================================

/**
 * 기기의 최신 위치 조회
 */
export async function getLatestLocation(params: {
  userId: string;
  deviceId: string;
}): Promise<{
  location?: GpsCoordinate;
  session?: LocationTrackingSession;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // 최신 활성 세션 조회
  const { data: sessions } = await supabase
    .from("device_location_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .in("status", ["active", "completed"])
    .order("started_at", { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    return { error: "추적 세션이 없습니다." };
  }

  const session = sessions[0];

  if (!session.last_latitude || !session.last_longitude) {
    return {
      session: mapSessionRow(session),
      error: "아직 위치 데이터가 수신되지 않았습니다. 기기가 온라인 되면 위치가 업데이트됩니다.",
    };
  }

  return {
    location: {
      latitude: session.last_latitude,
      longitude: session.last_longitude,
      accuracy: session.last_accuracy ?? 0,
      timestamp: session.last_location_at,
    },
    session: mapSessionRow(session),
  };
}

/**
 * 기기의 위치 이력 조회 (경로 추적용)
 */
export async function getLocationHistory(params: {
  userId: string;
  deviceId: string;
  /** 최근 N건 (기본 50) */
  limit?: number;
  /** 특정 시간 이후만 (ISO 8601) */
  since?: string;
}): Promise<{
  entries: LocationEntry[];
  session?: LocationTrackingSession;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { entries: [], error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // 최신 세션 찾기
  const { data: sessions } = await supabase
    .from("device_location_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .in("status", ["active", "completed"])
    .order("started_at", { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    return { entries: [], error: "추적 세션이 없습니다." };
  }

  const session = sessions[0];

  // 위치 이력 조회
  let query = supabase
    .from("device_location_entries")
    .select("*")
    .eq("session_id", session.id)
    .order("measured_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (params.since) {
    query = query.gte("measured_at", params.since);
  }

  const { data: entries } = await query;

  return {
    entries: (entries ?? []).map(mapEntryRow),
    session: mapSessionRow(session),
  };
}

/**
 * 사용자의 모든 기기 추적 상태 조회
 */
export async function getAllTrackingSessions(
  userId: string,
): Promise<LocationTrackingSession[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  const { data } = await supabase
    .from("device_location_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(20);

  return (data ?? []).map(mapSessionRow);
}

/**
 * Heartbeat에서 활성 추적 명령 확인
 *
 * 기기가 heartbeat 시 호출하여 GPS 추적이 활성화되어 있는지 확인합니다.
 * 활성이면 기기는 GPS 수집을 시작합니다.
 */
export async function checkActiveTracking(params: {
  userId: string;
  deviceId: string;
}): Promise<{
  tracking: boolean;
  sessionId?: string;
  intervalSec?: number;
  highAccuracy?: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { tracking: false };
  }

  const supabase = getSupabase();

  const { data } = await supabase
    .from("device_location_sessions")
    .select("id, interval_sec, high_accuracy, expires_at")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .eq("status", "active")
    .limit(1);

  if (!data || data.length === 0) {
    return { tracking: false };
  }

  const session = data[0];

  // 만료 체크
  if (new Date(session.expires_at) < new Date()) {
    await supabase
      .from("device_location_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString() })
      .eq("id", session.id);
    return { tracking: false };
  }

  return {
    tracking: true,
    sessionId: session.id,
    intervalSec: session.interval_sec,
    highAccuracy: session.high_accuracy,
  };
}

/**
 * 만료된 세션 자동 정리 + 오래된 위치 데이터 삭제
 */
export async function cleanupExpiredTrackingData(): Promise<{
  expiredSessions: number;
  deletedEntries: number;
}> {
  if (!isSupabaseConfigured()) {
    return { expiredSessions: 0, deletedEntries: 0 };
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // 만료 세션 종료
  const { data: expired } = await supabase
    .from("device_location_sessions")
    .update({ status: "expired", ended_at: now })
    .eq("status", "active")
    .lt("expires_at", now)
    .select("id");

  // 오래된 위치 데이터 삭제 (30일 이상)
  const retentionCutoff = new Date(
    Date.now() - LOCATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count: deletedCount } = await supabase
    .from("device_location_entries")
    .delete()
    .lt("created_at", retentionCutoff);

  return {
    expiredSessions: expired?.length ?? 0,
    deletedEntries: deletedCount ?? 0,
  };
}

// ============================================
// 포맷 헬퍼 (카카오톡 출력)
// ============================================

/**
 * 최신 위치를 카카오톡 메시지로 포맷
 */
export function formatLatestLocation(params: {
  deviceName: string;
  location: GpsCoordinate;
  session: LocationTrackingSession;
  batteryLevel?: number;
}): string {
  const { deviceName, location, session } = params;

  const timeAgo = formatTimeAgo(new Date(location.timestamp));
  const accuracyText = location.accuracy < 10
    ? "높음"
    : location.accuracy < 50
      ? "보통"
      : "낮음";

  const mapUrl = `https://map.kakao.com/?q=${location.latitude},${location.longitude}`;
  const googleMapUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;

  const lines = [
    `📍 ${deviceName} 위치 추적`,
    "",
    "━━ 최신 위치 ━━",
    `📌 위도: ${location.latitude.toFixed(6)}`,
    `📌 경도: ${location.longitude.toFixed(6)}`,
    `📏 정확도: ${Math.round(location.accuracy)}m (${accuracyText})`,
  ];

  if (location.altitude != null) {
    lines.push(`⛰️ 고도: ${Math.round(location.altitude)}m`);
  }
  if (location.speed != null && location.speed > 0) {
    const kmh = (location.speed * 3.6).toFixed(1);
    lines.push(`🏃 속도: ${kmh}km/h`);
  }
  if (params.batteryLevel != null) {
    const batteryIcon = params.batteryLevel > 50 ? "🔋" : params.batteryLevel > 20 ? "🪫" : "⚠️";
    lines.push(`${batteryIcon} 배터리: ${params.batteryLevel}%`);
  }

  lines.push(
    `⏰ ${timeAgo} 업데이트`,
    "",
    "━━ 지도 보기 ━━",
    `🗺️ 카카오맵: ${mapUrl}`,
    `🌍 구글맵: ${googleMapUrl}`,
    "",
    `📊 총 ${session.totalPoints}회 수신 | ${session.intervalSec}초 간격`,
  );

  if (session.status === "active") {
    lines.push("🟢 실시간 추적 중");
  } else {
    lines.push("⏸️ 추적 종료됨");
  }

  return lines.join("\n");
}

/**
 * 위치 이력을 경로로 포맷
 */
export function formatLocationHistory(params: {
  deviceName: string;
  entries: LocationEntry[];
  session: LocationTrackingSession;
}): string {
  const { deviceName, entries, session } = params;

  if (entries.length === 0) {
    return `📍 ${deviceName} - 아직 위치 데이터가 없습니다.\n기기가 온라인되면 자동으로 수집됩니다.`;
  }

  const lines = [
    `📍 ${deviceName} 이동 경로`,
    `📊 총 ${session.totalPoints}개 좌표 (최근 ${entries.length}개 표시)`,
    "",
  ];

  // 최근 순으로 표시 (최대 10개)
  const displayEntries = entries.slice(0, 10);

  for (let i = 0; i < displayEntries.length; i++) {
    const entry = displayEntries[i];
    const coord = entry.coordinate;
    const time = new Date(coord.timestamp).toLocaleTimeString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
    });

    const movingIcon = entry.isMoving ? "🏃" : "📌";
    const batteryText = entry.batteryLevel != null ? ` 🔋${entry.batteryLevel}%` : "";
    const networkText = entry.networkType ? ` ${entry.networkType === "wifi" ? "📶" : "📱"}` : "";

    lines.push(
      `${i === 0 ? "📍" : movingIcon} ${time} — ${coord.latitude.toFixed(5)}, ${coord.longitude.toFixed(5)} (±${Math.round(coord.accuracy)}m)${batteryText}${networkText}`,
    );
  }

  if (entries.length > 10) {
    lines.push(`   ... 외 ${entries.length - 10}개 좌표`);
  }

  // 첫 번째와 마지막 좌표 간 직선 거리
  if (entries.length >= 2) {
    const first = entries[entries.length - 1].coordinate;
    const last = entries[0].coordinate;
    const distance = haversineDistance(
      first.latitude, first.longitude,
      last.latitude, last.longitude,
    );
    lines.push("", `📐 이동 직선 거리: ${formatDistance(distance)}`);
  }

  return lines.join("\n");
}

/**
 * 추적 상태 요약
 */
export function formatTrackingStatus(sessions: LocationTrackingSession[]): string {
  if (sessions.length === 0) {
    return "📍 활성 위치 추적이 없습니다.";
  }

  const active = sessions.filter((s) => s.status === "active");
  const recent = sessions.filter((s) => s.status !== "active").slice(0, 3);

  const lines = ["📍 기기 위치 추적 현황", ""];

  if (active.length > 0) {
    lines.push("🟢 추적 중:");
    for (const s of active) {
      const lastUpdate = s.lastLocation
        ? formatTimeAgo(new Date(s.lastLocation.timestamp))
        : "대기 중";
      lines.push(`  📱 ${s.deviceName} — ${lastUpdate} | ${s.totalPoints}회 수신`);
    }
  }

  if (recent.length > 0) {
    lines.push("", "⏸️ 최근 종료:");
    for (const s of recent) {
      const endTime = s.endedAt
        ? new Date(s.endedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
        : "?";
      lines.push(`  📱 ${s.deviceName} — 종료: ${endTime} | ${s.totalPoints}회 기록`);
    }
  }

  return lines.join("\n");
}

/**
 * 분실 신고 후 사용자에게 보내는 추적 시작 알림
 */
export function formatTrackingActivated(params: {
  deviceName: string;
  intervalSec: number;
  expiresInHours: number;
}): string {
  return [
    "📡 GPS 실시간 추적 활성화",
    "",
    `📱 대상: ${params.deviceName}`,
    `⏱️ 추적 간격: ${params.intervalSec}초`,
    `⏰ 자동 만료: ${params.expiresInHours}시간 후`,
    "",
    "기기가 온라인되면 즉시 위치 추적이 시작됩니다.",
    "위치 확인: /기기위치",
    "이동 경로: /분실추적",
  ].join("\n");
}

// ============================================
// 유틸리티
// ============================================

/** Haversine 공식으로 두 GPS 좌표 간 거리 (미터) */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000; // 지구 반경 (미터)
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}초 전`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  return `${Math.floor(diffHours / 24)}일 전`;
}

// ============================================
// DB Row Mappers
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSessionRow(row: any): LocationTrackingSession {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    status: row.status,
    intervalSec: row.interval_sec,
    lastLocation: row.last_latitude != null
      ? {
          latitude: row.last_latitude,
          longitude: row.last_longitude,
          accuracy: row.last_accuracy ?? 0,
          timestamp: row.last_location_at ?? row.started_at,
        }
      : undefined,
    totalPoints: row.total_points ?? 0,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at ?? undefined,
    wipeCommandId: row.wipe_command_id ?? undefined,
  };
}

function mapEntryRow(row: any): LocationEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    coordinate: {
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      altitude: row.altitude ?? undefined,
      speed: row.speed ?? undefined,
      bearing: row.bearing ?? undefined,
      timestamp: row.measured_at,
      provider: row.provider ?? undefined,
    },
    batteryLevel: row.battery_level ?? undefined,
    networkType: row.network_type ?? undefined,
    isMoving: row.is_moving ?? undefined,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
