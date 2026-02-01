/**
 * KakaoMolt Voice Handler
 *
 * Provides voice communication capabilities for KakaoTalk:
 * 1. Voice message processing (async: voice in → voice out)
 * 2. Real-time voice conversation (WebRTC-based)
 * 3. Integration with Moltbot's TTS/STT systems
 */

export interface VoiceConfig {
  /** STT provider: 'openai' | 'deepgram' | 'google' */
  sttProvider: "openai" | "deepgram" | "google";
  /** TTS provider: 'openai' | 'elevenlabs' | 'edge' */
  ttsProvider: "openai" | "elevenlabs" | "edge";
  /** TTS voice ID or name */
  ttsVoice: string;
  /** Enable auto-TTS for all responses */
  autoTts: boolean;
  /** Language code for STT/TTS */
  language: string;
  /** Gateway URL for Moltbot integration */
  gatewayUrl?: string;
}

export interface VoiceMessage {
  /** Audio data as base64 or URL */
  audio: string;
  /** Audio format (mp3, opus, wav, etc.) */
  format: string;
  /** Duration in seconds */
  duration?: number;
  /** User ID */
  userId: string;
  /** Session key for conversation continuity */
  sessionKey?: string;
}

export interface VoiceResponse {
  /** Success status */
  success: boolean;
  /** Transcribed text from user's voice */
  transcribedText?: string;
  /** AI response text */
  responseText?: string;
  /** TTS audio as base64 */
  audioBase64?: string;
  /** Audio format */
  audioFormat?: string;
  /** Audio duration in seconds */
  audioDuration?: number;
  /** Error message if failed */
  error?: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface RealtimeVoiceSession {
  sessionId: string;
  userId: string;
  status: "connecting" | "connected" | "speaking" | "listening" | "closed";
  startedAt: Date;
  lastActivity: Date;
}

/**
 * Default voice configuration
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  sttProvider: "openai",
  ttsProvider: "openai",
  ttsVoice: "nova", // Korean-friendly voice
  autoTts: true,
  language: "ko",
};

/**
 * Voice Handler for processing voice messages
 */
export class VoiceHandler {
  private config: VoiceConfig;
  private gatewayUrl: string;

  constructor(config: Partial<VoiceConfig> = {}) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.gatewayUrl = config.gatewayUrl ?? "http://localhost:18789";
  }

  /**
   * Process a voice message and return voice response
   *
   * Flow: Voice → STT → AI → TTS → Voice
   */
  async processVoiceMessage(message: VoiceMessage): Promise<VoiceResponse> {
    const startTime = Date.now();

    try {
      // Step 1: Speech-to-Text
      const transcription = await this.transcribeAudio(message.audio, message.format);

      if (!transcription.success || !transcription.text) {
        return {
          success: false,
          error: transcription.error ?? "Transcription failed",
        };
      }

      // Step 2: Process with AI (via Gateway)
      const aiResponse = await this.processWithAI(
        transcription.text,
        message.userId,
        message.sessionKey,
      );

      if (!aiResponse.success || !aiResponse.text) {
        return {
          success: false,
          transcribedText: transcription.text,
          error: aiResponse.error ?? "AI processing failed",
        };
      }

      // Step 3: Text-to-Speech
      const ttsResult = await this.synthesizeSpeech(aiResponse.text);

      if (!ttsResult.success) {
        // Return text response even if TTS fails
        return {
          success: true,
          transcribedText: transcription.text,
          responseText: aiResponse.text,
          error: `TTS failed: ${ttsResult.error}`,
          usage: aiResponse.usage,
        };
      }

      const processingTime = Date.now() - startTime;
      console.log(`[voice] Processed in ${processingTime}ms`);

      return {
        success: true,
        transcribedText: transcription.text,
        responseText: aiResponse.text,
        audioBase64: ttsResult.audioBase64,
        audioFormat: ttsResult.format,
        audioDuration: ttsResult.duration,
        usage: aiResponse.usage,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Transcribe audio to text (STT)
   */
  async transcribeAudio(
    audioData: string,
    format: string,
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      const response = await fetch(`${this.gatewayUrl}/api/stt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: audioData,
          format,
          provider: this.config.sttProvider,
          language: this.config.language,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as { text: string };
      return { success: true, text: data.text };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Process text with AI
   */
  async processWithAI(
    text: string,
    userId: string,
    sessionKey?: string,
  ): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    try {
      const response = await fetch(`${this.gatewayUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          userId,
          sessionKey: sessionKey ?? `kakao-voice-${userId}`,
          useMemory: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as {
        text: string;
        usage?: { inputTokens: number; outputTokens: number };
      };

      return {
        success: true,
        text: data.text,
        usage: data.usage,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Synthesize speech from text (TTS)
   */
  async synthesizeSpeech(text: string): Promise<{
    success: boolean;
    audioBase64?: string;
    format?: string;
    duration?: number;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.gatewayUrl}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          provider: this.config.ttsProvider,
          voice: this.config.ttsVoice,
          language: this.config.language,
          format: "mp3", // Widely compatible
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as {
        audio: string;
        format: string;
        duration?: number;
      };

      return {
        success: true,
        audioBase64: data.audio,
        format: data.format,
        duration: data.duration,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.gatewayUrl) {
      this.gatewayUrl = config.gatewayUrl;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): VoiceConfig {
    return { ...this.config };
  }
}

/**
 * Create a voice handler instance
 */
export function createVoiceHandler(config?: Partial<VoiceConfig>): VoiceHandler {
  return new VoiceHandler(config);
}

// ============================================
// Real-time Voice Session (for future WebRTC)
// ============================================

/**
 * Real-time voice session manager
 *
 * For future implementation of WebRTC-based real-time voice chat.
 * This is a placeholder for the full implementation.
 */
export interface RealtimeVoiceOptions {
  /** WebRTC signaling server URL */
  signalingUrl: string;
  /** STUN/TURN servers for NAT traversal */
  iceServers: RTCIceServer[];
  /** Use OpenAI Realtime API for low-latency voice */
  useOpenAIRealtime: boolean;
  /** Voice activity detection threshold */
  vadThreshold: number;
}

/**
 * Placeholder for real-time voice session
 *
 * Full implementation would include:
 * - WebRTC peer connection management
 * - Audio streaming with VAD
 * - OpenAI Realtime API integration
 * - Session state management
 */
export class RealtimeVoiceManager {
  private sessions: Map<string, RealtimeVoiceSession> = new Map();

  /**
   * Start a new real-time voice session
   */
  async startSession(userId: string): Promise<RealtimeVoiceSession> {
    const session: RealtimeVoiceSession = {
      sessionId: `rt-${userId}-${Date.now()}`,
      userId,
      status: "connecting",
      startedAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(session.sessionId, session);

    // TODO: Implement WebRTC connection setup
    // TODO: Implement OpenAI Realtime API connection

    return session;
  }

  /**
   * End a real-time voice session
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "closed";
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): RealtimeVoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): RealtimeVoiceSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status !== "closed",
    );
  }
}

// RTCIceServer type for WebRTC (Node.js compatibility)
interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
