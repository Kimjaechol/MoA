import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:http to avoid actually starting a server
vi.mock("node:http", () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
  })),
}));

describe("moa-gemini-free oauth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports loginGeminiFree function", async () => {
    const mod = await import("./oauth.js");
    expect(typeof mod.loginGeminiFree).toBe("function");
  });

  it("exports GeminiFreeCredentials type (module shape)", async () => {
    const mod = await import("./oauth.js");
    // loginGeminiFree is the main export
    expect(mod).toHaveProperty("loginGeminiFree");
  });
});

describe("moa-gemini-free plugin", () => {
  it("exports default plugin with correct structure", async () => {
    const mod = await import("./index.js");
    const plugin = mod.default;

    expect(plugin.id).toBe("moa-gemini-free");
    expect(plugin.name).toBe("MoA Gemini Free");
    expect(typeof plugin.register).toBe("function");
  });

  it("registers provider with correct id and aliases", async () => {
    const mod = await import("./index.js");
    const plugin = mod.default;

    let registeredProvider: Record<string, unknown> | null = null;
    const mockApi = {
      registerProvider: (config: Record<string, unknown>) => {
        registeredProvider = config;
      },
    };

    plugin.register(mockApi as never);

    expect(registeredProvider).not.toBeNull();
    expect(registeredProvider!.id).toBe("moa-gemini-free");
    expect(registeredProvider!.aliases).toEqual(["gemini-free", "moa-gemini"]);
    expect(Array.isArray(registeredProvider!.auth)).toBe(true);
    expect((registeredProvider!.auth as unknown[]).length).toBeGreaterThan(0);
  });

  it("auth method has correct id and kind", async () => {
    const mod = await import("./index.js");
    const plugin = mod.default;

    let registeredProvider: Record<string, unknown> | null = null;
    const mockApi = {
      registerProvider: (config: Record<string, unknown>) => {
        registeredProvider = config;
      },
    };

    plugin.register(mockApi as never);

    const auth = registeredProvider!.auth as Array<{
      id: string;
      kind: string;
      label: string;
    }>;
    expect(auth[0].id).toBe("oauth");
    expect(auth[0].kind).toBe("oauth");
  });
});
