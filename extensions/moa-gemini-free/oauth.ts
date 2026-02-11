/**
 * MoA Gemini Free OAuth — Google 계정 인증으로 Gemini 무료 사용
 *
 * Google의 Gemini Code Assist "Individuals" 무료 티어를 활용합니다.
 * 무료 한도: 60 요청/분, 1000 요청/일, 전체 Gemini 모델 사용 가능
 *
 * 작동 원리:
 *   1. Google OAuth 2.0 PKCE 플로우로 사용자 인증
 *   2. Google Code Assist API에서 프로젝트 자동 프로비저닝
 *   3. 발급받은 토큰으로 Gemini API 호출 (cloudcode-pa.googleapis.com)
 *
 * Gemini CLI의 공개 OAuth 크리덴셜을 사용합니다.
 * (Google의 "installed application" 정책에 따라 client_secret은
 *  비밀이 아니며, 공개 저장소에 게시되어 있습니다.)
 *
 * 참고: Google은 이 API가 내부용(private)이며 안정성을 보장하지
 * 않는다고 밝혔습니다. 무료 티어의 한도는 변경될 수 있습니다.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

// ─── OAuth Constants ───

// Gemini CLI 공개 OAuth 크리덴셜 (google-gemini/gemini-cli 공개 저장소에서 추출)
// "installed application" 타입이므로 client_secret은 비밀이 아닙니다.
const CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = "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";

const REDIRECT_URI = "http://localhost:8085/oauth2callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";

// ─── Types ───

export type GeminiFreeCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId: string;
};

export type GeminiFreeOAuthContext = {
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  log: (msg: string) => void;
  note: (message: string, title?: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
};

// ─── PKCE ───

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ─── Environment Detection ───

function isWSL2(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("wsl2") || version.includes("microsoft-standard");
  } catch {
    return false;
  }
}

function shouldUseManualFlow(isRemote: boolean): boolean {
  return isRemote || isWSL2();
}

// ─── Auth URL Construction ───

function buildAuthUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ─── Callback Parsing ───

function parseCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "입력값이 없습니다" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? expectedState;
    if (!code) {
      return { error: "URL에 'code' 파라미터가 없습니다" };
    }
    if (!state) {
      return { error: "'state' 파라미터가 없습니다. 전체 URL을 붙여넣어 주세요." };
    }
    return { code, state };
  } catch {
    if (!expectedState) {
      return { error: "코드만이 아니라 전체 리다이렉트 URL을 붙여넣어 주세요." };
    }
    return { code: trimmed, state: expectedState };
  }
}

// ─── Local Callback Server ───

const CALLBACK_HTML = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"/><title>MoA Gemini 인증 완료</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f4f8}
.card{background:white;border-radius:12px;padding:40px;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
h2{color:#1a73e8;margin-bottom:8px}p{color:#5f6368}</style></head>
<body><div class="card">
<h2>MoA Gemini 인증 완료!</h2>
<p>이 창을 닫고 터미널로 돌아가세요.</p>
</div></body></html>`;

async function waitForLocalCallback(params: {
  expectedState: string;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ code: string; state: string }> {
  const port = 8085;
  const hostname = "localhost";

  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", `http://${hostname}:${port}`);
        if (requestUrl.pathname !== "/oauth2callback") {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code")?.trim();
        const state = requestUrl.searchParams.get("state")?.trim();

        if (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end(`인증 실패: ${error}`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("코드 또는 상태 값 누락");
          finish(new Error("Missing OAuth code or state"));
          return;
        }

        if (state !== params.expectedState) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("상태 값 불일치");
          finish(new Error("OAuth state mismatch"));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(CALLBACK_HTML);
        finish(undefined, { code, state });
      } catch (err) {
        finish(err instanceof Error ? err : new Error("OAuth callback failed"));
      }
    });

    const finish = (err?: Error, result?: { code: string; state: string }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      try {
        server.close();
      } catch {
        /* ignore */
      }
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    server.once("error", (err) => {
      finish(err instanceof Error ? err : new Error("Callback server error"));
    });

    server.listen(port, hostname, () => {
      params.onProgress?.(`OAuth 콜백 대기 중 (${REDIRECT_URI})...`);
    });

    timeout = setTimeout(() => {
      finish(new Error("OAuth 콜백 타임아웃 (5분)"));
    }, params.timeoutMs);
  });
}

// ─── Token Exchange ───

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<GeminiFreeCredentials> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`토큰 교환 실패: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error("리프레시 토큰이 발급되지 않았습니다. 다시 시도해 주세요.");
  }

  const email = await getUserEmail(data.access_token);
  const projectId = await discoverProject(data.access_token);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: expiresAt,
    projectId,
    email,
  };
}

// ─── User Info ───

async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// ─── Project Discovery & Provisioning ───

async function discoverProject(accessToken: string): Promise<string> {
  const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/moa",
  };

  const loadBody = {
    cloudaicompanionProject: envProject,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
      duetProject: envProject,
    },
  };

  type LoadResponse = {
    currentTier?: { id?: string };
    cloudaicompanionProject?: string | { id?: string };
    allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  };

  let data: LoadResponse = {};

  try {
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers,
      body: JSON.stringify(loadBody),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      if (isVpcScAffected(errorPayload)) {
        data = { currentTier: { id: "standard-tier" } };
      } else {
        throw new Error(`loadCodeAssist 실패: ${response.status} ${response.statusText}`);
      }
    } else {
      data = (await response.json()) as LoadResponse;
    }
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error("loadCodeAssist 실패", { cause: err });
  }

  // 이미 프로젝트가 있는 경우
  if (data.currentTier) {
    const project = data.cloudaicompanionProject;
    if (typeof project === "string" && project) {
      return project;
    }
    if (typeof project === "object" && project?.id) {
      return project.id;
    }
    if (envProject) {
      return envProject;
    }
    throw new Error(
      "이 계정에는 GOOGLE_CLOUD_PROJECT 또는 GOOGLE_CLOUD_PROJECT_ID 환경 변수가 필요합니다.",
    );
  }

  // 신규 사용자 — 무료 티어로 온보딩
  const tier = getDefaultTier(data.allowedTiers);
  const tierId = tier?.id || TIER_FREE;

  if (tierId !== TIER_FREE && !envProject) {
    throw new Error(
      "이 계정에는 GOOGLE_CLOUD_PROJECT 또는 GOOGLE_CLOUD_PROJECT_ID 환경 변수가 필요합니다.",
    );
  }

  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  };
  if (tierId !== TIER_FREE && envProject) {
    onboardBody.cloudaicompanionProject = envProject;
    (onboardBody.metadata as Record<string, unknown>).duetProject = envProject;
  }

  const onboardResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    method: "POST",
    headers,
    body: JSON.stringify(onboardBody),
  });

  if (!onboardResponse.ok) {
    throw new Error(
      `사용자 온보딩 실패: ${onboardResponse.status} ${onboardResponse.statusText}`,
    );
  }

  let lro = (await onboardResponse.json()) as {
    done?: boolean;
    name?: string;
    response?: { cloudaicompanionProject?: { id?: string } };
  };

  // 비동기 작업인 경우 폴링
  if (!lro.done && lro.name) {
    lro = await pollOperation(lro.name, headers);
  }

  const projectId = lro.response?.cloudaicompanionProject?.id;
  if (projectId) {
    return projectId;
  }
  if (envProject) {
    return envProject;
  }

  throw new Error(
    "Google Cloud 프로젝트를 검색/프로비저닝할 수 없습니다. " +
      "GOOGLE_CLOUD_PROJECT 또는 GOOGLE_CLOUD_PROJECT_ID를 설정해 주세요.",
  );
}

function isVpcScAffected(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return false;
  }
  const details = (error as { details?: unknown[] }).details;
  if (!Array.isArray(details)) {
    return false;
  }
  return details.some(
    (item) =>
      typeof item === "object" &&
      item &&
      (item as { reason?: string }).reason === "SECURITY_POLICY_VIOLATED",
  );
}

function getDefaultTier(
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>,
): { id?: string } | undefined {
  if (!allowedTiers?.length) {
    return { id: TIER_LEGACY };
  }
  return allowedTiers.find((tier) => tier.isDefault) ?? { id: TIER_LEGACY };
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
): Promise<{ done?: boolean; response?: { cloudaicompanionProject?: { id?: string } } }> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`, {
      headers,
    });
    if (!response.ok) {
      continue;
    }
    const data = (await response.json()) as {
      done?: boolean;
      response?: { cloudaicompanionProject?: { id?: string } };
    };
    if (data.done) {
      return data;
    }
  }
  throw new Error("프로젝트 프로비저닝 타임아웃 (2분)");
}

// ─── Main Login Flow ───

/**
 * Google 계정으로 Gemini 무료 인증을 수행합니다.
 *
 * 플로우:
 *   1. PKCE 코드 생성
 *   2. Google OAuth 인증 URL 생성 & 브라우저 열기
 *   3. 로컬 콜백 서버 또는 수동 URL 입력으로 코드 수신
 *   4. 코드 → 토큰 교환
 *   5. 사용자 이메일 확인
 *   6. Google Cloud 프로젝트 발견/프로비저닝
 *   7. 크리덴셜 반환
 */
export async function loginGeminiFree(
  ctx: GeminiFreeOAuthContext,
): Promise<GeminiFreeCredentials> {
  const needsManual = shouldUseManualFlow(ctx.isRemote);

  await ctx.note(
    needsManual
      ? [
          "원격/VPS 환경에서 실행 중입니다.",
          "아래 URL을 로컬 브라우저에서 열어 Google 계정으로 로그인하세요.",
          "로그인 후 리다이렉트 URL을 복사하여 여기에 붙여넣어 주세요.",
        ].join("\n")
      : [
          "브라우저에서 Google 계정으로 로그인합니다.",
          "로그인하면 자동으로 인증이 완료됩니다.",
          "",
          "무료 한도: 60 요청/분, 1,000 요청/일",
          "사용 가능 모델: Gemini Pro, Flash 등 전체 모델",
        ].join("\n"),
    "MoA Gemini Free 인증",
  );

  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthUrl(challenge, verifier);

  if (needsManual) {
    ctx.progress.update("OAuth URL 준비됨");
    ctx.log(`\n아래 URL을 로컬 브라우저에서 열어주세요:\n\n${authUrl}\n`);
    ctx.progress.update("리다이렉트 URL 입력 대기 중...");
    const callbackInput = await ctx.prompt("리다이렉트 URL을 붙여넣어 주세요: ");
    const parsed = parseCallbackInput(callbackInput, verifier);
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    if (parsed.state !== verifier) {
      throw new Error("OAuth 상태 불일치 — 다시 시도해 주세요.");
    }
    ctx.progress.update("토큰 교환 중...");
    return exchangeCodeForTokens(parsed.code, verifier);
  }

  // 로컬 환경 — 브라우저 자동 열기 + 콜백 서버
  ctx.progress.update("브라우저에서 Google 로그인 중...");
  try {
    await ctx.openUrl(authUrl);
  } catch {
    ctx.log(`\n브라우저에서 이 URL을 열어주세요:\n\n${authUrl}\n`);
  }

  try {
    const { code } = await waitForLocalCallback({
      expectedState: verifier,
      timeoutMs: 5 * 60 * 1000,
      onProgress: (msg) => ctx.progress.update(msg),
    });
    ctx.progress.update("토큰 교환 중...");
    return await exchangeCodeForTokens(code, verifier);
  } catch (err) {
    // 포트 충돌 시 수동 모드로 전환
    if (
      err instanceof Error &&
      (err.message.includes("EADDRINUSE") ||
        err.message.includes("port") ||
        err.message.includes("listen"))
    ) {
      ctx.progress.update("콜백 서버 실패. 수동 모드로 전환...");
      ctx.log(`\n아래 URL을 브라우저에서 열어주세요:\n\n${authUrl}\n`);
      const callbackInput = await ctx.prompt("리다이렉트 URL을 붙여넣어 주세요: ");
      const parsed = parseCallbackInput(callbackInput, verifier);
      if ("error" in parsed) {
        throw new Error(parsed.error, { cause: err });
      }
      if (parsed.state !== verifier) {
        throw new Error("OAuth 상태 불일치 — 다시 시도해 주세요.", { cause: err });
      }
      ctx.progress.update("토큰 교환 중...");
      return exchangeCodeForTokens(parsed.code, verifier);
    }
    throw err;
  }
}
