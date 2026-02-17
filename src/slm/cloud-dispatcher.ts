/**
 * Cloud Dispatcher - SLM → JSON → MoA → Cloud API Pipeline
 *
 * Flow:
 * 1. SLM (Qwen3-0.6B) classifies intent, determines cloud is needed
 * 2. SLM calls prepareDelegation() → writes delegation JSON to ~/.moa/delegation/
 * 3. MoA system reads the JSON immediately (file watch + poll)
 * 4. Dispatches to Gemini 3.0 Flash (or Claude Opus 4.6) with context attached
 * 5. Cloud model responds → MoA delivers answer to user
 *
 * The JSON delegation file contains:
 * - context_summary: what the user discussed
 * - task_description: what needs to be done
 * - suggested_question: question for the cloud to ask the user
 * - instruction: what the cloud model should do with the context
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CLOUD_MODELS,
  type CloudStrategy,
} from "./ollama-installer.js";
import {
  type CloudDelegation,
  type QueuedCloudTask,
  dequeueOfflineTask,
  getOfflineQueue,
} from "./slm-router.js";

// ============================================
// Types
// ============================================

/** JSON file written by SLM for cloud dispatch */
export interface DelegationFile {
  id: string;
  createdAt: string;
  strategy: CloudStrategy;
  delegation: CloudDelegation;
  userMessage: string;
  /** SLM's instruction to cloud model */
  cloudInstruction: string;
  status: "pending" | "dispatching" | "completed" | "failed";
  result?: CloudDispatchResult;
}

export interface CloudDispatchResult {
  cloudModel: string;
  cloudProvider: string;
  response: string;
  userFacingMessage: string;
  dispatchedAt: string;
  completedAt: string;
  latencyMs: number;
}

export interface CloudDispatcherConfig {
  /** Send the cloud's response to the user */
  onCloudResponse?: (result: CloudDispatchResult, delegationId: string) => Promise<void>;
  /** Notify user that cloud processing has started */
  onDispatchStarted?: (delegationId: string, cloudModel: string) => void;
  /** Handle dispatch errors */
  onDispatchError?: (delegationId: string, error: string) => void;
}

// ============================================
// Constants
// ============================================

const MOA_DATA_DIR = path.join(os.homedir(), ".moa");
const DELEGATION_DIR = path.join(MOA_DATA_DIR, "delegation");

// Cloud API endpoints
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";

// ============================================
// Delegation File Management
// ============================================

function ensureDelegationDir(): void {
  if (!fs.existsSync(DELEGATION_DIR)) {
    fs.mkdirSync(DELEGATION_DIR, { recursive: true });
  }
}

/**
 * Write delegation JSON file for MoA system to pick up.
 *
 * Called after SLM's prepareDelegation() generates the context summary.
 * The JSON file acts as a message from SLM to the MoA dispatch system.
 */
export function writeDelegationFile(
  delegation: CloudDelegation,
  userMessage: string,
  strategy: CloudStrategy,
): string {
  ensureDelegationDir();

  const id = `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cloud = CLOUD_MODELS[strategy];

  const file: DelegationFile = {
    id,
    createdAt: new Date().toISOString(),
    strategy,
    delegation,
    userMessage,
    cloudInstruction: buildCloudInstruction(delegation, cloud.model),
    status: "pending",
  };

  const filePath = path.join(DELEGATION_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2));

  console.log(`[CloudDispatcher] Delegation file written: ${filePath}`);
  return id;
}

/**
 * Build the instruction that MoA sends to the cloud model.
 *
 * This tells Gemini 3.0 Flash (or Claude Opus 4.6):
 * "Here's the context summary from the local AI. Review the task status
 *  and ask the user how you can help."
 */
function buildCloudInstruction(delegation: CloudDelegation, cloudModel: string): string {
  return (
    `당신은 MoA AI 어시스턴트입니다. 로컬 AI(Qwen3-0.6B)가 사용자의 요청을 분석한 결과, ` +
    `${cloudModel}의 도움이 필요하다고 판단하여 당신에게 위임했습니다.\n\n` +
    `[컨텍스트 요약]\n${delegation.contextSummary}\n\n` +
    `[작업 설명]\n${delegation.taskDescription}\n\n` +
    `[요청사항]\n` +
    `위 작업의 상태를 검토한 후, 이용자에게 위 작업의 상황에 대해서 설명하고 ` +
    `"${delegation.suggestedUserQuestion}"라고 질문해주세요.\n\n` +
    `한국어로 응답해주세요. 친절하고 전문적인 톤을 유지해주세요.`
  );
}

/**
 * Read a delegation file
 */
export function readDelegationFile(id: string): DelegationFile | null {
  const filePath = path.join(DELEGATION_DIR, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DelegationFile;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Update delegation file status
 */
function updateDelegationFile(id: string, updates: Partial<DelegationFile>): void {
  const file = readDelegationFile(id);
  if (!file) return;

  const updated = { ...file, ...updates };
  const filePath = path.join(DELEGATION_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
}

/**
 * Get all pending delegation files
 */
export function getPendingDelegations(): DelegationFile[] {
  ensureDelegationDir();

  try {
    const files = fs.readdirSync(DELEGATION_DIR).filter((f) => f.endsWith(".json"));
    const delegations: DelegationFile[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(DELEGATION_DIR, file), "utf-8");
        const delegation = JSON.parse(content) as DelegationFile;
        if (delegation.status === "pending") {
          delegations.push(delegation);
        }
      } catch {
        // skip corrupted files
      }
    }

    return delegations;
  } catch {
    return [];
  }
}

/**
 * Clean up completed/old delegation files (older than 24h)
 */
export function cleanupDelegationFiles(): number {
  ensureDelegationDir();

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let cleaned = 0;

  try {
    const files = fs.readdirSync(DELEGATION_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(DELEGATION_DIR, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DelegationFile;
        if (
          content.status === "completed" ||
          content.status === "failed" ||
          new Date(content.createdAt).getTime() < cutoff
        ) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // remove corrupted files
        try { fs.unlinkSync(filePath); cleaned++; } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore
  }

  return cleaned;
}

// ============================================
// Cloud API Dispatch
// ============================================

/**
 * Dispatch a delegation to the cloud model API.
 *
 * This is the core of the SLM → Cloud pipeline:
 * 1. Read delegation JSON (written by SLM)
 * 2. Build API request with context_summary + cloud_instruction
 * 3. Call Gemini 3.0 Flash or Claude Opus 4.6
 * 4. Return the cloud model's response
 */
export async function dispatchToCloud(
  delegation: DelegationFile,
  apiKeys: { google?: string; anthropic?: string },
): Promise<CloudDispatchResult> {
  const cloud = CLOUD_MODELS[delegation.strategy];
  const startTime = Date.now();

  // Mark as dispatching
  updateDelegationFile(delegation.id, { status: "dispatching" });

  try {
    let response: string;

    if (cloud.provider === "google") {
      response = await callGeminiAPI(
        cloud.model,
        delegation.cloudInstruction,
        delegation.userMessage,
        apiKeys.google ?? "",
      );
    } else {
      response = await callAnthropicAPI(
        cloud.model,
        delegation.cloudInstruction,
        delegation.userMessage,
        apiKeys.anthropic ?? "",
      );
    }

    const result: CloudDispatchResult = {
      cloudModel: cloud.model,
      cloudProvider: cloud.provider,
      response,
      userFacingMessage: response,
      dispatchedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    };

    // Mark as completed
    updateDelegationFile(delegation.id, { status: "completed", result });

    console.log(
      `[CloudDispatcher] Dispatch complete: ${cloud.model} (${result.latencyMs}ms)`,
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Cloud dispatch failed";
    updateDelegationFile(delegation.id, { status: "failed" });
    throw new Error(errorMsg);
  }
}

/**
 * Call Google Gemini API (generativelanguage.googleapis.com)
 */
async function callGeminiAPI(
  model: string,
  systemInstruction: string,
  userMessage: string,
  apiKey: string,
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned empty response");
  }

  return text;
}

/**
 * Call Anthropic Claude API (api.anthropic.com)
 */
async function callAnthropicAPI(
  model: string,
  systemInstruction: string,
  userMessage: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemInstruction,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic API returned empty response");
  }

  return text;
}

// ============================================
// Dispatch Pipeline (Main Entry)
// ============================================

/**
 * Process a single SLM → Cloud delegation.
 *
 * Called by the MoA system when it detects a pending delegation JSON.
 * Sends context_summary + cloud_instruction to the cloud model,
 * then delivers the response to the user.
 */
export async function processCloudDelegation(
  delegationId: string,
  apiKeys: { google?: string; anthropic?: string },
  config?: CloudDispatcherConfig,
): Promise<CloudDispatchResult | null> {
  const delegation = readDelegationFile(delegationId);
  if (!delegation || delegation.status !== "pending") {
    return null;
  }

  const cloud = CLOUD_MODELS[delegation.strategy];
  config?.onDispatchStarted?.(delegationId, cloud.model);

  try {
    const result = await dispatchToCloud(delegation, apiKeys);
    await config?.onCloudResponse?.(result, delegationId);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    config?.onDispatchError?.(delegationId, errorMsg);
    return null;
  }
}

/**
 * Process all pending delegations (batch).
 *
 * Called periodically by the MoA heartbeat or on-demand.
 */
export async function processAllPendingDelegations(
  apiKeys: { google?: string; anthropic?: string },
  config?: CloudDispatcherConfig,
): Promise<{ processed: number; failed: number }> {
  const pending = getPendingDelegations();
  let processed = 0;
  let failed = 0;

  for (const delegation of pending) {
    const result = await processCloudDelegation(delegation.id, apiKeys, config);
    if (result) {
      processed++;
    } else {
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Deduplicate tasks by userMessage + taskDescription.
 * Keeps the most recent task per unique key and sums duplicateCounts.
 */
function deduplicateTasks(tasks: QueuedCloudTask[]): {
  unique: QueuedCloudTask[];
  duplicateIds: string[];
} {
  const seen = new Map<string, QueuedCloudTask>();
  const duplicateIds: string[] = [];

  for (const task of tasks) {
    const key = `${task.userMessage.trim().toLowerCase()}::${task.taskDescription.trim().toLowerCase()}`;
    const existing = seen.get(key);

    if (existing) {
      // Keep the one with more complete context
      duplicateIds.push(task.id);
      if (task.contextSummary.length > existing.contextSummary.length) {
        existing.contextSummary = task.contextSummary;
      }
      existing.duplicateCount = (existing.duplicateCount || 1) + (task.duplicateCount || 1);
    } else {
      seen.set(key, { ...task });
    }
  }

  return { unique: Array.from(seen.values()), duplicateIds };
}

/**
 * Process offline queue tasks that were recovered.
 *
 * When the device comes back online, queued tasks are dispatched.
 * Duplicate/identical events are merged into a single dispatch —
 * only one cloud API call per unique task.
 */
export async function dispatchRecoveredTasks(
  tasks: QueuedCloudTask[],
  apiKeys: { google?: string; anthropic?: string },
  config?: CloudDispatcherConfig,
): Promise<{ dispatched: number; failed: number; deduplicatedFrom: number }> {
  // Deduplicate: same userMessage + taskDescription → 1 dispatch
  const { unique, duplicateIds } = deduplicateTasks(tasks);

  if (unique.length < tasks.length) {
    console.log(
      `[CloudDispatcher] Deduplicated ${tasks.length} queued tasks → ${unique.length} unique`,
    );
  }

  // Remove duplicate entries from offline queue
  for (const id of duplicateIds) {
    dequeueOfflineTask(id);
  }

  let dispatched = 0;
  let failed = 0;

  for (const task of unique) {
    // Convert queued task to delegation file
    const delegationId = writeDelegationFile(
      {
        contextSummary: task.contextSummary,
        taskDescription: task.taskDescription,
        suggestedUserQuestion: "위 작업에 대해서 어떤 일을 도와드릴까요?",
      },
      task.userMessage,
      task.strategy,
    );

    // Process the delegation
    const result = await processCloudDelegation(delegationId, apiKeys, config);
    if (result) {
      // Remove from offline queue
      dequeueOfflineTask(task.id);
      dispatched++;
    } else {
      failed++;
    }
  }

  return { dispatched, failed, deduplicatedFrom: tasks.length };
}
