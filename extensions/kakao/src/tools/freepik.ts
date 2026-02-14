/**
 * Freepik Tool — AI 이미지 생성 + 스톡 리소스 검색
 *
 * Freepik API 통합:
 * - 텍스트→이미지 생성 (Mystic, Flux, HyperFlux 모델)
 * - 이미지 업스케일링 (Creative, Precision V2)
 * - 스톡 리소스 검색 (사진, 벡터, PSD, AI 생성 이미지)
 * - 리소스 다운로드
 *
 * API 문서: https://docs.freepik.com
 * 인증: x-freepik-api-key 헤더
 */

const FREEPIK_BASE_URL = "https://api.freepik.com/v1";

// ==================== Types ====================

export interface FreepikGenerateResult {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  model: string;
  prompt: string;
}

export interface FreepikSearchResult {
  resources: Array<{
    id: string;
    title: string;
    url: string;
    thumbnailUrl: string;
    contentType: "photo" | "vector" | "psd" | "ai_generated";
    license: "freemium" | "premium";
    downloadUrl?: string;
  }>;
  total: number;
  query: string;
}

export interface FreepikUpscaleResult {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  imageUrl?: string;
  scaleFactor: number;
}

type FreepikModel = "mystic" | "flux" | "hyperflux" | "classic";
type FreepikAspectRatio = "square" | "landscape" | "portrait" | "widescreen";

// ==================== API Key ====================

function getApiKey(): string {
  const key = process.env.FREEPIK_API_KEY;
  if (!key) {
    throw new Error("Freepik API 키가 설정되지 않았습니다 (FREEPIK_API_KEY)");
  }
  return key;
}

function buildHeaders(): Record<string, string> {
  return {
    "x-freepik-api-key": getApiKey(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ==================== AI 이미지 생성 ====================

/**
 * Freepik Mystic (플래그십 모델) — 고품질 이미지 생성
 */
export async function generateWithMystic(
  prompt: string,
  options?: {
    aspectRatio?: FreepikAspectRatio;
    resolution?: "2k" | "4k";
    realism?: boolean;
  },
): Promise<FreepikGenerateResult> {
  const aspectRatioMap: Record<FreepikAspectRatio, string> = {
    square: "1:1",
    landscape: "4:3",
    portrait: "3:4",
    widescreen: "16:9",
  };

  const response = await fetch(`${FREEPIK_BASE_URL}/ai/mystic`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      prompt: enhancePrompt(prompt),
      aspect_ratio: aspectRatioMap[options?.aspectRatio ?? "square"],
      resolution: options?.resolution ?? "2k",
      realism: options?.realism ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik Mystic API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return parseGenerateResponse(data, "mystic", prompt);
}

/**
 * Freepik HyperFlux — 가장 빠른 이미지 생성
 */
export async function generateWithHyperFlux(
  prompt: string,
  options?: {
    aspectRatio?: FreepikAspectRatio;
  },
): Promise<FreepikGenerateResult> {
  const aspectRatioMap: Record<FreepikAspectRatio, string> = {
    square: "1:1",
    landscape: "4:3",
    portrait: "3:4",
    widescreen: "16:9",
  };

  const response = await fetch(`${FREEPIK_BASE_URL}/ai/text-to-image/hyperflux`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      prompt: enhancePrompt(prompt),
      aspect_ratio: aspectRatioMap[options?.aspectRatio ?? "square"],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik HyperFlux API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // HyperFlux is async — need to poll for result
  if (data.data?.task_id) {
    return await pollTaskStatus(
      `${FREEPIK_BASE_URL}/ai/text-to-image/hyperflux/${data.data.task_id}`,
      "hyperflux",
      prompt,
    );
  }

  return parseGenerateResponse(data, "hyperflux", prompt);
}

/**
 * Classic Fast — 가장 저렴한 이미지 생성
 */
export async function generateWithClassicFast(
  prompt: string,
): Promise<FreepikGenerateResult> {
  const response = await fetch(`${FREEPIK_BASE_URL}/ai/text-to-image`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      prompt: enhancePrompt(prompt),
      num_images: 1,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik Classic Fast API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return parseGenerateResponse(data, "classic", prompt);
}

/**
 * 통합 이미지 생성 — 모델 자동 선택
 *
 * 모델 선택 기준:
 * - mystic: 최고 품질 (기본)
 * - hyperflux: 빠른 생성 필요 시
 * - classic: 저렴한 비용
 */
export async function generateImage(
  prompt: string,
  options?: {
    model?: FreepikModel;
    aspectRatio?: FreepikAspectRatio;
    resolution?: "2k" | "4k";
    realism?: boolean;
  },
): Promise<FreepikGenerateResult> {
  const model = options?.model ?? "mystic";

  switch (model) {
    case "mystic":
      return generateWithMystic(prompt, options);
    case "hyperflux":
      return generateWithHyperFlux(prompt, { aspectRatio: options?.aspectRatio });
    case "classic":
      return generateWithClassicFast(prompt);
    case "flux":
      return generateWithMystic(prompt, options); // Flux Pro fallback to Mystic
    default:
      return generateWithMystic(prompt, options);
  }
}

// ==================== 이미지 업스케일 ====================

/**
 * 이미지 업스케일 (Precision V2 — 충실한 확대)
 */
export async function upscaleImage(
  imageBase64: string,
  options?: {
    scaleFactor?: 2 | 4;
    sharpen?: boolean;
    ultraDetail?: boolean;
  },
): Promise<FreepikUpscaleResult> {
  const response = await fetch(`${FREEPIK_BASE_URL}/ai/image-upscaler-precision-v2`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      image: imageBase64,
      scale_factor: options?.scaleFactor ?? 2,
      sharpen: options?.sharpen ?? true,
      ultra_detail: options?.ultraDetail ?? false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik Upscaler API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (data.data?.task_id) {
    return await pollUpscaleStatus(
      `${FREEPIK_BASE_URL}/ai/image-upscaler-precision/${data.data.task_id}`,
      options?.scaleFactor ?? 2,
    );
  }

  return {
    taskId: data.data?.task_id ?? "direct",
    status: "completed",
    imageUrl: data.data?.generated?.[0]?.url ?? data.data?.url,
    scaleFactor: options?.scaleFactor ?? 2,
  };
}

// ==================== 스톡 리소스 검색 ====================

/**
 * Freepik 스톡 리소스 검색
 */
export async function searchResources(
  query: string,
  options?: {
    contentType?: "photo" | "vector" | "psd" | "ai_generated";
    orientation?: "landscape" | "portrait" | "square" | "panoramic";
    license?: "freemium" | "premium";
    limit?: number;
    page?: number;
  },
): Promise<FreepikSearchResult> {
  const url = new URL(`${FREEPIK_BASE_URL}/resources`);
  url.searchParams.set("term", query);
  url.searchParams.set("limit", String(options?.limit ?? 5));
  url.searchParams.set("page", String(options?.page ?? 1));

  if (options?.contentType) {
    url.searchParams.set("content_type", options.contentType);
  }
  if (options?.orientation) {
    url.searchParams.set("orientation", options.orientation);
  }
  if (options?.license) {
    url.searchParams.set("license", options.license);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-freepik-api-key": getApiKey(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik 검색 API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    resources: (data.data ?? []).map((item: Record<string, unknown>) => ({
      id: String(item.id),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      thumbnailUrl: String(
        (item.image as Record<string, unknown>)?.source_url ??
        (item.thumbnails as Record<string, unknown>)?.["240"] ??
        "",
      ),
      contentType: String(item.content_type ?? "photo"),
      license: String(item.license ?? "freemium"),
    })),
    total: (data.meta as Record<string, unknown>)?.pagination
      ? Number((data.meta as Record<string, Record<string, unknown>>).pagination.total ?? 0)
      : 0,
    query,
  };
}

/**
 * 리소스 다운로드 URL 가져오기
 */
export async function getDownloadUrl(resourceId: string): Promise<string> {
  const response = await fetch(`${FREEPIK_BASE_URL}/resources/${resourceId}/download`, {
    method: "GET",
    headers: {
      "x-freepik-api-key": getApiKey(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freepik 다운로드 API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data?.url ?? "";
}

// ==================== 포맷터 ====================

/**
 * 이미지 생성 결과 → 메시지
 */
export function formatGenerateMessage(result: FreepikGenerateResult): string {
  const modelNames: Record<string, string> = {
    mystic: "Mystic (플래그십)",
    hyperflux: "HyperFlux (초고속)",
    classic: "Classic Fast (경제적)",
    flux: "Flux Pro",
  };

  const lines = [
    `🎨 Freepik AI 이미지 생성 완료!`,
    "",
    `🤖 모델: ${modelNames[result.model] ?? result.model}`,
    `📝 프롬프트: ${result.prompt}`,
  ];

  if (result.images.length > 0) {
    lines.push("");
    for (const img of result.images) {
      lines.push(img.url);
    }
  }

  return lines.join("\n");
}

/**
 * 검색 결과 → 메시지
 */
export function formatSearchMessage(result: FreepikSearchResult): string {
  if (result.resources.length === 0) {
    return `"${result.query}" 검색 결과가 없습니다.`;
  }

  const lines = [
    `🔍 Freepik 검색: "${result.query}" (${result.total}개 결과)`,
    "",
  ];

  for (const resource of result.resources) {
    const typeIcon =
      resource.contentType === "photo"
        ? "📷"
        : resource.contentType === "vector"
          ? "🎨"
          : resource.contentType === "ai_generated"
            ? "🤖"
            : "📄";
    const licenseTag = resource.license === "premium" ? " [프리미엄]" : "";

    lines.push(`${typeIcon} ${resource.title}${licenseTag}`);
    lines.push(`   ${resource.url}`);
  }

  return lines.join("\n");
}

/**
 * 업스케일 결과 → 메시지
 */
export function formatUpscaleMessage(result: FreepikUpscaleResult): string {
  if (result.status !== "completed" || !result.imageUrl) {
    return `⏳ 이미지 업스케일 처리 중... (${result.scaleFactor}x)`;
  }

  return [
    `🔍 이미지 업스케일 완료!`,
    "",
    `📐 확대: ${result.scaleFactor}x`,
    `${result.imageUrl}`,
  ].join("\n");
}

// ==================== Freepik 요청 감지 ====================

/**
 * 사용자 메시지에서 Freepik 관련 요청 감지
 */
export function detectFreepikRequest(message: string): {
  type: "generate" | "search" | "upscale" | null;
  prompt: string;
  model?: FreepikModel;
  aspectRatio?: FreepikAspectRatio;
} {
  const lower = message.toLowerCase();

  // 업스케일 요청 감지
  if (/업스케일|확대|해상도\s*높|고화질\s*변환|upscale/i.test(message)) {
    return { type: "upscale", prompt: message };
  }

  // AI 이미지 생성 (Freepik 명시적 언급 또는 고품질 이미지 요청)
  if (
    /freepik|프리픽/i.test(message) &&
    /생성|만들|그려|generate/i.test(message)
  ) {
    const prompt = message
      .replace(/freepik|프리픽/gi, "")
      .replace(/이미지|그림|사진/g, "")
      .replace(/생성|만들|그려|줘|해줘/g, "")
      .trim();

    // 모델 감지
    let model: FreepikModel = "mystic";
    if (/빠르게|빨리|quick|fast/i.test(message)) model = "hyperflux";
    if (/저렴|경제|cheap/i.test(message)) model = "classic";

    // 비율 감지
    let aspectRatio: FreepikAspectRatio = "square";
    if (/가로|landscape|와이드|widescreen/i.test(message)) aspectRatio = "landscape";
    if (/세로|portrait|tall/i.test(message)) aspectRatio = "portrait";
    if (/와이드스크린|16.9|영화/i.test(message)) aspectRatio = "widescreen";

    return { type: "generate", prompt: prompt || message, model, aspectRatio };
  }

  // 스톡 이미지 검색
  if (
    /freepik|프리픽/i.test(message) &&
    /검색|찾아|search|소스|리소스|템플릿|벡터|사진/i.test(message)
  ) {
    const prompt = message
      .replace(/freepik|프리픽/gi, "")
      .replace(/검색|찾아|search|소스|리소스|줘|해줘/gi, "")
      .trim();

    return { type: "search", prompt: prompt || message };
  }

  return { type: null, prompt: message };
}

// ==================== 내부 헬퍼 ====================

function enhancePrompt(prompt: string): string {
  // 한국어 프롬프트에 품질 힌트 추가
  if (/[가-힣]/.test(prompt)) {
    return `${prompt}, high quality, professional, detailed`;
  }
  return prompt;
}

function parseGenerateResponse(
  data: Record<string, unknown>,
  model: string,
  prompt: string,
): FreepikGenerateResult {
  const generated = (data.data as Record<string, unknown>)?.generated as
    | Array<Record<string, unknown>>
    | undefined;

  const images = (generated ?? []).map((img) => ({
    url: String(img.url ?? img.source_url ?? ""),
    width: Number(img.width ?? 0),
    height: Number(img.height ?? 0),
  }));

  return {
    taskId: String((data.data as Record<string, unknown>)?.task_id ?? "direct"),
    status: images.length > 0 ? "completed" : "pending",
    images,
    model,
    prompt,
  };
}

async function pollTaskStatus(
  url: string,
  model: string,
  prompt: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000,
): Promise<FreepikGenerateResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-freepik-api-key": getApiKey(),
        Accept: "application/json",
      },
    });

    if (!response.ok) continue;

    const data = await response.json();
    const status = (data.data as Record<string, unknown>)?.status;

    if (status === "COMPLETED" || status === "completed") {
      return parseGenerateResponse(data, model, prompt);
    }

    if (status === "FAILED" || status === "failed") {
      throw new Error("Freepik 이미지 생성 실패");
    }
  }

  throw new Error("Freepik 이미지 생성 시간 초과 (60초)");
}

async function pollUpscaleStatus(
  url: string,
  scaleFactor: number,
  maxAttempts: number = 30,
  intervalMs: number = 2000,
): Promise<FreepikUpscaleResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-freepik-api-key": getApiKey(),
        Accept: "application/json",
      },
    });

    if (!response.ok) continue;

    const data = await response.json();
    const status = (data.data as Record<string, unknown>)?.status;

    if (status === "COMPLETED" || status === "completed") {
      const generated = (data.data as Record<string, unknown>)?.generated as
        | Array<Record<string, unknown>>
        | undefined;
      return {
        taskId: String((data.data as Record<string, unknown>)?.task_id ?? ""),
        status: "completed",
        imageUrl: String(generated?.[0]?.url ?? ""),
        scaleFactor,
      };
    }

    if (status === "FAILED" || status === "failed") {
      throw new Error("Freepik 업스케일 실패");
    }
  }

  throw new Error("Freepik 업스케일 시간 초과 (60초)");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
