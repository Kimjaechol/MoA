/**
 * Real-time Voice Conversation
 *
 * Implements low-latency voice conversation using:
 * 1. OpenAI Realtime API (gpt-4o-realtime-preview)
 * 2. WebSocket-based audio streaming
 * 3. Server-side VAD (Voice Activity Detection)
 *
 * This enables natural, interrupt-capable voice conversations
 * without the traditional STT → LLM → TTS pipeline latency.
 */

import { EventEmitter } from "node:events";

// ============================================
// Types & Interfaces
// ============================================

export interface RealtimeConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (default: gpt-4o-realtime-preview) */
  model?: string;
  /** Voice for TTS (alloy, echo, shimmer, etc.) */
  voice?: string;
  /** System instructions for the AI */
  instructions?: string;
  /** Enable server-side VAD */
  enableVAD?: boolean;
  /** VAD threshold (0.0 - 1.0) */
  vadThreshold?: number;
  /** Silence duration to trigger end of speech (ms) */
  silenceDurationMs?: number;
  /** Maximum conversation duration (ms) */
  maxDurationMs?: number;
}

export interface RealtimeSession {
  id: string;
  userId: string;
  status: RealtimeStatus;
  createdAt: Date;
  turnCount: number;
  audioStats: {
    inputBytes: number;
    outputBytes: number;
    latencyMs: number[];
  };
}

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "closed";

export interface RealtimeEvents {
  // Connection events
  "session.created": (session: RealtimeSession) => void;
  "session.connected": (session: RealtimeSession) => void;
  "session.error": (error: Error) => void;
  "session.closed": (reason: string) => void;

  // Voice events
  "input.started": () => void;
  "input.audio": (chunk: Buffer) => void;
  "input.ended": () => void;
  "input.transcript": (text: string, isFinal: boolean) => void;

  // AI events
  "response.started": () => void;
  "response.audio": (chunk: Buffer) => void;
  "response.text": (text: string, isFinal: boolean) => void;
  "response.ended": () => void;

  // Function calling
  "function.call": (name: string, args: unknown) => void;
  "function.result": (name: string, result: unknown) => void;
}

// ============================================
// OpenAI Realtime API Messages
// ============================================

interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

interface SessionCreateMessage extends RealtimeMessage {
  type: "session.create";
  session: {
    model: string;
    voice: string;
    instructions: string;
    input_audio_format: "pcm16" | "g711_ulaw" | "g711_alaw";
    output_audio_format: "pcm16" | "g711_ulaw" | "g711_alaw";
    turn_detection: {
      type: "server_vad";
      threshold: number;
      prefix_padding_ms: number;
      silence_duration_ms: number;
    } | null;
    tools?: Array<{
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  };
}

interface InputAudioBufferAppend extends RealtimeMessage {
  type: "input_audio_buffer.append";
  audio: string; // base64 encoded audio
}

interface ResponseCreate extends RealtimeMessage {
  type: "response.create";
  response?: {
    modalities?: string[];
    instructions?: string;
  };
}

// ============================================
// Realtime Voice Client
// ============================================

const DEFAULT_CONFIG: Required<Omit<RealtimeConfig, "apiKey">> = {
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "nova", // Good for Korean
  instructions: `You are a helpful AI assistant speaking in Korean.
Be concise and natural in your responses.
Use a friendly, conversational tone.`,
  enableVAD: true,
  vadThreshold: 0.5,
  silenceDurationMs: 500,
  maxDurationMs: 600000, // 10 minutes
};

/**
 * Real-time Voice Client
 *
 * Connects to OpenAI's Realtime API for low-latency voice conversations.
 */
export class RealtimeVoiceClient extends EventEmitter {
  private config: Required<RealtimeConfig>;
  private ws: WebSocket | null = null;
  private session: RealtimeSession | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private audioQueue: Buffer[] = [];
  private isProcessing = false;

  constructor(config: RealtimeConfig) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<RealtimeConfig>;
  }

  /**
   * Start a new real-time voice session
   */
  async connect(userId: string): Promise<RealtimeSession> {
    if (this.ws) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this.session = {
      id: `realtime-${userId}-${Date.now()}`,
      userId,
      status: "connecting",
      createdAt: new Date(),
      turnCount: 0,
      audioStats: {
        inputBytes: 0,
        outputBytes: 0,
        latencyMs: [],
      },
    };

    this.emit("session.created", this.session);

    try {
      await this.initializeWebSocket();
      return this.session;
    } catch (err) {
      this.session.status = "error";
      throw err;
    }
  }

  /**
   * Initialize WebSocket connection to OpenAI Realtime API
   */
  private async initializeWebSocket(): Promise<void> {
    const url = "wss://api.openai.com/v1/realtime";
    const params = new URLSearchParams({
      model: this.config.model,
    });

    // Note: In Node.js, you'll need a WebSocket library like 'ws'
    // This is a simplified implementation
    this.ws = new WebSocket(`${url}?${params}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    } as WebSocketOptions);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket not initialized"));

      this.ws.onopen = () => {
        this.session!.status = "connected";
        this.emit("session.connected", this.session);
        this.sendSessionConfig();
        resolve();
      };

      this.ws.onerror = (event) => {
        const error = new Error(`WebSocket error: ${event}`);
        this.emit("session.error", error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        this.handleClose(event.reason ?? "Connection closed");
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * Send session configuration
   */
  private sendSessionConfig(): void {
    const message: SessionCreateMessage = {
      type: "session.create",
      session: {
        model: this.config.model,
        voice: this.config.voice,
        instructions: this.config.instructions,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: this.config.enableVAD
          ? {
              type: "server_vad",
              threshold: this.config.vadThreshold,
              prefix_padding_ms: 300,
              silence_duration_ms: this.config.silenceDurationMs,
            }
          : null,
      },
    };

    this.send(message);
  }

  /**
   * Send audio chunk to the API
   */
  sendAudio(audioChunk: Buffer): void {
    if (!this.ws || this.session?.status !== "connected") {
      this.audioQueue.push(audioChunk);
      return;
    }

    // Update stats
    if (this.session) {
      this.session.audioStats.inputBytes += audioChunk.length;
    }

    const message: InputAudioBufferAppend = {
      type: "input_audio_buffer.append",
      audio: audioChunk.toString("base64"),
    };

    this.send(message);
    this.emit("input.audio", audioChunk);
  }

  /**
   * Trigger a response from the AI
   */
  requestResponse(instructions?: string): void {
    const message: ResponseCreate = {
      type: "response.create",
      response: instructions ? { instructions } : undefined,
    };

    this.send(message);
    this.session!.status = "thinking";
    this.emit("response.started");
  }

  /**
   * Handle incoming messages from the API
   */
  private handleMessage(data: unknown): void {
    try {
      const message = JSON.parse(String(data)) as RealtimeMessage;

      switch (message.type) {
        case "session.created":
          console.log("[realtime] Session created");
          break;

        case "session.updated":
          console.log("[realtime] Session updated");
          break;

        case "input_audio_buffer.speech_started":
          this.session!.status = "listening";
          this.emit("input.started");
          break;

        case "input_audio_buffer.speech_stopped":
          this.emit("input.ended");
          break;

        case "conversation.item.input_audio_transcription.completed":
          this.emit(
            "input.transcript",
            (message as { transcript: string }).transcript,
            true,
          );
          break;

        case "response.audio.delta":
          const audioData = Buffer.from(
            (message as { delta: string }).delta,
            "base64",
          );
          this.session!.audioStats.outputBytes += audioData.length;
          this.session!.status = "speaking";
          this.emit("response.audio", audioData);
          break;

        case "response.audio_transcript.delta":
          this.emit(
            "response.text",
            (message as { delta: string }).delta,
            false,
          );
          break;

        case "response.audio_transcript.done":
          this.emit(
            "response.text",
            (message as { transcript: string }).transcript,
            true,
          );
          break;

        case "response.done":
          this.session!.status = "connected";
          this.session!.turnCount++;
          this.emit("response.ended");
          break;

        case "response.function_call_arguments.done":
          const funcCall = message as {
            name: string;
            arguments: string;
          };
          this.emit(
            "function.call",
            funcCall.name,
            JSON.parse(funcCall.arguments),
          );
          break;

        case "error":
          const error = new Error(
            (message as { error: { message: string } }).error.message,
          );
          this.emit("session.error", error);
          break;

        default:
          // Log unknown message types for debugging
          console.log(`[realtime] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error("[realtime] Error handling message:", err);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(reason: string): void {
    this.ws = null;

    if (this.session) {
      this.session.status = "closed";
    }

    this.emit("session.closed", reason);
  }

  /**
   * Send a message through WebSocket
   */
  private send(message: RealtimeMessage): void {
    if (!this.ws) {
      throw new Error("Not connected");
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from the API
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.session) {
      this.session.status = "closed";
    }
  }

  /**
   * Get current session
   */
  getSession(): RealtimeSession | null {
    return this.session;
  }

  /**
   * Get average latency
   */
  getAverageLatency(): number {
    const latencies = this.session?.audioStats.latencyMs ?? [];
    if (latencies.length === 0) return 0;
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }
}

// WebSocket options type for Node.js compatibility
interface WebSocketOptions {
  headers?: Record<string, string>;
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a real-time voice client
 */
export function createRealtimeClient(config: RealtimeConfig): RealtimeVoiceClient {
  return new RealtimeVoiceClient(config);
}

/**
 * Check if real-time voice is available
 */
export function isRealtimeAvailable(): boolean {
  // Check for OpenAI API key
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.MOLTBOT_OPENAI_API_KEY
  );
}

// ============================================
// Usage Example (for documentation)
// ============================================

/*
Usage:

```typescript
import { createRealtimeClient } from './realtime-voice.js';

const client = createRealtimeClient({
  apiKey: process.env.OPENAI_API_KEY!,
  voice: 'nova',
  instructions: '한국어로 자연스럽게 대화해주세요.',
});

// Event handlers
client.on('session.connected', (session) => {
  console.log('Connected:', session.id);
});

client.on('input.transcript', (text, isFinal) => {
  console.log(`User said: ${text} (final: ${isFinal})`);
});

client.on('response.audio', (chunk) => {
  // Play audio chunk to user
  playAudio(chunk);
});

client.on('response.text', (text, isFinal) => {
  console.log(`AI said: ${text}`);
});

// Start session
const session = await client.connect('user-123');

// Send audio from microphone
microphone.on('data', (chunk) => {
  client.sendAudio(chunk);
});

// Cleanup
process.on('SIGINT', () => {
  client.disconnect();
});
```
*/
