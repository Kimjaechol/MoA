/**
 * Offline Monitor - Network Detection + Notifications + Auto-Recovery
 *
 * When SLM determines a cloud model is needed but the device is offline:
 *
 * 1. Detect offline state (WiFi + 5G both disconnected)
 * 2. Notify user through ALL channels:
 *    - In-app popup (native notification)
 *    - Push notification (even if app is backgrounded)
 *    - Chat message (visible in conversation)
 * 3. Each notification explains:
 *    - What task was being worked on
 *    - What the current situation is
 *    - That the cloud model was needed but can't be reached
 *    - The task is queued and will auto-send when online
 * 4. Periodic network check (every 30s):
 *    - Poll connectivity
 *    - On recovery → auto-dispatch queued tasks
 *    - Notify user that tasks are being processed
 */

import * as os from "os";
import {
  getOfflineQueue,
  checkOfflineRecovery,
  type QueuedCloudTask,
} from "./slm-router.js";
import { CLOUD_MODELS, type CloudStrategy } from "./ollama-installer.js";
import {
  dispatchRecoveredTasks,
  type CloudDispatcherConfig,
} from "./cloud-dispatcher.js";

// ============================================
// Types
// ============================================

export type NotificationChannel = "popup" | "push" | "chat";

export interface OfflineNotification {
  type: "offline_detected" | "task_queued" | "online_recovered" | "task_dispatched";
  channels: NotificationChannel[];
  title: string;
  body: string;
  taskId?: string;
  taskDescription?: string;
  timestamp: string;
}

export interface OfflineMonitorConfig {
  /** Interval for periodic network checks (ms). Default: 30000 (30s) */
  checkIntervalMs?: number;
  /** Send popup/native notification */
  onPopupNotification?: (notification: OfflineNotification) => Promise<void>;
  /** Send push notification (FCM/APNs) */
  onPushNotification?: (notification: OfflineNotification) => Promise<void>;
  /** Send chat message in conversation */
  onChatNotification?: (notification: OfflineNotification) => Promise<void>;
  /** API keys for cloud dispatch on recovery */
  apiKeys?: { google?: string; anthropic?: string };
  /** Cloud dispatch callbacks */
  dispatchConfig?: CloudDispatcherConfig;
}

export interface OfflineMonitorStatus {
  isOnline: boolean;
  isMonitoring: boolean;
  queuedTaskCount: number;
  lastCheckAt: string | null;
  lastOnlineAt: string | null;
  checkIntervalMs: number;
}

// ============================================
// Network Detection
// ============================================

/**
 * Check if the device has any active network connection.
 * Tests by reaching a lightweight endpoint (Google 204 + Cloudflare DNS).
 */
export async function checkNetworkStatus(): Promise<{
  online: boolean;
  latencyMs: number;
}> {
  const startTime = Date.now();

  // Try multiple endpoints to be sure
  const endpoints = [
    "https://www.google.com/generate_204",
    "https://1.1.1.1/cdn-cgi/trace",
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 204) {
        return { online: true, latencyMs: Date.now() - startTime };
      }
    } catch {
      // try next endpoint
    }
  }

  return { online: false, latencyMs: Date.now() - startTime };
}

/**
 * Get detailed network interface info (for diagnostic display)
 */
export function getNetworkInterfaces(): Array<{
  name: string;
  type: string;
  address: string;
}> {
  const interfaces = os.networkInterfaces();
  const result: Array<{ name: string; type: string; address: string }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      result.push({
        name,
        type: addr.family === "IPv4" ? "IPv4" : "IPv6",
        address: addr.address,
      });
    }
  }

  return result;
}

// ============================================
// Notification Builder
// ============================================

function buildOfflineNotification(
  task: QueuedCloudTask,
): OfflineNotification {
  const cloud = CLOUD_MODELS[task.strategy];

  return {
    type: "task_queued",
    channels: ["popup", "push", "chat"],
    title: "MoA: 오프라인 - 작업 대기 중",
    body:
      `현재 인터넷에 연결되어 있지 않습니다.\n\n` +
      `📋 작업: ${task.taskDescription}\n` +
      `📝 상황: ${task.contextSummary}\n` +
      `🤖 필요한 AI: ${cloud.model} (${cloud.provider})\n\n` +
      `위 작업은 고급 AI 모델(${cloud.model})이 필요하지만, ` +
      `현재 오프라인이라서 처리할 수 없습니다.\n\n` +
      `✅ 인터넷에 연결되면 자동으로 처리됩니다.\n` +
      `대기 중인 작업 수: ${getOfflineQueue().length}건`,
    taskId: task.id,
    taskDescription: task.taskDescription,
    timestamp: new Date().toISOString(),
  };
}

function buildOnlineRecoveryNotification(
  taskCount: number,
): OfflineNotification {
  return {
    type: "online_recovered",
    channels: ["popup", "push", "chat"],
    title: "MoA: 온라인 복귀 - 작업 처리 시작",
    body:
      `인터넷 연결이 복구되었습니다! 🎉\n\n` +
      `대기 중이던 ${taskCount}건의 작업을 클라우드 AI에 전송합니다.\n` +
      `잠시만 기다려주세요...`,
    timestamp: new Date().toISOString(),
  };
}

function buildTaskDispatchedNotification(
  dispatched: number,
  failed: number,
): OfflineNotification {
  const body = failed > 0
    ? `대기 중이던 작업 처리 완료!\n\n✅ 성공: ${dispatched}건\n❌ 실패: ${failed}건\n\n실패한 작업은 다시 시도됩니다.`
    : `대기 중이던 작업 ${dispatched}건이 모두 처리되었습니다! ✅`;

  return {
    type: "task_dispatched",
    channels: ["popup", "push", "chat"],
    title: "MoA: 대기 작업 처리 완료",
    body,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send notification through all configured channels
 */
async function sendNotification(
  notification: OfflineNotification,
  config: OfflineMonitorConfig,
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const channel of notification.channels) {
    switch (channel) {
      case "popup":
        if (config.onPopupNotification) {
          promises.push(
            config.onPopupNotification(notification).catch((error) => {
              console.warn("[OfflineMonitor] Popup notification failed:", error);
            }),
          );
        }
        break;
      case "push":
        if (config.onPushNotification) {
          promises.push(
            config.onPushNotification(notification).catch((error) => {
              console.warn("[OfflineMonitor] Push notification failed:", error);
            }),
          );
        }
        break;
      case "chat":
        if (config.onChatNotification) {
          promises.push(
            config.onChatNotification(notification).catch((error) => {
              console.warn("[OfflineMonitor] Chat notification failed:", error);
            }),
          );
        }
        break;
    }
  }

  await Promise.allSettled(promises);
}

// ============================================
// Offline Monitor (Periodic Network Check)
// ============================================

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let monitorConfig: OfflineMonitorConfig | null = null;
let lastOnlineAt: string | null = null;
let lastCheckAt: string | null = null;
let wasOnline = true;

/**
 * Start the offline monitor.
 *
 * Periodically checks network connectivity.
 * When a transition from offline → online is detected:
 * 1. Notify user (popup + push + chat)
 * 2. Auto-dispatch all queued tasks to cloud
 * 3. Notify user of dispatch results
 */
export function startOfflineMonitor(config: OfflineMonitorConfig): void {
  if (monitorInterval) {
    console.warn("[OfflineMonitor] Already running, stopping previous instance");
    stopOfflineMonitor();
  }

  const intervalMs = config.checkIntervalMs ?? 30_000;
  monitorConfig = config;

  console.log(`[OfflineMonitor] Starting with ${intervalMs}ms interval`);

  // Run initial check immediately
  performCheck().catch((error) => {
    console.error("[OfflineMonitor] Initial check failed:", error);
  });

  // Start periodic check
  monitorInterval = setInterval(() => {
    performCheck().catch((error) => {
      console.error("[OfflineMonitor] Periodic check failed:", error);
    });
  }, intervalMs);
}

/**
 * Stop the offline monitor
 */
export function stopOfflineMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorConfig = null;
  console.log("[OfflineMonitor] Stopped");
}

/**
 * Get current monitor status
 */
export function getOfflineMonitorStatus(): OfflineMonitorStatus {
  return {
    isOnline: wasOnline,
    isMonitoring: monitorInterval !== null,
    queuedTaskCount: getOfflineQueue().length,
    lastCheckAt,
    lastOnlineAt,
    checkIntervalMs: monitorConfig?.checkIntervalMs ?? 30_000,
  };
}

/**
 * Core periodic check logic
 */
async function performCheck(): Promise<void> {
  if (!monitorConfig) return;

  const { online } = await checkNetworkStatus();
  lastCheckAt = new Date().toISOString();

  if (online) {
    lastOnlineAt = lastCheckAt;
  }

  // Transition: offline → online (recovery!)
  if (online && !wasOnline) {
    console.log("[OfflineMonitor] Network recovered! Checking for queued tasks...");
    await handleOnlineRecovery(monitorConfig);
  }

  // Transition: online → offline (lost connection)
  if (!online && wasOnline) {
    console.log("[OfflineMonitor] Network lost! Monitoring for recovery...");
  }

  wasOnline = online;
}

/**
 * Handle the offline → online transition.
 *
 * 1. Notify user that we're back online
 * 2. Dispatch all queued tasks to cloud
 * 3. Notify user of results
 */
async function handleOnlineRecovery(config: OfflineMonitorConfig): Promise<void> {
  const recovery = await checkOfflineRecovery();

  if (!recovery.recovered || recovery.pendingTasks.length === 0) {
    return;
  }

  const taskCount = recovery.pendingTasks.length;

  // Step 1: Notify user — online recovery
  const recoveryNotification = buildOnlineRecoveryNotification(taskCount);
  await sendNotification(recoveryNotification, config);

  // Step 2: Dispatch queued tasks to cloud
  if (config.apiKeys) {
    try {
      const result = await dispatchRecoveredTasks(
        recovery.pendingTasks,
        config.apiKeys,
        config.dispatchConfig,
      );

      // Step 3: Notify user — dispatch results
      const dispatchNotification = buildTaskDispatchedNotification(
        result.dispatched,
        result.failed,
      );
      await sendNotification(dispatchNotification, config);
    } catch (error) {
      console.error("[OfflineMonitor] Failed to dispatch recovered tasks:", error);
    }
  }
}

// ============================================
// Manual Triggers (for SLM integration)
// ============================================

/**
 * Called when SLM detects a task needs cloud but device is offline.
 *
 * This is the entry point for the offline notification flow:
 * 1. Task is already queued in offline-queue.json by slm-router
 * 2. This function sends notifications to all channels
 *
 * Called from routeSLM() when offline queueing occurs.
 */
export async function notifyOfflineTaskQueued(
  task: QueuedCloudTask,
  config?: OfflineMonitorConfig,
): Promise<void> {
  const effectiveConfig = config ?? monitorConfig;
  if (!effectiveConfig) {
    console.warn("[OfflineMonitor] No config available for notifications");
    return;
  }

  const notification = buildOfflineNotification(task);
  await sendNotification(notification, effectiveConfig);
}

/**
 * Force an immediate network check + recovery attempt.
 *
 * Useful when user manually triggers "retry" or when
 * an external event suggests network may have recovered.
 */
export async function forceNetworkCheck(config?: OfflineMonitorConfig): Promise<{
  online: boolean;
  dispatched: number;
}> {
  const effectiveConfig = config ?? monitorConfig;
  const { online } = await checkNetworkStatus();
  lastCheckAt = new Date().toISOString();

  if (online) {
    lastOnlineAt = lastCheckAt;
  }

  if (!online || !effectiveConfig) {
    return { online, dispatched: 0 };
  }

  // Online — dispatch queued tasks
  const recovery = await checkOfflineRecovery();
  if (recovery.recovered && recovery.pendingTasks.length > 0 && effectiveConfig.apiKeys) {
    const result = await dispatchRecoveredTasks(
      recovery.pendingTasks,
      effectiveConfig.apiKeys,
      effectiveConfig.dispatchConfig,
    );
    return { online, dispatched: result.dispatched };
  }

  return { online, dispatched: 0 };
}
