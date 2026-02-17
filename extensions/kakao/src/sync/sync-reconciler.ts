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
 * - Delta Journal: 로컬에 최근 델타를 보관 (기본 30일, 재전송용)
 * - Reconnection Protocol: Supabase Realtime broadcast로 "나 버전 X인데, 빠진거 보내줘"
 * - Ordered Application: 시퀀스 순서대로 적용, 갭이 있으면 버퍼링 후 요청
 * - Manual Full Sync: 30일 이상 오프라인이던 기기가 수동으로 전체 동기화 요청
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

/** 수동 전체 동기화용 — 기기가 보유한 엔티티 ID 목록 (스냅샷 비교용) */
export interface FullSyncManifest {
  /** 장기기억 청크 ID 목록 */
  memoryChunkIds: string[];
  /** 대화 세션 ID 목록 */
  conversationIds: string[];
  /** 설정 키 목록 */
  settingKeys: string[];
  /** 이 매니페스트를 생성한 시각 */
  generatedAt: string;
}

/** 수동 전체 동기화 결과 */
export interface FullSyncResult {
  success: boolean;
  /** 내가 상대로부터 받아야 할 ID 목록 */
  missingFromMe: { memoryChunkIds: string[]; conversationIds: string[]; settingKeys: string[] };
  /** 상대가 나로부터 받아야 할 ID 목록 */
  missingFromThem: { memoryChunkIds: string[]; conversationIds: string[]; settingKeys: string[] };
  error?: string;
}

/** Realtime broadcast 메시지 타입 */
export type BroadcastMessage =
  | { type: "sync_request"; fromDeviceId: string; versionVector: VersionVector }
  | { type: "sync_response"; fromDeviceId: string; deltas: SyncDelta[] }
  | { type: "delta_ack"; fromDeviceId: string; sourceDeviceId: string; lastSeq: number }
  | { type: "full_sync_request"; fromDeviceId: string; manifest: FullSyncManifest }
  | { type: "full_sync_manifest_response"; fromDeviceId: string; manifest: FullSyncManifest }
  | { type: "full_sync_data"; fromDeviceId: string; entityType: string; entityId: string; encryptedPayload: string; iv: string; authTag: string }
  | { type: "full_sync_complete"; fromDeviceId: string; sentCount: number };

/** 재조정기 설정 */
export interface ReconcilerConfig {
  supabase: SupabaseClient;
  userId: string;
  deviceId: string;
  /** 로컬 저널 보관 기간 (ms). 기본 30일 */
  journalRetentionMs?: number;
  /** 델타 적용 콜백 */
  onApplyDelta?: (delta: SyncDelta) => Promise<void>;
  /** 갭 감지 시 콜백 (디버깅용) */
  onGapDetected?: (fromDevice: string, expected: number, received: number) => void;

  // --- 수동 전체 동기화 콜백 ---

  /** 내 기기의 매니페스트(엔티티 ID 목록) 생성 */
  onBuildManifest?: () => Promise<FullSyncManifest>;
  /** 상대 기기가 요청한 특정 엔티티를 암호화하여 반환 */
  onExportEntity?: (entityType: string, entityId: string) => Promise<{
    encryptedPayload: string;
    iv: string;
    authTag: string;
  } | null>;
  /** 상대 기기가 보내준 엔티티를 수신하여 로컬에 저장 */
  onImportEntity?: (entityType: string, entityId: string, encryptedPayload: string, iv: string, authTag: string) => Promise<void>;
  /** 수동 동기화 진행 상황 콜백 */
  onFullSyncProgress?: (phase: "comparing" | "receiving" | "sending" | "complete", current: number, total: number) => void;
}

// ============================================
// Constants
// ============================================

const DEFAULT_JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
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

  /** 수동 전체 동기화 진행 중 여부 */
  private fullSyncInProgress = false;

  /** 수동 전체 동기화 Promise resolver (요청 측에서 응답 대기용) */
  private fullSyncResolver: {
    resolve: (result: FullSyncResult) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  /** 수동 전체 동기화 수신 카운터 */
  private fullSyncReceivedCount = 0;
  private fullSyncExpectedCount = 0;

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
        console.log(
          `[Reconciler] ACK from ${msg.fromDeviceId}: received up to seq ${msg.lastSeq} from ${msg.sourceDeviceId}`,
        );
        break;
      case "full_sync_request":
        await this.handleFullSyncRequest(msg);
        break;
      case "full_sync_manifest_response":
        await this.handleFullSyncManifestResponse(msg);
        break;
      case "full_sync_data":
        await this.handleFullSyncData(msg);
        break;
      case "full_sync_complete":
        this.handleFullSyncComplete(msg);
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
  // Manual Full Sync (수동 전체 동기화)
  // ============================================

  /**
   * 수동 전체 동기화 요청 (이용자가 "동기화" 버튼을 눌렀을 때).
   *
   * 30일 이상 오프라인이었던 기기가 다른 온라인 기기에게
   * "내 데이터 목록은 이건데, 없는 거 보내줘" 라고 요청.
   *
   * 흐름:
   * 1. 내 매니페스트(엔티티 ID 목록) 생성 → broadcast
   * 2. 상대 기기가 자기 매니페스트를 응답
   * 3. 양쪽이 서로 비교 → 빠진 엔티티를 broadcast로 전송
   * 4. 수신 측이 로컬에 저장
   *
   * @param timeoutMs 응답 대기 시간 (기본 60초). 상대 기기가 없으면 타임아웃.
   */
  async requestFullSync(timeoutMs = 60_000): Promise<FullSyncResult> {
    if (!this.broadcastChannel) {
      return {
        success: false,
        missingFromMe: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        missingFromThem: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        error: "Broadcast channel not connected",
      };
    }

    if (this.fullSyncInProgress) {
      return {
        success: false,
        missingFromMe: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        missingFromThem: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        error: "Full sync already in progress",
      };
    }

    if (!this.config.onBuildManifest) {
      return {
        success: false,
        missingFromMe: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        missingFromThem: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        error: "onBuildManifest callback not configured",
      };
    }

    this.fullSyncInProgress = true;
    this.fullSyncReceivedCount = 0;
    this.fullSyncExpectedCount = 0;
    this.config.onFullSyncProgress?.("comparing", 0, 0);

    console.log("[Reconciler] Starting manual full sync...");

    // 내 매니페스트 생성
    const myManifest = await this.config.onBuildManifest();

    // 상대에게 전체 동기화 요청 + 내 매니페스트 전송
    const msg: BroadcastMessage = {
      type: "full_sync_request",
      fromDeviceId: this.config.deviceId,
      manifest: myManifest,
    };

    this.broadcastChannel.send({
      type: "broadcast",
      event: "sync_msg",
      payload: msg,
    });

    // 응답 대기 (Promise로 감싸서 타임아웃 처리)
    return new Promise<FullSyncResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.fullSyncInProgress = false;
        this.fullSyncResolver = null;
        resolve({
          success: false,
          missingFromMe: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
          missingFromThem: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
          error: "Timeout: no response from other devices. Are they online?",
        });
      }, timeoutMs);

      this.fullSyncResolver = { resolve, timeout };
    });
  }

  /**
   * 수동 전체 동기화 진행 중 여부
   */
  isFullSyncInProgress(): boolean {
    return this.fullSyncInProgress;
  }

  /**
   * 상대 기기의 full_sync_request 처리 (응답 측).
   *
   * 1. 상대 매니페스트와 내 매니페스트 비교
   * 2. 내 매니페스트를 응답으로 전송
   * 3. 상대에게 없는 엔티티를 전송
   */
  private async handleFullSyncRequest(
    msg: Extract<BroadcastMessage, { type: "full_sync_request" }>,
  ): Promise<void> {
    if (!this.config.onBuildManifest || !this.config.onExportEntity) {
      console.log("[Reconciler] Full sync request received but callbacks not configured, ignoring");
      return;
    }

    console.log(`[Reconciler] Full sync request from ${msg.fromDeviceId}`);

    // 내 매니페스트 생성
    const myManifest = await this.config.onBuildManifest();

    // 내 매니페스트를 응답으로 전송 (상대가 나한테 없는 것도 보내줄 수 있게)
    this.broadcastChannel?.send({
      type: "broadcast",
      event: "sync_msg",
      payload: {
        type: "full_sync_manifest_response",
        fromDeviceId: this.config.deviceId,
        manifest: myManifest,
      } satisfies BroadcastMessage,
    });

    // 상대에게 없는 엔티티 찾기
    const theirManifest = msg.manifest;
    const missingEntities = this.diffManifests(myManifest, theirManifest);
    const totalToSend = missingEntities.length;

    console.log(`[Reconciler] Sending ${totalToSend} missing entities to ${msg.fromDeviceId}`);

    // 빠진 엔티티를 하나씩 전송
    let sentCount = 0;
    for (const { entityType, entityId } of missingEntities) {
      const exported = await this.config.onExportEntity(entityType, entityId);
      if (!exported) continue;

      this.broadcastChannel?.send({
        type: "broadcast",
        event: "sync_msg",
        payload: {
          type: "full_sync_data",
          fromDeviceId: this.config.deviceId,
          entityType,
          entityId,
          encryptedPayload: exported.encryptedPayload,
          iv: exported.iv,
          authTag: exported.authTag,
        } satisfies BroadcastMessage,
      });

      sentCount++;
    }

    // 전송 완료 알림
    this.broadcastChannel?.send({
      type: "broadcast",
      event: "sync_msg",
      payload: {
        type: "full_sync_complete",
        fromDeviceId: this.config.deviceId,
        sentCount,
      } satisfies BroadcastMessage,
    });
  }

  /**
   * 상대 기기의 매니페스트 응답 처리 (요청 측).
   *
   * 상대 매니페스트를 받아서 내가 가지고 있고 상대에게 없는 것도 전송.
   */
  private async handleFullSyncManifestResponse(
    msg: Extract<BroadcastMessage, { type: "full_sync_manifest_response" }>,
  ): Promise<void> {
    if (!this.fullSyncInProgress || !this.config.onBuildManifest || !this.config.onExportEntity) {
      return;
    }

    console.log(`[Reconciler] Received manifest from ${msg.fromDeviceId}`);

    const myManifest = await this.config.onBuildManifest();
    const theirManifest = msg.manifest;

    // 내가 가지고 있고 상대에게 없는 것 → 내가 보내줌
    const missingFromThem = this.diffManifests(myManifest, theirManifest);

    // 상대가 가지고 있고 나한테 없는 것 → 상대가 보내줄 예정
    const missingFromMe = this.diffManifests(theirManifest, myManifest);

    this.fullSyncExpectedCount = missingFromMe.length;

    console.log(
      `[Reconciler] Diff: I'm missing ${missingFromMe.length}, they're missing ${missingFromThem.length}`,
    );

    // 내가 가진 것 중 상대에게 없는 것 전송
    let sentCount = 0;
    for (const { entityType, entityId } of missingFromThem) {
      const exported = await this.config.onExportEntity(entityType, entityId);
      if (!exported) continue;

      this.broadcastChannel?.send({
        type: "broadcast",
        event: "sync_msg",
        payload: {
          type: "full_sync_data",
          fromDeviceId: this.config.deviceId,
          entityType,
          entityId,
          encryptedPayload: exported.encryptedPayload,
          iv: exported.iv,
          authTag: exported.authTag,
        } satisfies BroadcastMessage,
      });

      sentCount++;
    }

    // 전송 완료 알림
    this.broadcastChannel?.send({
      type: "broadcast",
      event: "sync_msg",
      payload: {
        type: "full_sync_complete",
        fromDeviceId: this.config.deviceId,
        sentCount,
      } satisfies BroadcastMessage,
    });

    // 상대에서 받을 것이 없으면 바로 완료
    if (missingFromMe.length === 0) {
      this.resolveFullSync({
        success: true,
        missingFromMe: { memoryChunkIds: [], conversationIds: [], settingKeys: [] },
        missingFromThem: this.groupEntities(missingFromThem),
      });
    }
  }

  /**
   * 수동 전체 동기화 데이터 수신.
   */
  private async handleFullSyncData(
    msg: Extract<BroadcastMessage, { type: "full_sync_data" }>,
  ): Promise<void> {
    if (!this.config.onImportEntity) return;

    await this.config.onImportEntity(
      msg.entityType,
      msg.entityId,
      msg.encryptedPayload,
      msg.iv,
      msg.authTag,
    );

    this.fullSyncReceivedCount++;
    this.config.onFullSyncProgress?.(
      "receiving",
      this.fullSyncReceivedCount,
      this.fullSyncExpectedCount || this.fullSyncReceivedCount,
    );
  }

  /**
   * 상대 기기의 전송 완료 알림 처리.
   */
  private handleFullSyncComplete(
    msg: Extract<BroadcastMessage, { type: "full_sync_complete" }>,
  ): void {
    console.log(
      `[Reconciler] Full sync complete from ${msg.fromDeviceId}: sent ${msg.sentCount} entities`,
    );

    if (this.fullSyncInProgress) {
      this.config.onFullSyncProgress?.("complete", this.fullSyncReceivedCount, this.fullSyncReceivedCount);

      this.resolveFullSync({
        success: true,
        missingFromMe: {
          memoryChunkIds: [],
          conversationIds: [],
          settingKeys: [],
        },
        missingFromThem: {
          memoryChunkIds: [],
          conversationIds: [],
          settingKeys: [],
        },
      });
    }
  }

  /**
   * Full sync Promise resolve + 정리
   */
  private resolveFullSync(result: FullSyncResult): void {
    if (this.fullSyncResolver) {
      clearTimeout(this.fullSyncResolver.timeout);
      this.fullSyncResolver.resolve(result);
      this.fullSyncResolver = null;
    }
    this.fullSyncInProgress = false;
    this.fullSyncReceivedCount = 0;
    this.fullSyncExpectedCount = 0;
  }

  // ============================================
  // Manifest Helpers
  // ============================================

  /**
   * 두 매니페스트 비교: source에 있고 target에 없는 엔티티 목록 반환.
   */
  private diffManifests(
    source: FullSyncManifest,
    target: FullSyncManifest,
  ): Array<{ entityType: string; entityId: string }> {
    const result: Array<{ entityType: string; entityId: string }> = [];

    const targetMemorySet = new Set(target.memoryChunkIds);
    for (const id of source.memoryChunkIds) {
      if (!targetMemorySet.has(id)) {
        result.push({ entityType: "memory_chunk", entityId: id });
      }
    }

    const targetConvSet = new Set(target.conversationIds);
    for (const id of source.conversationIds) {
      if (!targetConvSet.has(id)) {
        result.push({ entityType: "conversation", entityId: id });
      }
    }

    const targetSettingSet = new Set(target.settingKeys);
    for (const key of source.settingKeys) {
      if (!targetSettingSet.has(key)) {
        result.push({ entityType: "setting", entityId: key });
      }
    }

    return result;
  }

  /**
   * 엔티티 목록을 타입별로 그룹화
   */
  private groupEntities(
    entities: Array<{ entityType: string; entityId: string }>,
  ): { memoryChunkIds: string[]; conversationIds: string[]; settingKeys: string[] } {
    const memoryChunkIds: string[] = [];
    const conversationIds: string[] = [];
    const settingKeys: string[] = [];

    for (const { entityType, entityId } of entities) {
      switch (entityType) {
        case "memory_chunk": memoryChunkIds.push(entityId); break;
        case "conversation": conversationIds.push(entityId); break;
        case "setting": settingKeys.push(entityId); break;
      }
    }

    return { memoryChunkIds, conversationIds, settingKeys };
  }

  // ============================================
  // Journal Management
  // ============================================

  /**
   * 저널에서 보관 기간이 지난 항목 삭제.
   * 기본 30일 — 이 기간 내에 재연결하면 재전송 가능.
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
      fullSyncInProgress: this.fullSyncInProgress,
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
  fullSyncInProgress: boolean;
}
