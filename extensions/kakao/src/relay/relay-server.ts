/**
 * Relay API Server Routes
 *
 * HTTP API endpoints for device-side communication:
 * - POST /api/relay/pair     — Complete device pairing with code
 * - GET  /api/relay/poll     — Poll for pending commands (long-polling)
 * - POST /api/relay/result   — Submit command execution result
 * - POST /api/relay/heartbeat — Device heartbeat
 * - GET  /api/relay/devices  — List user's devices (requires auth)
 * - DELETE /api/relay/device — Remove a device
 * - POST /api/relay/progress — Device sends execution progress update
 *
 * All device endpoints require Authorization: Bearer <device_token>
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PairRequest, ResultSubmission, RelayCallbacks } from "./types.js";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import {
  authenticateDevice,
  completePairing,
  updateHeartbeat,
  listUserDevices,
  removeDevice,
} from "./device-auth.js";
import { appendExecutionLog } from "./relay-handler.js";
import {
  signup,
  login,
  verifyPassword,
} from "../auth/user-accounts.js";
import {
  hasBackupPassword,
  setBackupPassword,
  verifyBackupPassword,
  resetBackupPasswordWithRecoveryKey,
  updateLastBackupTime,
} from "../auth/backup-credentials.js";
import {
  generateRecoveryKey,
  createEncryptedBackup,
  restoreFromBackup,
  initializeVault,
  listBackups,
} from "../safety/index.js";

const LONG_POLL_TIMEOUT_MS = 30_000; // 30 seconds
const POLL_INTERVAL_MS = 2_000; // Check every 2 seconds during long-poll

/**
 * Handle relay API requests. Returns true if the request was handled.
 */
export async function handleRelayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  },
  callbacks?: RelayCallbacks,
): Promise<boolean> {
  const url = req.url ?? "";

  if (!url.startsWith("/api/relay/")) {
    return false;
  }

  // CORS headers for device clients (restrict to known origins)
  const allowedOrigins = (process.env.RELAY_ALLOWED_ORIGINS ?? "https://mymoa.app,http://localhost:3000").split(",");
  const origin = req.headers.origin ?? "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  const path = url.split("?")[0];

  try {
    switch (path) {
      case "/api/relay/pair":
        if (req.method === "POST") {
          await handlePair(req, res, logger, callbacks);
          return true;
        }
        break;
      case "/api/relay/poll":
        if (req.method === "GET") {
          await handlePoll(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/result":
        if (req.method === "POST") {
          await handleResult(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/heartbeat":
        if (req.method === "POST") {
          await handleHeartbeat(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/devices":
        if (req.method === "GET") {
          await handleListDevices(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/device":
        if (req.method === "DELETE") {
          await handleRemoveDevice(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/progress":
        if (req.method === "POST") {
          await handleProgress(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/auth/signup":
        if (req.method === "POST") {
          await handleAuthSignup(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/auth/login":
        if (req.method === "POST") {
          await handleAuthLogin(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/auth/backup":
        if (req.method === "POST") {
          await handleBackupRequest(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/auth/restore":
        if (req.method === "POST") {
          await handleRestoreRequest(req, res, logger);
          return true;
        }
        break;
      case "/api/relay/auth/backup/reset-password":
        if (req.method === "POST") {
          await handleBackupResetPassword(req, res, logger);
          return true;
        }
        break;
    }

    // Unknown relay endpoint
    sendJSON(res, 404, { error: "Not Found" });
    return true;
  } catch (err) {
    logger.error(`[relay] API error: ${err}`);
    sendJSON(res, 500, { error: "Internal Server Error" });
    return true;
  }
}

// ============================================
// Route Handlers
// ============================================

/**
 * POST /api/relay/pair
 * Body: { code: string, device: DeviceRegistration }
 */
async function handlePair(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
  callbacks?: RelayCallbacks,
) {
  const body = await readBody<PairRequest>(req);
  if (!body?.code || !body?.device?.deviceName) {
    sendJSON(res, 400, { error: "code and device.deviceName are required" });
    return;
  }

  const result = await completePairing(body.code, body.device);

  if (result.success) {
    logger.info(`[relay] Device paired: ${body.device.deviceName}`);
    sendJSON(res, 200, {
      success: true,
      deviceToken: result.deviceToken,
      deviceId: result.deviceId,
    });

    // Fire onPairingComplete callback (non-blocking)
    if (callbacks?.onPairingComplete && result.userId && result.deviceId) {
      callbacks
        .onPairingComplete({
          userId: result.userId,
          deviceId: result.deviceId,
          deviceName: body.device.deviceName,
        })
        .catch?.((err: unknown) => {
          logger.error(`[relay] onPairingComplete callback error: ${err}`);
        });
    }
  } else {
    sendJSON(res, 400, { success: false, error: result.error });
  }
}

/**
 * GET /api/relay/poll
 * Header: Authorization: Bearer <device_token>
 * Supports long-polling: waits up to 30s for pending commands.
 */
async function handlePoll(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  if (!isSupabaseConfigured()) {
    sendJSON(res, 200, { commands: [] });
    return;
  }

  const supabase = getSupabase();
  const startTime = Date.now();

  // Long-polling loop: check for commands, wait if none
  while (Date.now() - startTime < LONG_POLL_TIMEOUT_MS) {
    const { data } = await supabase.rpc("claim_relay_commands", {
      p_device_token: device.deviceToken,
      p_limit: 10,
    });

    if (data && data.length > 0) {
      logger.info(`[relay] Delivering ${data.length} command(s) to ${device.deviceName}`);
      sendJSON(res, 200, {
        commands: data.map((cmd: Record<string, unknown>) => ({
          commandId: cmd.command_id,
          encryptedCommand: cmd.encrypted_command,
          iv: cmd.iv,
          authTag: cmd.auth_tag,
          priority: cmd.priority,
          createdAt: cmd.created_at,
        })),
      });
      return;
    }

    // Wait before next check
    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout — return empty
  sendJSON(res, 200, { commands: [] });
}

/**
 * POST /api/relay/result
 * Header: Authorization: Bearer <device_token>
 * Body: ResultSubmission
 */
async function handleResult(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  const body = await readBody<ResultSubmission>(req);
  if (!body?.commandId) {
    sendJSON(res, 400, { error: "commandId is required" });
    return;
  }

  if (!isSupabaseConfigured()) {
    sendJSON(res, 200, { success: true });
    return;
  }

  const supabase = getSupabase();

  const { data: success } = await supabase.rpc("submit_relay_result", {
    p_command_id: body.commandId,
    p_device_token: device.deviceToken,
    p_encrypted_result: body.encryptedResult ?? "",
    p_result_iv: body.resultIv ?? "",
    p_result_auth_tag: body.resultAuthTag ?? "",
    p_result_summary: body.resultSummary ?? "",
    p_status: body.status ?? "completed",
  });

  if (success) {
    logger.info(`[relay] Result received for command ${body.commandId} from ${device.deviceName}`);
    sendJSON(res, 200, { success: true });
  } else {
    sendJSON(res, 404, { success: false, error: "Command not found or not owned by device" });
  }
}

/**
 * POST /api/relay/heartbeat
 * Header: Authorization: Bearer <device_token>
 */
async function handleHeartbeat(
  req: IncomingMessage,
  res: ServerResponse,
  _logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  const pendingCommands = await updateHeartbeat(device.deviceToken);

  sendJSON(res, 200, {
    ok: true,
    pendingCommands,
  });
}

/**
 * GET /api/relay/devices
 * Header: Authorization: Bearer <device_token>
 * Returns all devices belonging to the same user.
 */
async function handleListDevices(
  req: IncomingMessage,
  res: ServerResponse,
  _logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  const devices = await listUserDevices(device.userId);

  sendJSON(res, 200, {
    devices: devices.map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      deviceType: d.deviceType,
      platform: d.platform,
      isOnline: d.isOnline,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      capabilities: d.capabilities,
    })),
  });
}

/**
 * DELETE /api/relay/device?name=<device_name>
 * Header: Authorization: Bearer <device_token>
 */
async function handleRemoveDevice(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  const url = new URL(req.url ?? "", "http://localhost");
  const name = url.searchParams.get("name");

  if (!name) {
    sendJSON(res, 400, { error: "name query parameter required" });
    return;
  }

  const removed = await removeDevice(device.userId, name);
  if (removed) {
    logger.info(`[relay] Device removed: ${name}`);
    sendJSON(res, 200, { success: true });
  } else {
    sendJSON(res, 404, { success: false, error: "Device not found" });
  }
}

/**
 * POST /api/relay/progress
 * Header: Authorization: Bearer <device_token>
 * Body: { commandId: string, event: string, message: string, data?: string }
 *
 * Allows devices to send real-time execution progress updates.
 * Users can view these via /원격결과 <id> in KakaoTalk.
 */
async function handleProgress(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const device = await authFromHeader(req);
  if (!device) {
    sendJSON(res, 401, { error: "Invalid or missing device token" });
    return;
  }

  const body = await readBody<{ commandId: string; event: string; message: string; data?: string }>(
    req,
  );
  if (!body?.commandId || !body?.event || !body?.message) {
    sendJSON(res, 400, { error: "commandId, event, and message are required" });
    return;
  }

  const success = await appendExecutionLog(body.commandId, device.deviceToken, {
    event: body.event,
    message: body.message,
    data: body.data,
  });

  if (success) {
    logger.info(`[relay] Progress update for ${body.commandId}: ${body.event}`);
    sendJSON(res, 200, { success: true });
  } else {
    sendJSON(res, 404, { success: false, error: "Command not found or not owned by device" });
  }
}

/**
 * POST /api/relay/auth/signup
 * Body: { username: string, password: string, device: { deviceName, deviceType, platform } }
 */
async function handleAuthSignup(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const body = await readBody<{
    username: string;
    password: string;
    device: { deviceName: string; deviceType: string; platform: string };
  }>(req);

  if (!body?.username || !body?.password || !body?.device?.deviceName) {
    sendJSON(res, 400, { success: false, error: "username, password, device.deviceName are required" });
    return;
  }

  const result = signup(body.username, body.password, body.device);

  if (result.success) {
    logger.info(`[relay] Account created: ${body.username} (device: ${body.device.deviceName})`);
    sendJSON(res, 200, {
      success: true,
      deviceToken: result.deviceToken,
    });
  } else {
    sendJSON(res, 400, { success: false, error: result.error });
  }
}

/**
 * POST /api/relay/auth/login
 * Body: { username: string, password: string, device?: { deviceName, deviceType, platform } }
 *
 * device가 포함되면 새 기기를 자동 등록합니다.
 */
async function handleAuthLogin(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const body = await readBody<{
    username: string;
    password: string;
    device?: { deviceName: string; deviceType: string; platform: string };
  }>(req);

  if (!body?.username || !body?.password) {
    sendJSON(res, 400, { success: false, error: "username and password are required" });
    return;
  }

  const result = login(body.username, body.password, body.device);

  if (result.success) {
    const deviceNote = result.isNewDevice
      ? ` (new device: ${body.device?.deviceName})`
      : body.device ? ` (existing device: ${body.device.deviceName})` : "";
    logger.info(`[relay] Login: ${body.username}${deviceNote}`);
    sendJSON(res, 200, {
      success: true,
      deviceToken: result.deviceToken,
      isNewDevice: result.isNewDevice,
      existingDevices: result.existingDevices,
    });
  } else {
    sendJSON(res, 400, { success: false, error: result.error });
  }
}

/**
 * POST /api/relay/auth/backup
 * Body: { username, password, backupPassword, backupPasswordConfirm? }
 *
 * 백업 요청:
 * - 첫 백업: 계정 인증 + 백업 비밀번호 설정 → 복구키(12단어) 발급 + 암호화 백업 생성
 * - 이후 백업: 계정 인증 + 백업 비밀번호 확인 → 암호화 백업 생성
 */
async function handleBackupRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const body = await readBody<{
    username: string;
    password: string;
    backupPassword: string;
    backupPasswordConfirm?: string;
  }>(req);

  if (!body?.username || !body?.password || !body?.backupPassword) {
    sendJSON(res, 400, { success: false, error: "username, password, backupPassword are required" });
    return;
  }

  // 1. 계정 인증
  if (!verifyPassword(body.username, body.password)) {
    sendJSON(res, 401, { success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }

  const isFirstBackup = !hasBackupPassword(body.username);

  try {
    initializeVault();
    let recoveryWords: string[] | undefined;

    if (isFirstBackup) {
      // 첫 백업 — 백업 비밀번호 설정 + 복구키 발급
      if (body.backupPasswordConfirm && body.backupPassword !== body.backupPasswordConfirm) {
        sendJSON(res, 400, { success: false, error: "백업 비밀번호가 일치하지 않습니다." });
        return;
      }

      const recovery = generateRecoveryKey();
      recoveryWords = recovery.words;

      const setError = setBackupPassword(body.username, body.backupPassword, recovery.hash);
      if (setError) {
        sendJSON(res, 400, { success: false, error: setError });
        return;
      }
    } else {
      // 이후 백업 — 백업 비밀번호 확인
      if (!verifyBackupPassword(body.username, body.backupPassword)) {
        sendJSON(res, 401, { success: false, error: "백업 비밀번호가 올바르지 않습니다." });
        return;
      }
    }

    // 암호화 백업 생성 (백업 비밀번호로 암호화)
    const backupData = {
      timestamp: Date.now(),
      source: "user_request",
      username: body.username,
    };
    const backup = createEncryptedBackup(backupData, body.backupPassword, "manual");
    updateLastBackupTime(body.username);

    logger.info(`[relay] Backup created for ${body.username}: ${backup.filePath.split("/").pop()}`);

    sendJSON(res, 200, {
      success: true,
      isFirstBackup,
      recoveryWords,
      backupFile: backup.filePath.split("/").pop(),
      backupSize: backup.size,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[relay] Backup error for ${body.username}: ${err}`);
    sendJSON(res, 500, { success: false, error: "백업 생성 중 오류가 발생했습니다." });
  }
}

/**
 * POST /api/relay/auth/restore
 * Body: { username, password, backupPassword, backupFile? }
 *
 * 복원 요청: 계정 인증 + 백업 비밀번호 → 최신 백업 복호화
 */
async function handleRestoreRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const body = await readBody<{
    username: string;
    password: string;
    backupPassword: string;
    backupFile?: string;
  }>(req);

  if (!body?.username || !body?.password || !body?.backupPassword) {
    sendJSON(res, 400, { success: false, error: "username, password, backupPassword are required" });
    return;
  }

  if (!verifyPassword(body.username, body.password)) {
    sendJSON(res, 401, { success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }

  if (!verifyBackupPassword(body.username, body.backupPassword)) {
    sendJSON(res, 401, { success: false, error: "백업 비밀번호가 올바르지 않습니다." });
    return;
  }

  try {
    const backups = listBackups();
    if (backups.length === 0) {
      sendJSON(res, 404, { success: false, error: "저장된 백업이 없습니다." });
      return;
    }

    // 특정 파일 지정 또는 최신 백업
    let target = backups[0]; // 최신
    if (body.backupFile) {
      const found = backups.find(
        (b) => b.fileName === body.backupFile || b.filePath.endsWith(body.backupFile!),
      );
      if (!found) {
        sendJSON(res, 404, { success: false, error: `"${body.backupFile}" 백업 파일을 찾을 수 없습니다.` });
        return;
      }
      target = found;
    }

    const restored = restoreFromBackup(target.filePath, body.backupPassword);
    if (!restored) {
      sendJSON(res, 400, { success: false, error: "백업 복원에 실패했습니다. 백업 비밀번호를 확인하세요." });
      return;
    }

    logger.info(`[relay] Backup restored for ${body.username}: ${target.fileName}`);

    sendJSON(res, 200, {
      success: true,
      backupFile: target.fileName,
      timestamp: restored.timestamp,
      verified: restored.verified,
    });
  } catch (err) {
    logger.error(`[relay] Restore error for ${body.username}: ${err}`);
    sendJSON(res, 500, { success: false, error: "복원 중 오류가 발생했습니다." });
  }
}

/**
 * POST /api/relay/auth/backup/reset-password
 * Body: { username, password, recoveryWords: string[], newBackupPassword }
 *
 * 복구키(12단어)로 백업 비밀번호 재설정
 */
async function handleBackupResetPassword(
  req: IncomingMessage,
  res: ServerResponse,
  logger: ReturnType<typeof console>,
) {
  const body = await readBody<{
    username: string;
    password: string;
    recoveryWords: string[];
    newBackupPassword: string;
  }>(req);

  if (!body?.username || !body?.password || !body?.recoveryWords || !body?.newBackupPassword) {
    sendJSON(res, 400, {
      success: false,
      error: "username, password, recoveryWords, newBackupPassword are required",
    });
    return;
  }

  if (!verifyPassword(body.username, body.password)) {
    sendJSON(res, 401, { success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }

  if (body.recoveryWords.length !== 12) {
    sendJSON(res, 400, { success: false, error: "복구키는 12단어여야 합니다." });
    return;
  }

  const error = resetBackupPasswordWithRecoveryKey(
    body.username,
    body.recoveryWords,
    body.newBackupPassword,
  );

  if (error) {
    sendJSON(res, 400, { success: false, error });
    return;
  }

  logger.info(`[relay] Backup password reset for ${body.username}`);
  sendJSON(res, 200, { success: true });
}

// ============================================
// Helpers
// ============================================

async function authFromHeader(req: IncomingMessage) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  return authenticateDevice(token);
}

async function readBody<T>(req: IncomingMessage): Promise<T | null> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
