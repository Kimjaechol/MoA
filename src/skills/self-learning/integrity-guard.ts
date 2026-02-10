import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IntegrityCheckResult } from "../types.js";

/**
 * Guards against prompt injection or config drift by monitoring
 * critical system files (SKILL.md, CLAUDE.md, core configs, etc.)
 * via SHA-256 hashes.
 */
export class IntegrityGuard {
  /** Map of file path -> expected SHA-256 hash */
  private readonly registry = new Map<string, string>();

  /** Compute the SHA-256 hex digest of a file's contents. */
  computeFileHash(filePath: string): string {
    if (!existsSync(filePath)) {
      return "";
    }
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Register one or more files for integrity monitoring.
   * Captures the current hash as the expected baseline.
   */
  registerProtectedFiles(files: string[]): void {
    for (const file of files) {
      const hash = this.computeFileHash(file);
      this.registry.set(file, hash);
    }
  }

  /**
   * Check all registered files against their expected hashes.
   * Returns a result per file indicating ok, modified, or missing.
   */
  checkIntegrity(): IntegrityCheckResult[] {
    const results: IntegrityCheckResult[] = [];

    for (const [file, expectedHash] of this.registry) {
      if (!existsSync(file)) {
        results.push({
          file,
          expectedHash,
          actualHash: "",
          status: "missing",
        });
        continue;
      }

      const actualHash = this.computeFileHash(file);
      results.push({
        file,
        expectedHash,
        actualHash,
        status: actualHash === expectedHash ? "ok" : "modified",
      });
    }

    return results;
  }

  /** Quick check: returns true if any registered file has been modified or is missing. */
  hasIntegrityViolation(): boolean {
    return this.checkIntegrity().some((r) => r.status !== "ok");
  }

  /** Return the list of all registered file paths. */
  getProtectedFilesList(): string[] {
    return [...this.registry.keys()];
  }
}
