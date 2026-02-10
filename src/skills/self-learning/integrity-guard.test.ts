import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntegrityGuard } from "./integrity-guard.js";

describe("IntegrityGuard", () => {
  let tempDir: string;
  let guard: IntegrityGuard;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "moa-integrity-test-"));
    guard = new IntegrityGuard();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("computeFileHash", () => {
    it("computes a consistent SHA-256 hash for a file", () => {
      const filePath = join(tempDir, "test.txt");
      writeFileSync(filePath, "hello world", "utf-8");

      const hash1 = guard.computeFileHash(filePath);
      const hash2 = guard.computeFileHash(filePath);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it("returns empty string for nonexistent files", () => {
      const hash = guard.computeFileHash(join(tempDir, "nonexistent.txt"));
      expect(hash).toBe("");
    });

    it("produces different hashes for different content", () => {
      const file1 = join(tempDir, "a.txt");
      const file2 = join(tempDir, "b.txt");
      writeFileSync(file1, "content A", "utf-8");
      writeFileSync(file2, "content B", "utf-8");

      expect(guard.computeFileHash(file1)).not.toBe(guard.computeFileHash(file2));
    });
  });

  describe("registerProtectedFiles", () => {
    it("registers files and captures their current hash", () => {
      const filePath = join(tempDir, "config.json");
      writeFileSync(filePath, '{"key": "value"}', "utf-8");

      guard.registerProtectedFiles([filePath]);
      const list = guard.getProtectedFilesList();
      expect(list).toContain(filePath);
    });

    it("registers multiple files at once", () => {
      const file1 = join(tempDir, "a.md");
      const file2 = join(tempDir, "b.md");
      writeFileSync(file1, "# A", "utf-8");
      writeFileSync(file2, "# B", "utf-8");

      guard.registerProtectedFiles([file1, file2]);
      expect(guard.getProtectedFilesList()).toHaveLength(2);
    });
  });

  describe("checkIntegrity", () => {
    it("reports 'ok' when files are unchanged", () => {
      const filePath = join(tempDir, "stable.txt");
      writeFileSync(filePath, "stable content", "utf-8");

      guard.registerProtectedFiles([filePath]);
      const results = guard.checkIntegrity();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(results[0].file).toBe(filePath);
    });

    it("reports 'modified' when a file changes after registration", () => {
      const filePath = join(tempDir, "mutable.txt");
      writeFileSync(filePath, "original", "utf-8");

      guard.registerProtectedFiles([filePath]);

      // Mutate the file
      writeFileSync(filePath, "tampered", "utf-8");

      const results = guard.checkIntegrity();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("modified");
      expect(results[0].expectedHash).not.toBe(results[0].actualHash);
    });

    it("reports 'missing' when a registered file is deleted", () => {
      const filePath = join(tempDir, "ephemeral.txt");
      writeFileSync(filePath, "temp", "utf-8");

      guard.registerProtectedFiles([filePath]);

      // Delete the file
      rmSync(filePath);

      const results = guard.checkIntegrity();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("missing");
      expect(results[0].actualHash).toBe("");
    });
  });

  describe("hasIntegrityViolation", () => {
    it("returns false when all files are intact", () => {
      const filePath = join(tempDir, "safe.txt");
      writeFileSync(filePath, "safe", "utf-8");

      guard.registerProtectedFiles([filePath]);
      expect(guard.hasIntegrityViolation()).toBe(false);
    });

    it("returns true when a file has been modified", () => {
      const filePath = join(tempDir, "watched.txt");
      writeFileSync(filePath, "original", "utf-8");

      guard.registerProtectedFiles([filePath]);
      writeFileSync(filePath, "changed!", "utf-8");

      expect(guard.hasIntegrityViolation()).toBe(true);
    });
  });
});
