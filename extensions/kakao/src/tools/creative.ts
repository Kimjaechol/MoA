/**
 * 창작 AI Tool - 이미지/음악/스티커 생성
 *
 * - 이미지 생성 (DALL-E, Stable Diffusion)
 * - 음악 생성 (Suno AI)
 * - 이모티콘/스티커 생성
 * - QR 코드 생성
 * - 밈(Meme) 생성
 */

export interface CreativeResult {
  type: 'image' | 'music' | 'sticker' | 'qrcode' | 'meme';
  url: string;
  prompt: string;
  provider: string;
  metadata?: Record<string, unknown>;
}

// ==================== 이미지 생성 ====================

/**
 * DALL-E 3를 통한 이미지 생성
 */
export async function generateImageWithDALLE(
  prompt: string,
  options?: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';
    style?: 'vivid' | 'natural';
    quality?: 'standard' | 'hd';
  },
): Promise<CreativeResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API 키가 설정되지 않았습니다 (OPENAI_API_KEY)');
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: enhancePromptForKorean(prompt),
      n: 1,
      size: options?.size || '1024x1024',
      style: options?.style || 'vivid',
      quality: options?.quality || 'standard',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DALL-E API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const imageUrl = data.data[0]?.url;

  if (!imageUrl) {
    throw new Error('이미지 생성에 실패했습니다');
  }

  return {
    type: 'image',
    url: imageUrl,
    prompt,
    provider: 'dall-e-3',
    metadata: {
      revisedPrompt: data.data[0]?.revised_prompt,
    },
  };
}

/**
 * Stable Diffusion API를 통한 이미지 생성
 */
export async function generateImageWithStableDiffusion(
  prompt: string,
  options?: {
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
  },
): Promise<CreativeResult> {
  const apiKey = process.env.STABILITY_API_KEY;

  if (!apiKey) {
    throw new Error('Stability API 키가 설정되지 않았습니다 (STABILITY_API_KEY)');
  }

  const response = await fetch(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text_prompts: [
          { text: enhancePromptForKorean(prompt), weight: 1 },
          ...(options?.negativePrompt
            ? [{ text: options.negativePrompt, weight: -1 }]
            : []),
        ],
        cfg_scale: 7,
        width: options?.width || 1024,
        height: options?.height || 1024,
        steps: options?.steps || 30,
        samples: 1,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Stability API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const imageBase64 = data.artifacts?.[0]?.base64;

  if (!imageBase64) {
    throw new Error('이미지 생성에 실패했습니다');
  }

  // Base64를 URL로 변환 (데이터 URI)
  const imageUrl = `data:image/png;base64,${imageBase64}`;

  return {
    type: 'image',
    url: imageUrl,
    prompt,
    provider: 'stable-diffusion-xl',
  };
}

/**
 * 통합 이미지 생성 함수
 */
export async function generateImage(
  prompt: string,
  options?: {
    provider?: 'dalle' | 'stable-diffusion' | 'auto';
    style?: 'emoticon' | 'illustration' | 'photo' | 'art' | 'anime';
    size?: 'square' | 'portrait' | 'landscape';
  },
): Promise<CreativeResult> {
  const provider = options?.provider || 'auto';
  const style = options?.style || 'illustration';

  // 스타일에 맞게 프롬프트 강화
  const enhancedPrompt = enhancePromptWithStyle(prompt, style);

  // 사이즈 매핑
  const sizeMap: Record<string, '1024x1024' | '1024x1792' | '1792x1024'> = {
    square: '1024x1024',
    portrait: '1024x1792',
    landscape: '1792x1024',
  };
  const size = sizeMap[options?.size || 'square'];

  // provider 선택
  if (provider === 'dalle' || (provider === 'auto' && process.env.OPENAI_API_KEY)) {
    return generateImageWithDALLE(enhancedPrompt, { size });
  }

  if (
    provider === 'stable-diffusion' ||
    (provider === 'auto' && process.env.STABILITY_API_KEY)
  ) {
    return generateImageWithStableDiffusion(enhancedPrompt);
  }

  throw new Error('사용 가능한 이미지 생성 API가 없습니다');
}

// ==================== 이모티콘/스티커 생성 ====================

/**
 * 이모티콘 스타일 이미지 생성
 */
export async function generateEmoticon(
  description: string,
  emotion: string = 'happy',
): Promise<CreativeResult> {
  const emoticonPrompts: Record<string, string> = {
    happy: 'cute, joyful, smiling, cheerful expression',
    sad: 'cute, sad, tearful, melancholic expression',
    angry: 'cute, angry, frustrated, annoyed expression',
    love: 'cute, loving, heart eyes, romantic expression',
    surprised: 'cute, surprised, shocked, wide eyes expression',
    sleepy: 'cute, sleepy, tired, drowsy expression',
    excited: 'cute, excited, enthusiastic, energetic expression',
    confused: 'cute, confused, puzzled, questioning expression',
  };

  const emotionPrompt = emoticonPrompts[emotion] || emoticonPrompts.happy;

  const prompt = `Cute kawaii sticker style illustration of ${description}, ${emotionPrompt},
simple clean design, white background, bold outlines, flat colors,
suitable for messaging app sticker, chibi style, adorable`;

  return generateImage(prompt, {
    style: 'emoticon',
    size: 'square',
  });
}

/**
 * 하트 이미지 생성 (연인에게 보낼 용도)
 */
export async function generateHeartImage(
  style: 'cute' | 'romantic' | 'playful' | 'elegant' = 'cute',
  customMessage?: string,
): Promise<CreativeResult> {
  const stylePrompts: Record<string, string> = {
    cute: 'cute kawaii pink hearts, pastel colors, sparkles, adorable style',
    romantic: 'elegant red roses with hearts, romantic atmosphere, soft lighting',
    playful: 'colorful hearts, confetti, fun and playful, cartoon style',
    elegant: 'gold and rose gold hearts, luxurious, sophisticated, minimal',
  };

  let prompt = stylePrompts[style];

  if (customMessage) {
    prompt += `, with text "${customMessage}" beautifully integrated`;
  }

  return generateImage(prompt, {
    style: 'illustration',
    size: 'square',
  });
}

// ==================== 음악 생성 ====================

interface SunoResponse {
  id: string;
  audio_url: string;
  title: string;
  duration: number;
}

/**
 * Suno AI를 통한 음악 생성
 */
export async function generateMusicWithSuno(
  prompt: string,
  options?: {
    duration?: number;
    genre?: string;
    instrumental?: boolean;
  },
): Promise<CreativeResult> {
  const apiKey = process.env.SUNO_API_KEY;

  if (!apiKey) {
    throw new Error('Suno API 키가 설정되지 않았습니다 (SUNO_API_KEY)');
  }

  // Suno API 호출 (비공식 API 기준)
  const response = await fetch('https://api.suno.ai/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: enhanceMusicPrompt(prompt, options?.genre),
      duration: options?.duration || 30,
      instrumental: options?.instrumental ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Suno API 오류: ${response.status} - ${error}`);
  }

  const data: SunoResponse = await response.json();

  return {
    type: 'music',
    url: data.audio_url,
    prompt,
    provider: 'suno',
    metadata: {
      title: data.title,
      duration: data.duration,
    },
  };
}

/**
 * Mubert API를 통한 배경음악 생성 (대안)
 */
export async function generateMusicWithMubert(
  prompt: string,
  options?: {
    duration?: number;
    intensity?: 'low' | 'medium' | 'high';
  },
): Promise<CreativeResult> {
  const apiKey = process.env.MUBERT_API_KEY;

  if (!apiKey) {
    throw new Error('Mubert API 키가 설정되지 않았습니다 (MUBERT_API_KEY)');
  }

  const response = await fetch('https://api.mubert.com/v2/GetTrackByPrompt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      duration: options?.duration || 30,
      intensity: options?.intensity || 'medium',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mubert API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    type: 'music',
    url: data.track_url,
    prompt,
    provider: 'mubert',
    metadata: {
      duration: options?.duration || 30,
    },
  };
}

/**
 * 통합 음악 생성 함수
 */
export async function generateMusic(
  prompt: string,
  options?: {
    provider?: 'suno' | 'mubert' | 'auto';
    duration?: number;
    genre?: string;
    instrumental?: boolean;
  },
): Promise<CreativeResult> {
  const provider = options?.provider || 'auto';

  if (provider === 'suno' || (provider === 'auto' && process.env.SUNO_API_KEY)) {
    return generateMusicWithSuno(prompt, options);
  }

  if (provider === 'mubert' || (provider === 'auto' && process.env.MUBERT_API_KEY)) {
    return generateMusicWithMubert(prompt, options);
  }

  throw new Error('사용 가능한 음악 생성 API가 없습니다');
}

// ==================== QR 코드 생성 ====================

/**
 * QR 코드 생성
 */
export async function generateQRCode(
  content: string,
  options?: {
    size?: number;
    color?: string;
    backgroundColor?: string;
    logo?: string;
  },
): Promise<CreativeResult> {
  const size = options?.size || 300;
  const color = (options?.color || '000000').replace('#', '');
  const bgColor = (options?.backgroundColor || 'FFFFFF').replace('#', '');

  // QR Server API (무료)
  const url = new URL('https://api.qrserver.com/v1/create-qr-code/');
  url.searchParams.set('data', content);
  url.searchParams.set('size', `${size}x${size}`);
  url.searchParams.set('color', color);
  url.searchParams.set('bgcolor', bgColor);
  url.searchParams.set('format', 'png');

  return {
    type: 'qrcode',
    url: url.toString(),
    prompt: content,
    provider: 'qr-server',
    metadata: { size, color, backgroundColor: bgColor },
  };
}

// ==================== 밈(Meme) 생성 ====================

/**
 * 밈 이미지 생성
 */
export async function generateMeme(
  topText: string,
  bottomText: string,
  template: string = 'drake',
): Promise<CreativeResult> {
  // Imgflip API 사용
  const apiKey = process.env.IMGFLIP_USERNAME;
  const password = process.env.IMGFLIP_PASSWORD;

  // 템플릿 ID 매핑
  const templates: Record<string, string> = {
    drake: '181913649',
    'distracted-boyfriend': '112126428',
    'two-buttons': '87743020',
    'change-my-mind': '129242436',
    'expanding-brain': '93895088',
    'this-is-fine': '55311130',
    success: '61544',
    facepalm: '124822590',
  };

  const templateId = templates[template] || templates.drake;

  if (!apiKey || !password) {
    // API 키가 없으면 이미지 생성으로 대체
    const prompt = `Meme format image with top text: "${topText}" and bottom text: "${bottomText}",
funny, internet meme style`;
    return generateImage(prompt, { style: 'illustration' });
  }

  const formData = new URLSearchParams();
  formData.append('template_id', templateId);
  formData.append('username', apiKey);
  formData.append('password', password);
  formData.append('text0', topText);
  formData.append('text1', bottomText);

  const response = await fetch('https://api.imgflip.com/caption_image', {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`밈 생성 실패: ${data.error_message}`);
  }

  return {
    type: 'meme',
    url: data.data.url,
    prompt: `${topText} / ${bottomText}`,
    provider: 'imgflip',
    metadata: { template, pageUrl: data.data.page_url },
  };
}

// ==================== 헬퍼 함수 ====================

/**
 * 한국어 프롬프트를 영어로 향상
 */
function enhancePromptForKorean(prompt: string): string {
  // 기본적으로 한국어가 포함되어 있으면 스타일 힌트 추가
  if (/[가-힣]/.test(prompt)) {
    return `${prompt}, high quality, detailed, professional`;
  }
  return prompt;
}

/**
 * 스타일에 맞게 프롬프트 강화
 */
function enhancePromptWithStyle(prompt: string, style: string): string {
  const styleEnhancements: Record<string, string> = {
    emoticon:
      'cute kawaii sticker style, simple clean design, white background, bold outlines, flat colors',
    illustration: 'digital illustration, detailed, vibrant colors, professional quality',
    photo: 'photorealistic, 8k, detailed, professional photography',
    art: 'artistic, creative, expressive, fine art quality',
    anime: 'anime style, Japanese animation, detailed, colorful',
  };

  const enhancement = styleEnhancements[style] || styleEnhancements.illustration;
  return `${prompt}, ${enhancement}`;
}

/**
 * 음악 프롬프트 강화
 */
function enhanceMusicPrompt(prompt: string, genre?: string): string {
  const genreMap: Record<string, string> = {
    pop: 'upbeat pop music, catchy melody',
    jazz: 'smooth jazz, sophisticated, relaxing',
    classical: 'classical music, orchestral, elegant',
    electronic: 'electronic music, synthesizer, modern',
    lofi: 'lo-fi hip hop, chill beats, relaxing',
    acoustic: 'acoustic guitar, warm, intimate',
    ambient: 'ambient music, atmospheric, peaceful',
  };

  const genrePrompt = genre ? genreMap[genre] || genre : '';
  return genrePrompt ? `${prompt}, ${genrePrompt}` : prompt;
}

/**
 * 창작 요청 감지
 */
export function detectCreativeRequest(
  query: string,
): {
  type: 'image' | 'music' | 'emoticon' | 'qrcode' | 'meme' | null;
  prompt: string;
} {
  const lowerQuery = query.toLowerCase();

  // 이미지 생성 감지
  if (
    /그림|이미지|그려|만들어|생성|사진|일러스트|배경/.test(query) &&
    /그려|만들|생성|줘/.test(query)
  ) {
    return { type: 'image', prompt: query };
  }

  // 이모티콘/스티커 감지
  if (/이모티콘|스티커|캐릭터/.test(query)) {
    return { type: 'emoticon', prompt: query };
  }

  // 하트/연인 이미지 감지
  if (/하트|사랑|연인|애인/.test(query) && /이미지|그림|만들/.test(query)) {
    return { type: 'image', prompt: query };
  }

  // 음악 생성 감지
  if (/음악|노래|bgm|배경음|멜로디/.test(lowerQuery) && /만들|생성|작곡/.test(query)) {
    return { type: 'music', prompt: query };
  }

  // QR코드 감지
  if (/qr|큐알/.test(lowerQuery)) {
    return { type: 'qrcode', prompt: query };
  }

  // 밈 감지
  if (/밈|짤|meme/.test(lowerQuery)) {
    return { type: 'meme', prompt: query };
  }

  return { type: null, prompt: query };
}

/**
 * 창작 결과 메시지 포맷팅
 */
export function formatCreativeMessage(result: CreativeResult): string {
  const typeLabels: Record<string, string> = {
    image: '🎨 이미지',
    music: '🎵 음악',
    sticker: '😊 스티커',
    qrcode: '📱 QR코드',
    meme: '😂 밈',
  };

  let message = `${typeLabels[result.type] || '🎨 창작물'}이 생성되었습니다!\n\n`;

  if (result.type === 'music') {
    message += `🎧 **음악 듣기**: ${result.url}\n`;
    if (result.metadata?.duration) {
      message += `⏱️ 재생시간: ${result.metadata.duration}초\n`;
    }
  } else {
    // 이미지 URL (카카오톡에서는 이미지 카드로 표시)
    message += `${result.url}\n`;
  }

  return message;
}
