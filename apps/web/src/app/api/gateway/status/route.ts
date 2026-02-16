/**
 * GET /api/gateway/status
 * Check the health of both the MoA Gateway and OpenClaw Agent.
 *
 * Proxies the Gateway's /health endpoint and checks OpenClaw agent availability.
 * Protected by ADMIN_SECRET — pass as ?secret= query param or Authorization header.
 *
 * Response: { online, url, channels, uptime, version, openclaw, timestamp }
 */

export const preferredRegion = "icn1";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getOpenClawStatus, isOpenClawConfigured } from "@/lib/openclaw-bridge";

export async function GET(request: NextRequest) {
  // Authenticate — require ADMIN_SECRET
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const { searchParams } = new URL(request.url);
    const querySecret = searchParams.get("secret");
    const headerAuth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (querySecret !== adminSecret && headerAuth !== adminSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const gatewayUrl = process.env.MOA_GATEWAY_URL;
  if (!gatewayUrl) {
    // Gateway not configured, but OpenClaw agent might still be available
    const openclawStatus = isOpenClawConfigured()
      ? await getOpenClawStatus()
      : { available: false, url: "" };

    return NextResponse.json({
      online: false,
      url: null,
      error: "MOA_GATEWAY_URL is not configured",
      openclaw: {
        configured: isOpenClawConfigured(),
        available: openclawStatus.available,
        url: openclawStatus.url || null,
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const healthUrl = `${gatewayUrl.replace(/\/$/, "")}/health`;
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(10_000), // 10s timeout
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json({
        online: false,
        url: gatewayUrl,
        error: `Gateway returned HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    }

    const data = await response.json() as Record<string, unknown>;

    // Check OpenClaw agent status in parallel
    const openclawStatus = isOpenClawConfigured()
      ? await getOpenClawStatus()
      : { available: false, url: "", configured: false };

    return NextResponse.json({
      online: true,
      url: gatewayUrl,
      channels: data.channels ?? [],
      uptime: data.uptime ?? null,
      version: data.version ?? null,
      openclaw: {
        configured: isOpenClawConfigured(),
        available: openclawStatus.available,
        url: openclawStatus.url || null,
        version: openclawStatus.version ?? null,
        skills: openclawStatus.skills ?? [],
        plugins: openclawStatus.plugins ?? [],
        uptime: openclawStatus.uptime ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      online: false,
      url: gatewayUrl,
      error: `Gateway unreachable: ${message}`,
      timestamp: new Date().toISOString(),
    });
  }
}
