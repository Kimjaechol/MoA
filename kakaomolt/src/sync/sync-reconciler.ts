/**
 * Sync Reconciler — 누락 방지 + 순서 보장
 *
 * Ephemeral 릴레이의 두 가지 근본 문제를 해결:
 *
 * 1. 누락 (data loss):
 *    - 상대 기기가 오프라인 → TTL 경과 → 서버 데이터 삭제 → 동기화 실패
 *    - 해결: 각 기기가 **로컬 델타 저널**을 보관, 재연결 시 누락분 재전송
 *
 * 2. 순서 꼬임 (out-of-order):
 *    - 델타가 도착 순서 ≠ 생성 순서
 *    - 해결: 기기별 **시퀀스 넘버** + 수신측 **순서 정렬 후 적용**
 *
 * 핵심 개념:
 *
 * - Version Vector: {deviceId → lastSeq} 각 기기가 다른 기기의 마지막 시퀀스를 추적
 * - Delta Journal: 로컬에 최근 델타를 보관 (기본 7일, 재전송용)
 * - Reconnection Protocol: Supabase Realtime broadcast로 "나 버전 X인데, 빠진거 보내줘"
 * - Ordered Application: 시퀀스 순서대로 적용, 갭이 있으면 버퍼링 후 요청
 *
 * 서버에는 여전히 아무것도 영구 보관하지 않음 (프라이버시 유지).
 * 데이터는 항상 기기에만 존재하고, 서버는 릴레이 + 시그널링만.
 */

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

// ============================================
// Types
// ============================================

/** 기기별 시퀀스 번호 맵 (Version Vector) */
export type VersionVector = Record<string, number>;

/** 동기화 델타 — 로컬 저널에 보관되는 단위 */
export interface SyncDelta {
  /** 고유 ID */
  id: string;
  /** 생성한 기기 */
  sourceDeviceId: string;
  /** 기기 내 순서 번호 (단조 증가) */
  seq: number;
  /** 델타 타입 */
  deltaType: "add" | "update" | "delete";
  /** 대상 엔티티 타입 */
  entityType: "memory_chunk" | "conversation" | "setting";
  /** E2E 암호화된 페이로드 (상대 기기가 복호화) */
  encryptedPayload: string;
  /** IV for decryption */
  iv: string;
  /** Auth tag for decryption */
  authTag: string;
  /** 생성 시각 */
  createdAt: string;
}

/** Realtime broadcast 메시지 타입 */
export type BroadcastMessage =
  | { type: "sync_request"; fromDeviceId: string; versionVector: VersionVector }
  | { type: "sync_response"; fromDeviceId: string; deltas: SyncDelta[] }
  | { type: "delta_ack"; fromDeviceId: string; sourceDeviceId: string; lastSeq: number };

/** 재조정기 설정 */
export interface ReconcilerConfig {
  supabase: SupabaseClient;
  userId: string;
  deviceId: string;
  /** 로컬 저널 보관 기간 (ms). 기본 7일 */
  journalRetentionMs?: number;
  /** 델타 적용 콜백 */
  onApplyDelta?: (delta: SyncDelta) => Promise<void>;
  /** 갭 감지 시 콜백 (디버깅용) */
  onGapDetected?: (fromDevice: string, expected: number, received: number) => void;
}

// ============================================
// Constants
// ============================================

const DEFAULT_JOURNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BUFFER_SIZE = 500; // max out-of-order deltas to buffer per device

// ============================================
// SyncReconciler
// ============================================

export class SyncReconciler {
  private config: ReconcilerConfig;
  private broadcastChannel: RealtimeChannel | null = null;

  /** 내 기기의 다음 시퀀스 번호 */
  private localSeq = 0;

  /** 다른 기기로부터 마지막으로 수신한 시퀀스 (Version Vector) */
  private versionVector: VersionVector = {};

  /** 로컬 델타 저널 (내가 생성한 델타, 재전송용) */
  private journal: SyncDelta[] = [];

  /** 순서 대기 버퍼: 시퀀스 갭이 있을 때 대기 {deviceId → SyncDelta[]} */
  private orderBuffer: Map<string, SyncDelta[]> = new Map();

  /** 저널 보관 기간 */
  private readonly journalRetentionMs: number;

  constructor(config: ReconcilerConfig) {
    this.config = config;
    this.journalRetentionMs = config.journalRetentionMs ?? DEFAULT_JOURNAL_RETENTION_MS;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * 재조정기 시작.
   * Supabase Realtime broadcast 채널에 연결하여
   * sync_request / sync_response 메시지를 송수신.
   */
  async start(): Promise<void> {
    if (this.broadcastChannel) return;

    const { supabase, userId, deviceId } = this.config;

    this.broadcastChannel = supabase
      .channel(`sync-reconcile:${userId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "sync_msg" }, (payload) => {
        const msg = payload.payload as BroadcastMessage;
        this.handleBroadcast(msg).catch((err) => {
          console.error("[Reconciler] Broadcast handler error:", err);
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[Reconciler] Broadcast channel connected");
          // 연결되면 즉시 sync_request 보내서 빠진 데이터 요청
          this.requestMissingDeltas();
        }
      });
  }

  /**
   * 재조정기 정지.
   */
  async stop(): Promise<void> {
    if (this.broadcastChannel) {
      await this.config.supabase.removeChannel(this.broadcastChannel);
      this.broadcastChannel = null;
    }
  }

  // ============================================
  // Delta Creation (outbound)
  // ============================================

  /**
   * 새 델타 생성. 로컬 저널에 추가 + 시퀀스 번호 부여.
   *
   * 호출자는 이 델타를 Supabase에 업로드하고,
   * 상대 기기가 TTL 내에 수신하지 못하면 재조정기가 재전송.
   */
  createDelta(
    deltaType: SyncDelta["deltaType"],
    entityType: SyncDelta["entityType"],
    encryptedPayload: string,
    iv: string,
    authTag: string,
  ): SyncDelta {
    this.localSeq++;

    const delta: SyncDelta = {
      id: `${this.config.deviceId}-${this.localSeq}-${Date.now()}`,
      sourceDeviceId: this.config.deviceId,
      seq: this.localSeq,
      deltaType,
      entityType,
      encryptedPayload,
      iv,
      authTag,
      createdAt: new Date().toISOString(),
    };

    // 로컬 저널에 보관
    this.journal.push(delta);
    this.pruneJournal();

    return delta;
  }

  /**
   * 현재 시퀀스 번호 조회
   */
  getLocalSeq(): number {
    return this.localSeq;
  }

  /**
   * 저널 크기 조회
   */
  getJournalSize(): number {
    return this.journal.length;
  }

  /**
   * Version vector 조회
   */
  getVersionVector(): VersionVector {
    return { ...this.versionVector };
  }

  // ============================================
  // Delta Reception (inbound)
  // ============================================

  /**
   * 수신한 델타를 처리.
   *
   * 1. 이미 받은 시퀀스면 무시 (중복 방지)
   * 2. 순서가 맞으면 즉시 적용
   * 3. 갭이 있으면 버퍼에 넣고, 빠진 시퀀스 요청
   */
  async receiveDelta(delta: SyncDelta): Promise<{
    applied: boolean;
    buffered: boolean;
    reason?: string;
  }> {
    const { sourceDeviceId, seq } = delta;
    const lastReceived = this.versionVector[sourceDeviceId] ?? 0;

    // 이미 받은 시퀀스 → 무시 (idempotent)
    if (seq <= lastReceived) {
      return { applied: false, buffered: false, reason: "duplicate" };
    }

    // 순서가 맞음 (next expected)
    if (seq === lastReceived + 1) {
      await this.applyDelta(delta);
      // 버퍼에 연속된 다음 시퀀스가 있으면 함께 적용
      await this.flushBuffer(sourceDeviceId);
      return { applied: true, buffered: false };
    }

    // 갭 발생 — 버퍼에 넣고 빠진 시퀀스 요청
    this.bufferDelta(delta);
    this.config.onGapDetected?.(sourceDeviceId, lastReceived + 1, seq);
    console.log(
      `[Reconciler] Gap detected from ${sourceDeviceId}: expected seq ${lastReceived + 1}, got ${seq}. Buffering.`,
    );

    // 빠진 데이터 요청
    this.requestMissingDeltas();

    return { applied: false, buffered: true, reason: `gap: expected ${lastReceived + 1}` };
  }

  /**
   * 델타를 순서대로 적용
   */
  private async applyDelta(delta: SyncDelta): Promise<void> {
    this.versionVector[delta.sourceDeviceId] = delta.seq;
    await this.config.onApplyDelta?.(delta);
  }

  /**
   * 순서 대기 버퍼에 추가
   */
  private bufferDelta(delta: SyncDelta): void {
    const { sourceDeviceId } = delta;
    let buffer = this.orderBuffer.get(sourceDeviceId);
    if (!buffer) {
      buffer = [];
      this.orderBuffer.set(sourceDeviceId, buffer);
    }

    // 중복 체크
    if (buffer.some((d) => d.seq === delta.seq)) return;

    buffer.push(delta);
    // 시퀀스 순 정렬
    buffer.sort((a, b) => a.seq - b.seq);

    // 버퍼 크기 제한
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }
  }

  /**
   * 버퍼에서 연속된 시퀀스를 적용
   *
   * 예: lastReceived=3, 버퍼에 [4,5,7] → 4,5 적용, 7은 대기
   */
  private async flushBuffer(sourceDeviceId: string): Promise<void> {
    const buffer = this.orderBuffer.get(sourceDeviceId);
    if (!buffer || buffer.length === 0) return;

    let lastReceived = this.versionVector[sourceDeviceId] ?? 0;
    let applied = 0;

    while (buffer.length > 0 && buffer[0].seq === lastReceived + 1) {
      const delta = buffer.shift()!;
      await this.applyDelta(delta);
      lastReceived = delta.seq;
      applied++;
    }

    if (applied > 0) {
      console.log(`[Reconciler] Flushed ${applied} buffered deltas from ${sourceDeviceId}`);
    }

    // 빈 버퍼 정리
    if (buffer.length === 0) {
      this.orderBuffer.delete(sourceDeviceId);
    }
  }

  // ============================================
  // Reconnection Protocol (broadcast)
  // ============================================

  /**
   * "나 이 버전인데, 빠진 거 보내줘" 요청.
   *
   * Supabase Realtime broadcast를 사용하므로 DB에 아무것도 저장하지 않음.
   * 순수 WebSocket 메시지.
   */
  requestMissingDeltas(): void {
    if (!this.broadcastChannel) return;

    const msg: BroadcastMessage = {
      type: "sync_request",
      fromDeviceId: this.config.deviceId,
      versionVector: { ...this.versionVector },
    };

    this.broadcastChannel.send({
      type: "broadcast",
      event: "sync_msg",
      payload: msg,
    });

    console.log("[Reconciler] Sent sync_request with version vector:", this.versionVector);
  }

  /**
   * broadcast 메시지 처리
   */
  private async handleBroadcast(msg: BroadcastMessage): Promise<void> {
    switch (msg.type) {
      case "sync_request":
        await this.handleSyncRequest(msg);
        break;
      case "sync_response":
        await this.handleSyncResponse(msg);
        break;
      case "delta_ack":
        // ACK 수신 — 상대가 특정 시퀀스까지 받았음을 확인
        // 현재는 로깅만 (저널 정리에 활용 가능)
        console.log(
          `[Reconciler] ACK from ${msg.fromDeviceId}: received up to seq ${msg.lastSeq} from ${msg.sourceDeviceId}`,
        );
        break;
    }
  }

  /**
   * sync_request 처리: 상대 기기가 빠진 델타를 요청
   *
   * 내 로컬 저널에서 상대가 아직 못 받은 델타를 찾아서 전송.
   */
  private async handleSyncRequest(msg: Extract<BroadcastMessage, { type: "sync_request" }>): Promise<void> {
    const theirVector = msg.versionVector;
    const myDeviceId = this.config.deviceId;

    // 상대가 내 기기에서 마지막으로 받은 시퀀스
    const theirLastFromMe = theirVector[myDeviceId] ?? 0;

    // 내 저널에서 상대가 못 받은 델타 필터
    const missingDeltas = this.journal.filter((d) => d.seq > theirLastFromMe);

    if (missingDeltas.length === 0) {
      return; // 빠진 것 없음
    }

    console.log(
      `[Reconciler] Device ${msg.fromDeviceId} is missing ${missingDeltas.length} deltas (seq ${theirLastFromMe + 1}~${this.localSeq}). Re-relaying.`,
    );

    // 한 번에 너무 많으면 분할 전송 (broadcast payload 크기 제한)
    const BATCH_SIZE = 50;
    for (let i = 0; i < missingDeltas.length; i += BATCH_SIZE) {
      const batch = missingDeltas.slice(i, i + BATCH_SIZE);

      const response: BroadcastMessage = {
        type: "sync_response",
        fromDeviceId: myDeviceId,
        deltas: batch,
      };

      this.broadcastChannel?.send({
        type: "broadcast",
        event: "sync_msg",
        payload: response,
      });
    }
  }

  /**
   * sync_response 처리: 누락된 델타를 수신
   *
   * 시퀀스 순으로 정렬 후 적용.
   */
  private async handleSyncResponse(msg: Extract<BroadcastMessage, { type: "sync_response" }>): Promise<void> {
    const { deltas } = msg;
    if (!deltas || deltas.length === 0) return;

    console.log(
      `[Reconciler] Received ${deltas.length} re-relayed deltas from ${msg.fromDeviceId}`,
    );

    // 시퀀스 순 정렬
    const sorted = [...deltas].sort((a, b) => a.seq - b.seq);

    for (const delta of sorted) {
      await this.receiveDelta(delta);
    }

    // ACK 보내기
    const lastSeq = sorted[sorted.length - 1].seq;
    this.broadcastChannel?.send({
      type: "broadcast",
      event: "sync_msg",
      payload: {
        type: "delta_ack",
        fromDeviceId: this.config.deviceId,
        sourceDeviceId: msg.fromDeviceId,
        lastSeq,
      } satisfies BroadcastMessage,
    });
  }

  // ============================================
  // Journal Management
  // ============================================

  /**
   * 저널에서 보관 기간이 지난 항목 삭제.
   * 기본 7일 — 이 기간 내에 재연결하면 재전송 가능.
   */
  private pruneJournal(): void {
    const cutoff = Date.now() - this.journalRetentionMs;
    const before = this.journal.length;

    this.journal = this.journal.filter(
      (d) => new Date(d.createdAt).getTime() > cutoff,
    );

    const pruned = before - this.journal.length;
    if (pruned > 0) {
      console.log(`[Reconciler] Pruned ${pruned} old journal entries`);
    }
  }

  /**
   * 저널 전체 내보내기 (앱 종료 시 로컬 저장용).
   *
   * 앱이 종료될 때 이 데이터를 로컬 스토리지에 저장하고,
   * 다음 실행 시 restoreState()로 복원하면
   * 앱 재시작 후에도 재전송이 가능합니다.
   */
  exportState(): ReconcilerState {
    return {
      localSeq: this.localSeq,
      versionVector: { ...this.versionVector },
      journal: [...this.journal],
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * 이전 상태 복원 (앱 시작 시).
   */
  restoreState(state: ReconcilerState): void {
    this.localSeq = state.localSeq;
    this.versionVector = { ...state.versionVector };
    this.journal = [...state.journal];

    // 복원 후 만료된 항목 정리
    this.pruneJournal();

    console.log(
      `[Reconciler] Restored state: seq=${this.localSeq}, journal=${this.journal.length} entries`,
    );
  }

  // ============================================
  // Status
  // ============================================

  getStatus(): ReconcilerStatus {
    let bufferedCount = 0;
    for (const buf of this.orderBuffer.values()) {
      bufferedCount += buf.length;
    }

    return {
      localSeq: this.localSeq,
      versionVector: { ...this.versionVector },
      journalSize: this.journal.length,
      bufferedDeltas: bufferedCount,
      broadcastConnected: this.broadcastChannel !== null,
    };
  }
}

// ============================================
// Exported Types
// ============================================

export interface ReconcilerState {
  localSeq: number;
  versionVector: VersionVector;
  journal: SyncDelta[];
  exportedAt: string;
}

export interface ReconcilerStatus {
  localSeq: number;
  versionVector: VersionVector;
  journalSize: number;
  bufferedDeltas: number;
  broadcastConnected: boolean;
}
