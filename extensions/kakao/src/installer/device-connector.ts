/**
 * 디바이스 자동 연결 시스템
 *
 * 설치 후 자동으로:
 * 1. MoA 서버에 등록
 * 2. 주기적 heartbeat 전송
 * 3. 명령 폴링
 * 4. 메모리 동기화
 */

import { createHash, randomBytes } from "node:crypto";
import { hostname, platform, type, release, arch } from "node:os";

export interface DeviceInfo {
  /** 고유 디바이스 ID (설치 시 생성, 로컬 저장) */
  deviceId: string;
  /** 사용자가 지정한 디바이스 이름 */
  deviceName: string;
  /** 디바이스 타입 */
  deviceType: "desktop" | "laptop" | "phone" | "tablet" | "server" | "raspberry_pi";
  /** 플랫폼 */
  platform: "windows" | "macos" | "linux" | "android" | "ios";
  /** OS 버전 */
  osVersion: string;
  /** 아키텍처 */
  arch: string;
  /** 기능 목록 */
  capabilities: string[];
}

export interface ConnectionState {
  /** 연결 상태 */
  status: "connected" | "connecting" | "disconnected" | "error";
  /** 마지막 heartbeat 시간 */
  lastHeartbeat: Date | null;
  /** 마지막 에러 */
  lastError: string | null;
  /** 서버 URL */
  serverUrl: string;
  /** 인증 토큰 */
  authToken: string | null;
}

/**
 * 디바이스 정보 자동 감지
 */
export function detectDeviceInfo(): Omit<DeviceInfo, "deviceId" | "deviceName"> {
  const os = platform();
  const osType = type();
  const osRelease = release();
  const cpuArch = arch();

  // 플랫폼 판별
  let detectedPlatform: DeviceInfo["platform"];
  if (os === "win32") detectedPlatform = "windows";
  else if (os === "darwin") detectedPlatform = "macos";
  else if (os === "linux") detectedPlatform = "linux";
  else if (os === "android") detectedPlatform = "android";
  else detectedPlatform = "linux"; // fallback

  // 디바이스 타입 추론
  let deviceType: DeviceInfo["deviceType"] = "desktop";
  const hostName = hostname().toLowerCase();
  if (hostName.includes("laptop") || hostName.includes("macbook") || hostName.includes("notebook")) {
    deviceType = "laptop";
  } else if (hostName.includes("server") || hostName.includes("srv")) {
    deviceType = "server";
  } else if (hostName.includes("pi") || hostName.includes("raspberry")) {
    deviceType = "raspberry_pi";
  }

  // 기능 목록
  const capabilities: string[] = ["shell", "file_read", "file_write", "file_list"];
  if (detectedPlatform === "macos" || detectedPlatform === "linux") {
    capabilities.push("screenshot", "clipboard");
  }
  if (detectedPlatform === "windows") {
    capabilities.push("screenshot", "clipboard", "browser_open");
  }

  return {
    deviceType,
    platform: detectedPlatform,
    osVersion: `${osType} ${osRelease}`,
    arch: cpuArch,
    capabilities,
  };
}

/**
 * 고유 디바이스 ID 생성 (설치 시 1회)
 */
export function generateDeviceId(): string {
  const hostName = hostname();
  const platformInfo = platform();
  const random = randomBytes(16).toString("hex");
  const combined = `${hostName}-${platformInfo}-${random}-${Date.now()}`;
  return createHash("sha256").update(combined).digest("hex").slice(0, 32);
}

/**
 * 기본 디바이스 이름 생성
 */
export function generateDefaultDeviceName(): string {
  const hostName = hostname();
  const os = platform();

  // 친숙한 이름으로 변환
  let osName = "";
  if (os === "win32") osName = "PC";
  else if (os === "darwin") osName = "Mac";
  else if (os === "linux") osName = "Linux";
  else osName = os;

  // hostname에서 불필요한 부분 제거
  const cleanHost = hostName
    .replace(/\.local$/i, "")
    .replace(/\.lan$/i, "")
    .replace(/-pc$/i, "")
    .replace(/-desktop$/i, "")
    .slice(0, 20);

  return `${cleanHost}-${osName}`;
}

/**
 * 디바이스 연결 관리자
 */
export class DeviceConnector {
  private config: {
    serverUrl: string;
    pollInterval: number; // ms
    heartbeatInterval: number; // ms
    reconnectDelay: number; // ms
  };

  private state: ConnectionState = {
    status: "disconnected",
    lastHeartbeat: null,
    lastError: null,
    serverUrl: "",
    authToken: null,
  };

  private deviceInfo: DeviceInfo | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onCommandCallback: ((cmd: unknown) => Promise<unknown>) | null = null;

  constructor(serverUrl: string) {
    this.config = {
      serverUrl,
      pollInterval: 2000, // 2초마다 폴링
      heartbeatInterval: 30000, // 30초마다 heartbeat
      reconnectDelay: 5000, // 재연결 대기 5초
    };
    this.state.serverUrl = serverUrl;
  }

  /**
   * 페어링 코드로 초기 등록
   */
  async register(pairingCode: string, deviceName?: string): Promise<{
    success: boolean;
    token?: string;
    error?: string;
  }> {
    const detected = detectDeviceInfo();
    const deviceId = generateDeviceId();
    const name = deviceName ?? generateDefaultDeviceName();

    this.deviceInfo = {
      deviceId,
      deviceName: name,
      ...detected,
    };

    try {
      const response = await fetch(`${this.config.serverUrl}/api/relay/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode,
          device: {
            deviceId,
            deviceName: name,
            deviceType: detected.deviceType,
            platform: detected.platform,
            osVersion: detected.osVersion,
            capabilities: detected.capabilities,
          },
        }),
      });

      const data = await response.json();

      if (data.success && data.token) {
        this.state.authToken = data.token;
        this.state.status = "connected";

        // 자동으로 폴링 및 heartbeat 시작
        this.startPolling();
        this.startHeartbeat();

        return { success: true, token: data.token };
      }

      return { success: false, error: data.error ?? "등록 실패" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "네트워크 오류";
      this.state.lastError = message;
      return { success: false, error: message };
    }
  }

  /**
   * 저장된 토큰으로 재연결
   */
  async reconnect(savedToken: string): Promise<boolean> {
    this.state.authToken = savedToken;
    this.state.status = "connecting";

    try {
      // Heartbeat로 연결 확인
      const response = await fetch(`${this.config.serverUrl}/api/relay/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedToken}`,
        },
      });

      if (response.ok) {
        this.state.status = "connected";
        this.startPolling();
        this.startHeartbeat();
        return true;
      }

      this.state.status = "error";
      this.state.lastError = "인증 실패 - 재등록 필요";
      return false;
    } catch (error) {
      this.state.status = "disconnected";
      this.state.lastError = error instanceof Error ? error.message : "연결 실패";
      return false;
    }
  }

  /**
   * 명령 수신 콜백 등록
   */
  onCommand(callback: (cmd: unknown) => Promise<unknown>): void {
    this.onCommandCallback = callback;
  }

  /**
   * 폴링 시작
   */
  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);

    const poll = async () => {
      if (!this.state.authToken || this.state.status !== "connected") return;

      try {
        const response = await fetch(`${this.config.serverUrl}/api/relay/poll`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.state.authToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            this.state.status = "error";
            this.state.lastError = "인증 만료";
            this.stopPolling();
          }
          return;
        }

        const data = await response.json();

        if (data.commands && data.commands.length > 0 && this.onCommandCallback) {
          for (const cmd of data.commands) {
            try {
              const result = await this.onCommandCallback(cmd);
              await this.submitResult(cmd.id, result);
            } catch (error) {
              await this.submitResult(cmd.id, {
                success: false,
                error: error instanceof Error ? error.message : "실행 오류",
              });
            }
          }
        }
      } catch (error) {
        // 네트워크 오류 - 재시도
        this.state.lastError = error instanceof Error ? error.message : "폴링 오류";
      }
    };

    // 즉시 1회 실행 후 주기적 실행
    poll();
    this.pollTimer = setInterval(poll, this.config.pollInterval);
  }

  /**
   * 폴링 중지
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Heartbeat 시작
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    const sendHeartbeat = async () => {
      if (!this.state.authToken) return;

      try {
        const response = await fetch(`${this.config.serverUrl}/api/relay/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.state.authToken}`,
          },
        });

        if (response.ok) {
          this.state.lastHeartbeat = new Date();
          this.state.status = "connected";
        }
      } catch {
        // 연결 끊김 - 재연결 시도
        this.state.status = "connecting";
      }
    };

    sendHeartbeat();
    this.heartbeatTimer = setInterval(sendHeartbeat, this.config.heartbeatInterval);
  }

  /**
   * 결과 제출
   */
  private async submitResult(commandId: string, result: unknown): Promise<void> {
    if (!this.state.authToken) return;

    try {
      await fetch(`${this.config.serverUrl}/api/relay/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.state.authToken}`,
        },
        body: JSON.stringify({ commandId, result }),
      });
    } catch {
      // 결과 전송 실패 - 로컬 로그
    }
  }

  /**
   * 연결 상태 조회
   */
  getState(): ConnectionState {
    return { ...this.state };
  }

  /**
   * 연결 해제
   */
  disconnect(): void {
    this.stopPolling();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.state.status = "disconnected";
    this.state.authToken = null;
  }
}
