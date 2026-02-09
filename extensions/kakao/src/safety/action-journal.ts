/**
 * Action Journal — 모든 작업의 타임라인 기록 시스템
 *
 * Git의 commit log처럼, MoA가 수행하는 모든 의미 있는 작업을 기록합니다.
 * 이를 통해:
 * 1. 작업 내역 추적 (누가, 언제, 무엇을, 어떤 결과)
 * 2. 개별 작업 취소 (undo)
 * 3. 특정 시점으로 되돌리기 (rollback to checkpoint)
 * 4. 장기 기억의 버전 관리
 *
 * ## 저장 구조
 * .moa-data/
 * ├── journal/
 * │   ├── actions.jsonl        ← 작업 로그 (append-only)
 * │   ├── checkpoints.json     ← 체크포인트 목록
 * │   └── memory-versions/     ← 장기 기억 스냅샷
 * │       ├── v001.json
 * │       ├── v002.json
 * │       └── ...
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// ============================================
// Types
// ============================================

/** 작업의 종류 */
export type ActionType =
  | "device_command"     // 기기에 명령 전송
  | "file_operation"     // 파일 생성/수정/삭제
  | "memory_update"      // 장기 기억 변경
  | "config_change"      // 설정 변경
  | "skill_install"      // 스킬 설치/제거
  | "device_register"    // 기기 등록/해제
  | "message_send"       // 외부 메시지 발송
  | "data_export"        // 데이터 내보내기
  | "system_change";     // 시스템 설정 변경

/** 작업의 상태 */
export type ActionStatus =
  | "pending"        // 실행 대기 중
  | "executing"      // 실행 중
  | "completed"      // 완료
  | "failed"         // 실패
  | "cancelled"      // 사용자가 취소
  | "rolled_back";   // 되돌리기 됨

/** 되돌리기 가능 여부 */
export type ReversibilityLevel =
  | "reversible"          // 완전히 되돌릴 수 있음
  | "partially_reversible" // 부분적으로 되돌릴 수 있음
  | "irreversible";       // 되돌릴 수 없음 (외부 전송 등)

/** 작업 기록 엔트리 */
export interface ActionEntry {
  /** 고유 ID (짧은 해시) */
  id: string;
  /** 작업 종류 */
  type: ActionType;
  /** 사람이 읽을 수 있는 요약 */
  summary: string;
  /** 상세 내용 (명령어 원문, 파일 경로 등) */
  detail: string;
  /** 작업 상태 */
  status: ActionStatus;
  /** 되돌리기 가능 여부 */
  reversibility: ReversibilityLevel;
  /** 실행 전 상태 스냅샷 (되돌리기용) */
  preState?: Record<string, unknown>;
  /** 실행 결과 */
  result?: string;
  /** 되돌리기 명령 (자동 생성) */
  undoAction?: UndoAction;
  /** 연결된 체크포인트 ID */
  checkpointId?: string;
  /** 요청자 정보 */
  userId: string;
  channelId: string;
  /** 대상 기기 (있는 경우) */
  deviceId?: string;
  deviceName?: string;
  /** 타임스탬프 */
  createdAt: number;
  /** 완료/실패 시각 */
  completedAt?: number;
}

/** 되돌리기 작업 정보 */
export interface UndoAction {
  /** 되돌리기 유형 */
  type: "command" | "restore_file" | "restore_memory" | "restore_config";
  /** 되돌리기 명령 또는 복원 데이터 */
  payload: Record<string, unknown>;
  /** 사람이 읽을 수 있는 설명 */
  description: string;
}

/** 체크포인트 (저장 시점) */
export interface Checkpoint {
  /** 고유 ID */
  id: string;
  /** 체크포인트 이름 (사용자 지정 또는 자동 생성) */
  name: string;
  /** 설명 */
  description: string;
  /** 자동 생성 여부 */
  auto: boolean;
  /** 이 체크포인트 시점의 마지막 action ID */
  lastActionId: string;
  /** 장기 기억 버전 번호 */
  memoryVersion: number;
  /** 기기 상태 요약 */
  deviceSnapshot: Array<{ deviceId: string; deviceName: string; online: boolean }>;
  /** 타임스탬프 */
  createdAt: number;
  /** 요청자 */
  userId: string;
  channelId: string;
}

/** 장기 기억 스냅샷 */
export interface MemorySnapshot {
  version: number;
  /** 기억 내용 (key-value) */
  data: Record<string, unknown>;
  /** 변경 사유 */
  reason: string;
  /** 이전 버전 번호 */
  previousVersion: number;
  /** 변경된 키 목록 */
  changedKeys: string[];
  createdAt: number;
}

// ============================================
// Storage
// ============================================

function getDataDir(): string {
  return process.env.MOA_DATA_DIR ?? join(process.cwd(), ".moa-data");
}

function getJournalDir(): string {
  const dir = join(getDataDir(), "journal");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getMemoryVersionDir(): string {
  const dir = join(getJournalDir(), "memory-versions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function generateId(): string {
  return randomBytes(4).toString("hex"); // 8-char hex
}

// ============================================
// Action Journal Operations
// ============================================

/**
 * 작업을 기록합니다 (실행 전 호출).
 * 반환된 entry의 id를 사용하여 이후 상태를 업데이트합니다.
 */
export function logAction(entry: Omit<ActionEntry, "id" | "createdAt" | "status">): ActionEntry {
  const action: ActionEntry = {
    ...entry,
    id: generateId(),
    status: "pending",
    createdAt: Date.now(),
  };

  const filePath = join(getJournalDir(), "actions.jsonl");
  appendFileSync(filePath, JSON.stringify(action) + "\n", "utf-8");

  return action;
}

/**
 * 작업 상태를 업데이트합니다 (완료, 실패, 취소 등).
 */
export function updateActionStatus(
  actionId: string,
  status: ActionStatus,
  result?: string,
): void {
  const update = {
    _update: true,
    id: actionId,
    status,
    result,
    completedAt: Date.now(),
  };
  const filePath = join(getJournalDir(), "actions.jsonl");
  appendFileSync(filePath, JSON.stringify(update) + "\n", "utf-8");
}

/**
 * 최근 작업 내역을 가져옵니다.
 */
export function getRecentActions(limit: number = 20): ActionEntry[] {
  const filePath = join(getJournalDir(), "actions.jsonl");
  if (!existsSync(filePath)) { return []; }

  const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  const actions = new Map<string, ActionEntry>();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed._update) {
        // Status update — merge into existing action
        const existing = actions.get(parsed.id);
        if (existing) {
          existing.status = parsed.status;
          existing.result = parsed.result ?? existing.result;
          existing.completedAt = parsed.completedAt;
        }
      } else {
        actions.set(parsed.id, parsed as ActionEntry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return Array.from(actions.values())
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * 특정 작업을 ID로 찾습니다.
 */
export function getActionById(actionId: string): ActionEntry | null {
  const all = getRecentActions(500);
  return all.find((a) => a.id === actionId) ?? null;
}

/**
 * 되돌릴 수 있는 최근 작업 목록을 가져옵니다.
 */
export function getUndoableActions(limit: number = 10): ActionEntry[] {
  return getRecentActions(100)
    .filter((a) =>
      a.status === "completed" &&
      a.reversibility !== "irreversible" &&
      a.undoAction != null,
    )
    .slice(0, limit);
}

// ============================================
// Checkpoint Operations
// ============================================

function loadCheckpoints(): Checkpoint[] {
  const filePath = join(getJournalDir(), "checkpoints.json");
  if (!existsSync(filePath)) { return []; }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Checkpoint[];
  } catch {
    return [];
  }
}

function saveCheckpoints(checkpoints: Checkpoint[]): void {
  const filePath = join(getJournalDir(), "checkpoints.json");
  writeFileSync(filePath, JSON.stringify(checkpoints, null, 2), "utf-8");
}

/**
 * 체크포인트를 생성합니다 (현재 시점의 스냅샷).
 */
export function createCheckpoint(params: {
  name?: string;
  description?: string;
  auto?: boolean;
  userId: string;
  channelId: string;
  deviceSnapshot?: Array<{ deviceId: string; deviceName: string; online: boolean }>;
}): Checkpoint {
  const checkpoints = loadCheckpoints();
  const recentActions = getRecentActions(1);
  const memoryVersion = getCurrentMemoryVersion();

  const checkpoint: Checkpoint = {
    id: generateId(),
    name: params.name ?? `checkpoint-${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    description: params.description ?? "자동 체크포인트",
    auto: params.auto ?? false,
    lastActionId: recentActions[0]?.id ?? "",
    memoryVersion,
    deviceSnapshot: params.deviceSnapshot ?? [],
    createdAt: Date.now(),
    userId: params.userId,
    channelId: params.channelId,
  };

  checkpoints.push(checkpoint);

  // Keep max 50 checkpoints (remove oldest auto ones first)
  if (checkpoints.length > 50) {
    const autoOnes = checkpoints.filter((c) => c.auto);
    if (autoOnes.length > 30) {
      const toRemove = autoOnes.slice(0, autoOnes.length - 30);
      const removeIds = new Set(toRemove.map((c) => c.id));
      const filtered = checkpoints.filter((c) => !removeIds.has(c.id));
      saveCheckpoints(filtered);
      return checkpoint;
    }
  }

  saveCheckpoints(checkpoints);
  return checkpoint;
}

/**
 * 체크포인트 목록을 가져옵니다.
 */
export function getCheckpoints(limit: number = 20): Checkpoint[] {
  return loadCheckpoints()
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * 특정 체크포인트를 찾습니다.
 */
export function getCheckpointById(checkpointId: string): Checkpoint | null {
  return loadCheckpoints().find((c) => c.id === checkpointId) ?? null;
}

// ============================================
// Memory Version Control
// ============================================

/**
 * 현재 장기 기억 버전 번호를 가져옵니다.
 */
export function getCurrentMemoryVersion(): number {
  const dir = getMemoryVersionDir();
  if (!existsSync(dir)) { return 0; }

  const files = readdirSync(dir).filter((f) => f.startsWith("v") && f.endsWith(".json"));
  if (files.length === 0) { return 0; }

  const versions = files.map((f) => parseInt(f.slice(1, -5), 10)).filter((n) => !isNaN(n));
  return Math.max(0, ...versions);
}

/**
 * 장기 기억의 새 버전을 저장합니다.
 */
export function saveMemoryVersion(params: {
  data: Record<string, unknown>;
  reason: string;
  changedKeys: string[];
}): MemorySnapshot {
  const currentVersion = getCurrentMemoryVersion();
  const newVersion = currentVersion + 1;

  const snapshot: MemorySnapshot = {
    version: newVersion,
    data: params.data,
    reason: params.reason,
    previousVersion: currentVersion,
    changedKeys: params.changedKeys,
    createdAt: Date.now(),
  };

  const filePath = join(getMemoryVersionDir(), `v${String(newVersion).padStart(3, "0")}.json`);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

  return snapshot;
}

/**
 * 특정 버전의 장기 기억을 가져옵니다.
 */
export function getMemoryVersion(version: number): MemorySnapshot | null {
  const filePath = join(getMemoryVersionDir(), `v${String(version).padStart(3, "0")}.json`);
  if (!existsSync(filePath)) { return null; }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as MemorySnapshot;
  } catch {
    return null;
  }
}

/**
 * 장기 기억 버전 히스토리를 가져옵니다.
 */
export function getMemoryHistory(limit: number = 10): MemorySnapshot[] {
  const dir = getMemoryVersionDir();
  if (!existsSync(dir)) { return []; }

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("v") && f.endsWith(".json"))
    .toSorted()
    .toReversed()
    .slice(0, limit);

  const snapshots: MemorySnapshot[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8")) as MemorySnapshot;
      snapshots.push(data);
    } catch {
      // Skip malformed
    }
  }
  return snapshots;
}

/**
 * 특정 버전으로 장기 기억을 되돌립니다.
 */
export function restoreMemoryToVersion(version: number): MemorySnapshot | null {
  const target = getMemoryVersion(version);
  if (!target) { return null; }

  // Save current as a new version marked as "rollback"
  const current = getMemoryVersion(getCurrentMemoryVersion());
  if (current) {
    saveMemoryVersion({
      data: target.data,
      reason: `v${version}으로 되돌리기 (이전: v${current.version})`,
      changedKeys: Object.keys(target.data),
    });
  }

  return target;
}

// ============================================
// Rollback Engine
// ============================================

/** 되돌리기 결과 */
export interface RollbackResult {
  success: boolean;
  message: string;
  /** 되돌린 작업 수 */
  rolledBackCount: number;
  /** 되돌리기 불가능했던 작업 수 */
  irreversibleCount: number;
  /** 장기 기억 복원 여부 */
  memoryRestored: boolean;
}

/**
 * 개별 작업을 되돌립니다.
 */
export function undoAction(actionId: string): RollbackResult {
  const action = getActionById(actionId);

  if (!action) {
    return {
      success: false,
      message: `작업 ${actionId}를 찾을 수 없습니다.`,
      rolledBackCount: 0,
      irreversibleCount: 0,
      memoryRestored: false,
    };
  }

  if (action.status !== "completed") {
    return {
      success: false,
      message: `작업 ${actionId}는 완료 상태가 아닙니다. (현재: ${action.status})`,
      rolledBackCount: 0,
      irreversibleCount: 0,
      memoryRestored: false,
    };
  }

  if (action.reversibility === "irreversible") {
    return {
      success: false,
      message: `작업 "${action.summary}"는 되돌릴 수 없는 작업입니다 (외부 전송 등).`,
      rolledBackCount: 0,
      irreversibleCount: 1,
      memoryRestored: false,
    };
  }

  if (!action.undoAction) {
    return {
      success: false,
      message: `작업 "${action.summary}"의 되돌리기 정보가 없습니다.`,
      rolledBackCount: 0,
      irreversibleCount: 0,
      memoryRestored: false,
    };
  }

  // Execute undo
  let memoryRestored = false;
  try {
    if (action.undoAction.type === "restore_memory") {
      const targetVersion = action.undoAction.payload.version as number;
      if (targetVersion) {
        restoreMemoryToVersion(targetVersion);
        memoryRestored = true;
      }
    }
    // For other undo types, the relay system would handle the actual undo command
    // Here we mark the action as rolled back

    updateActionStatus(actionId, "rolled_back", `되돌리기 완료: ${action.undoAction.description}`);

    return {
      success: true,
      message: `"${action.summary}" 작업이 되돌려졌습니다.\n${action.undoAction.description}`,
      rolledBackCount: 1,
      irreversibleCount: 0,
      memoryRestored,
    };
  } catch (err) {
    return {
      success: false,
      message: `되돌리기 실패: ${err instanceof Error ? err.message : String(err)}`,
      rolledBackCount: 0,
      irreversibleCount: 0,
      memoryRestored: false,
    };
  }
}

/**
 * 특정 체크포인트로 되돌립니다.
 * 체크포인트 이후의 모든 작업을 역순으로 되돌립니다.
 */
export function rollbackToCheckpoint(checkpointId: string): RollbackResult {
  const checkpoint = getCheckpointById(checkpointId);
  if (!checkpoint) {
    return {
      success: false,
      message: `체크포인트 ${checkpointId}를 찾을 수 없습니다.`,
      rolledBackCount: 0,
      irreversibleCount: 0,
      memoryRestored: false,
    };
  }

  const allActions = getRecentActions(500);
  // Find actions after this checkpoint
  const afterCheckpoint = allActions.filter(
    (a) => a.createdAt > checkpoint.createdAt && a.status === "completed",
  );

  let rolledBackCount = 0;
  let irreversibleCount = 0;

  // Rollback in reverse order (newest first)
  for (const action of afterCheckpoint) {
    if (action.reversibility === "irreversible" || !action.undoAction) {
      irreversibleCount++;
      continue;
    }

    try {
      if (action.undoAction.type === "restore_memory") {
        // Will be handled by memory restore below
        continue;
      }
      updateActionStatus(action.id, "rolled_back", `체크포인트 "${checkpoint.name}"으로 되돌리기`);
      rolledBackCount++;
    } catch {
      irreversibleCount++;
    }
  }

  // Restore memory to checkpoint version
  let memoryRestored = false;
  if (checkpoint.memoryVersion > 0) {
    const restored = restoreMemoryToVersion(checkpoint.memoryVersion);
    memoryRestored = !!restored;
  }

  const message = [
    `체크포인트 "${checkpoint.name}"으로 되돌렸습니다.`,
    `(${new Date(checkpoint.createdAt).toLocaleString("ko-KR")})`,
    ``,
    `되돌린 작업: ${rolledBackCount}개`,
    irreversibleCount > 0 ? `되돌릴 수 없는 작업: ${irreversibleCount}개 (외부 전송 등)` : "",
    memoryRestored ? `장기 기억: v${checkpoint.memoryVersion}으로 복원됨` : "",
  ].filter(Boolean).join("\n");

  return {
    success: true,
    message,
    rolledBackCount,
    irreversibleCount,
    memoryRestored,
  };
}

// ============================================
// Formatting for Chat Display
// ============================================

/**
 * 최근 작업 내역을 채팅용으로 포맷합니다.
 */
export function formatActionHistory(actions: ActionEntry[], maxLen: number = 2000): string {
  if (actions.length === 0) {
    return "작업 내역이 없습니다.";
  }

  const statusEmoji: Record<ActionStatus, string> = {
    pending: "⏳",
    executing: "🔄",
    completed: "✅",
    failed: "❌",
    cancelled: "⛔",
    rolled_back: "↩️",
  };

  let output = "📋 최근 작업 내역\n\n";

  for (const action of actions) {
    const time = new Date(action.createdAt).toLocaleString("ko-KR", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const emoji = statusEmoji[action.status] ?? "❓";
    const undoTag = action.undoAction && action.status === "completed" ? " [되돌리기 가능]" : "";

    output += `${emoji} ${action.summary}${undoTag}\n`;
    output += `   ${time} · ${action.id}\n`;
    if (output.length > maxLen - 100) {
      output += "\n...(더 많은 내역이 있습니다)";
      break;
    }
  }

  output += `\n되돌리기: "!되돌리기 [ID]"\n체크포인트 생성: "!체크포인트 [이름]"`;

  return output;
}

/**
 * 체크포인트 목록을 채팅용으로 포맷합니다.
 */
export function formatCheckpointList(checkpoints: Checkpoint[], maxLen: number = 2000): string {
  if (checkpoints.length === 0) {
    return "저장된 체크포인트가 없습니다.\n\n\"!체크포인트 [이름]\"으로 현재 시점을 저장할 수 있습니다.";
  }

  let output = "📌 체크포인트 목록\n\n";

  for (const cp of checkpoints) {
    const time = new Date(cp.createdAt).toLocaleString("ko-KR", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const autoTag = cp.auto ? " (자동)" : "";
    output += `📍 ${cp.name}${autoTag}\n`;
    output += `   ${time} · ${cp.id} · 기억 v${cp.memoryVersion}\n`;
    if (cp.description !== "자동 체크포인트") {
      output += `   ${cp.description}\n`;
    }
    if (output.length > maxLen - 100) {
      output += "\n...(더 많은 체크포인트가 있습니다)";
      break;
    }
  }

  output += `\n되돌리기: "!복원 [체크포인트 ID]"`;

  return output;
}

/**
 * 장기 기억 히스토리를 채팅용으로 포맷합니다.
 */
export function formatMemoryHistory(snapshots: MemorySnapshot[], maxLen: number = 2000): string {
  if (snapshots.length === 0) {
    return "장기 기억 히스토리가 없습니다.";
  }

  let output = "🧠 장기 기억 히스토리\n\n";

  for (const snap of snapshots) {
    const time = new Date(snap.createdAt).toLocaleString("ko-KR", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    output += `v${snap.version}: ${snap.reason}\n`;
    output += `   ${time} · 변경: ${snap.changedKeys.join(", ") || "전체"}\n`;
    if (output.length > maxLen - 100) {
      output += "\n...";
      break;
    }
  }

  output += `\n기억 복원: "!기억복원 [버전번호]"`;

  return output;
}
