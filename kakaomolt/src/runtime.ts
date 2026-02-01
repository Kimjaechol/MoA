// Runtime type is injected at plugin load time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KakaoPluginRuntime = any;

let runtime: KakaoPluginRuntime = null;

/**
 * Set the Kakao plugin runtime
 */
export function setKakaoRuntime(next: KakaoPluginRuntime): void {
  runtime = next;
}

/**
 * Get the Kakao plugin runtime
 */
export function getKakaoRuntime(): KakaoPluginRuntime {
  if (!runtime) {
    throw new Error("Kakao runtime not initialized. Plugin may not be loaded properly.");
  }
  return runtime;
}

/**
 * Check if runtime is initialized
 */
export function isKakaoRuntimeInitialized(): boolean {
  return runtime !== null;
}
