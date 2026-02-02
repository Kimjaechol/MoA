/**
 * Billing Handler (Production - Multi-Provider Support)
 *
 * Handles billing-related commands in KakaoTalk chat.
 * Supports multiple LLM providers with free tier fallback.
 */

import {
  checkBilling,
  deductCredits,
  getCredits,
  getUserStats,
  formatCredits,
  addCredits,
} from "./billing.js";
import {
  isPaymentCommand,
  getPackageSelectionMessage,
  parsePackageSelection,
  createPaymentSession,
  getPaymentHistory,
  CREDIT_PACKAGES,
} from "./payment.js";
import {
  getUserSettings,
  setProviderApiKey,
  setPreferredModel,
  setAutoFallback,
  validateApiKey,
  parseApiKeyFromMessage,
  parseModelChangeCommand,
  getApiKeyGuideMessage,
  getModelSelectionMessage,
  getApiKeyStatusMessage,
  PROVIDERS,
  type LLMProvider,
} from "./user-settings.js";
import { routeChat, formatResponseWithInfo, getLowCreditWarning } from "./model-router.js";

export interface BillingHandlerResult {
  handled: boolean;
  response?: string;
  quickReplies?: string[];
  paymentUrl?: string;
  billingCheck?: {
    allowed: boolean;
    useCustomKey: boolean;
    customApiKey?: string;
    customProvider?: string;
  };
}

/**
 * Handle billing-related commands
 * Returns handled=true if the message was a billing command
 */
export async function handleBillingCommand(
  userId: string,
  message: string,
): Promise<BillingHandlerResult> {
  const normalizedMessage = message.toLowerCase().trim();

  // ============================================
  // Balance & Stats Commands
  // ============================================

  // Check balance command: 잔액, 크레딧, 잔고
  if (normalizedMessage === "잔액" || normalizedMessage === "크레딧" || normalizedMessage === "잔고") {
    const stats = await getUserStats(userId);
    const settings = await getUserSettings(userId);

    const hasAnyKey = Object.values(settings.apiKeys).some(k => !!k);
    const keyStatus = hasAnyKey ? "✅ 등록됨 (무료 이용)" : "❌ 미등록";

    let response = `💰 **크레딧 잔액**: ${formatCredits(stats.credits)}

📊 누적 사용: ${formatCredits(stats.totalSpent)}
🔑 API 키: ${keyStatus}
🤖 현재 모델: ${settings.preferredModel}
🔄 자동 전환: ${settings.autoFallback ? "켜짐" : "꺼짐"}`;

    if (!hasAnyKey) {
      response += '\n\n💡 "API키 등록"이라고 말씀하시면 무료로 이용할 수 있어요!';
    }

    return {
      handled: true,
      response,
      quickReplies: hasAnyKey ? ["모델 선택", "API키 상태", "충전"] : ["API키 등록", "충전", "모델 선택"],
    };
  }

  // Pricing info command: 요금, 요금 안내, 가격
  if (normalizedMessage === "요금" || normalizedMessage === "요금 안내" || normalizedMessage === "가격") {
    return {
      handled: true,
      response: getPricingMessage(),
      quickReplies: ["충전", "API키 등록", "잔액"],
    };
  }

  // Payment history command
  if (normalizedMessage === "결제내역" || normalizedMessage === "결제 내역" || normalizedMessage === "충전내역") {
    const history = await getPaymentHistory(userId, 5);

    if (history.length === 0) {
      return {
        handled: true,
        response: "결제 내역이 없습니다.",
        quickReplies: ["충전", "잔액"],
      };
    }

    const lines = ["📋 **최근 결제 내역**\n"];
    for (const payment of history) {
      const statusEmoji = payment.status === "completed" ? "✅" : payment.status === "refunded" ? "↩️" : "⏳";
      const date = payment.createdAt.toLocaleDateString("ko-KR");
      lines.push(`${statusEmoji} ${date} - ${payment.amount.toLocaleString()}원 (${payment.credits.toLocaleString()} 크레딧)`);
    }

    return {
      handled: true,
      response: lines.join("\n"),
      quickReplies: ["충전", "잔액"],
    };
  }

  // ============================================
  // API Key Commands
  // ============================================

  // API key status command: API키 상태, 내 API 키
  if (normalizedMessage === "api키 상태" || normalizedMessage === "내 api키" || normalizedMessage === "api키상태") {
    const settings = await getUserSettings(userId);
    return {
      handled: true,
      response: getApiKeyStatusMessage(settings),
      quickReplies: ["API키 등록", "모델 선택", "잔액"],
    };
  }

  // API key registration guide: API키 등록, API키, 키 등록
  if (isApiKeyGuideCommand(message)) {
    return {
      handled: true,
      response: getApiKeyGuideMessage(),
      quickReplies: ["Gemini 무료", "Groq 무료", "잔액"],
    };
  }

  // Direct API key input (auto-detect provider)
  const parsedKey = parseApiKeyFromMessage(message);
  if (parsedKey) {
    // Validate the API key
    const validation = await validateApiKey(parsedKey.provider, parsedKey.apiKey);

    if (!validation.valid) {
      return {
        handled: true,
        response: `❌ API 키 등록 실패\n\n${validation.error}\n\n다시 확인 후 입력해주세요.`,
        quickReplies: ["API키 등록", "충전"],
      };
    }

    await setProviderApiKey(userId, parsedKey.provider, parsedKey.apiKey);

    const providerInfo = PROVIDERS[parsedKey.provider];
    const recommendedModel = providerInfo.models.find(m => m.recommended)?.name ?? providerInfo.models[0]?.name;

    return {
      handled: true,
      response: `✅ API 키가 등록되었습니다!

🔑 제공자: ${providerInfo.displayName}
🤖 추천 모델: ${recommendedModel}
💰 이제부터 **무료**로 이용하실 수 있습니다!

${providerInfo.freeTier ? "🆓 이 제공자는 무료 티어를 제공합니다." : ""}

질문을 시작해 주세요!`,
      quickReplies: ["모델 선택", "API키 상태", "잔액"],
    };
  }

  // ============================================
  // Model Selection Commands
  // ============================================

  // Model selection menu: 모델, 모델 선택, 모델 목록
  if (normalizedMessage === "모델" || normalizedMessage === "모델 선택" || normalizedMessage === "모델 목록") {
    const settings = await getUserSettings(userId);
    return {
      handled: true,
      response: getModelSelectionMessage(settings.preferredProvider, settings.preferredModel),
      quickReplies: ["모델 haiku", "모델 gemini", "모델 llama"],
    };
  }

  // Model change command: 모델 변경 xxx, 모델 xxx
  const modelChange = parseModelChangeCommand(message);
  if (modelChange.isCommand) {
    if (!modelChange.provider || !modelChange.model) {
      return {
        handled: true,
        response: `❌ 모델을 찾을 수 없습니다.

사용 가능한 모델:
• haiku, sonnet, opus (Claude)
• gemini, flash, pro (Google)
• gpt-4o, gpt-4o-mini (OpenAI)
• llama, mixtral (Groq 무료)

예: "모델 gemini", "모델 haiku"`,
        quickReplies: ["모델 선택", "모델 gemini", "모델 haiku"],
      };
    }

    await setPreferredModel(userId, modelChange.provider, modelChange.model);

    const providerInfo = PROVIDERS[modelChange.provider];
    const modelInfo = providerInfo.models.find(m => m.id === modelChange.model);
    const isFree = modelInfo?.free ? " 🆓 무료" : "";

    return {
      handled: true,
      response: `✅ 모델이 변경되었습니다!

🤖 ${modelInfo?.name ?? modelChange.model}${isFree}
📦 제공자: ${providerInfo.displayName}

이제 새 모델로 대화하실 수 있습니다.`,
      quickReplies: ["잔액", "모델 선택", "API키 상태"],
    };
  }

  // Auto-fallback toggle: 자동 전환 켜기/끄기
  if (normalizedMessage.includes("자동 전환") || normalizedMessage.includes("자동전환")) {
    const enable = normalizedMessage.includes("켜") || normalizedMessage.includes("on");
    const disable = normalizedMessage.includes("끄") || normalizedMessage.includes("off");

    if (enable || disable) {
      await setAutoFallback(userId, enable);
      return {
        handled: true,
        response: `🔄 자동 전환이 ${enable ? "켜졌" : "꺼졌"}습니다.

${enable
    ? "크레딧이 부족하면 무료 모델(Gemini/Groq)로 자동 전환됩니다."
    : "크레딧 부족 시 자동 전환하지 않습니다."}`,
        quickReplies: ["잔액", "모델 선택"],
      };
    }

    // Just show current status
    const settings = await getUserSettings(userId);
    return {
      handled: true,
      response: `🔄 자동 전환: ${settings.autoFallback ? "켜짐" : "꺼짐"}

"자동 전환 켜기" 또는 "자동 전환 끄기"로 변경할 수 있습니다.`,
      quickReplies: ["자동 전환 켜기", "자동 전환 끄기"],
    };
  }

  // ============================================
  // Credit Charge Commands
  // ============================================

  // Credit charge command: 충전, 크레딧 충전
  if (normalizedMessage === "충전" || normalizedMessage === "크레딧 충전") {
    return {
      handled: true,
      response: getPackageSelectionMessage(),
      quickReplies: CREDIT_PACKAGES.map(p => `${p.name} 충전`),
    };
  }

  // Package selection
  const selectedPackage = parsePackageSelection(message);
  if (selectedPackage && isPaymentCommand(message)) {
    const result = await createPaymentSession(userId, selectedPackage.id);

    if ("error" in result) {
      return {
        handled: true,
        response: `❌ ${result.error}`,
        quickReplies: ["충전", "잔액"],
      };
    }

    const totalCredits = selectedPackage.credits + (selectedPackage.bonus ?? 0);
    return {
      handled: true,
      response: `💳 **결제 안내**

📦 ${selectedPackage.name} 패키지
💰 금액: ${selectedPackage.price.toLocaleString()}원
🎁 크레딧: ${totalCredits.toLocaleString()}

아래 버튼을 클릭하여 결제를 진행해주세요.`,
      paymentUrl: result.paymentUrl,
      quickReplies: ["취소", "다른 패키지"],
    };
  }

  // ============================================
  // Free API Quick Guides
  // ============================================

  // Gemini free guide
  if (normalizedMessage.includes("gemini 무료") || normalizedMessage.includes("제미나이 무료")) {
    return {
      handled: true,
      response: `🆓 **Google Gemini 무료 API 등록**

1️⃣ https://aistudio.google.com 접속
2️⃣ Google 계정으로 로그인
3️⃣ "Get API Key" 클릭
4️⃣ "Create API Key" 클릭
5️⃣ 생성된 키(AIza...)를 여기에 입력

📌 무료 혜택:
• 월 1,500회 무료 요청
• Gemini 2.0 Flash 모델
• 1,000,000 토큰 컨텍스트

키를 발급받으셨다면 여기에 붙여넣기 해주세요!`,
      quickReplies: ["Groq 무료", "API키 등록", "잔액"],
    };
  }

  // Groq free guide
  if (normalizedMessage.includes("groq 무료") || normalizedMessage.includes("그록 무료")) {
    return {
      handled: true,
      response: `🆓 **Groq 무료 API 등록** (초고속!)

1️⃣ https://console.groq.com 접속
2️⃣ 계정 생성 (이메일/Google/GitHub)
3️⃣ "API Keys" 메뉴 클릭
4️⃣ "Create API Key" 클릭
5️⃣ 생성된 키(gsk_...)를 여기에 입력

📌 무료 혜택:
• 완전 무료 (속도 제한만)
• Llama 3.3 70B, Mixtral 등
• 초고속 응답 (Groq 특장점)

키를 발급받으셨다면 여기에 붙여넣기 해주세요!`,
      quickReplies: ["Gemini 무료", "API키 등록", "잔액"],
    };
  }

  // Not a billing command
  return { handled: false };
}

/**
 * Check if message is API key guide command
 */
function isApiKeyGuideCommand(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, "");
  const keywords = ["api키등록", "apikey등록", "api키", "내키", "나의키", "키등록"];
  return keywords.some(kw => normalized === kw || normalized === kw.replace(/키/g, "key"));
}

/**
 * Get updated pricing message with multi-provider info
 */
function getPricingMessage(): string {
  return `💳 **요금 안내**

━━━━━━━━━━━━━━━━━━━━

🆓 **무료로 이용하기** (추천!)

📌 Google Gemini API
   • 월 1,500회 무료
   • "Gemini 무료"라고 입력

📌 Groq API
   • 완전 무료 (속도 제한만)
   • "Groq 무료"라고 입력

━━━━━━━━━━━━━━━━━━━━

💰 **크레딧 요금** (무료 API 미등록 시)

📌 Claude Haiku: 약 1-2원/대화
📌 GPT-4o-mini: 약 2-3원/대화
📌 Claude Sonnet: 약 10-20원/대화

━━━━━━━━━━━━━━━━━━━━

💡 나만의 API 키 등록 시 **무료**!
"API키 등록"이라고 말씀해주세요.`;
}

/**
 * Pre-check billing before making LLM request
 */
export async function preBillingCheck(
  userId: string,
  estimatedTokens: number = 1000,
): Promise<BillingHandlerResult> {
  const settings = await getUserSettings(userId);

  // Check if user has any API key
  const hasAnyKey = Object.values(settings.apiKeys).some(k => !!k);

  if (hasAnyKey) {
    return {
      handled: false,
      billingCheck: {
        allowed: true,
        useCustomKey: true,
        customApiKey: settings.apiKeys[settings.preferredProvider],
        customProvider: settings.preferredProvider,
      },
    };
  }

  // Check platform credits
  const billingResult = await checkBilling(userId, undefined, estimatedTokens);

  if (!billingResult.allowed) {
    // Check if auto-fallback is enabled and we have platform free-tier keys
    if (settings.autoFallback) {
      const hasFreeKey = !!(
        process.env.GOOGLE_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GROQ_API_KEY
      );

      if (hasFreeKey) {
        return {
          handled: false,
          billingCheck: {
            allowed: true,
            useCustomKey: true, // Using platform free tier
          },
        };
      }
    }

    return {
      handled: true,
      response: `${billingResult.error}

🆓 **무료로 계속 사용하려면:**
• "Gemini 무료" - Google Gemini API 등록 (추천!)
• "Groq 무료" - Groq API 등록

💳 또는 "충전"으로 크레딧을 충전하세요.`,
      quickReplies: ["Gemini 무료", "Groq 무료", "충전", "API키 등록"],
    };
  }

  return {
    handled: false,
    billingCheck: {
      allowed: true,
      useCustomKey: billingResult.useCustomKey,
      customApiKey: billingResult.customApiKey,
      customProvider: billingResult.customProvider,
    },
  };
}

/**
 * Post-billing: deduct credits after successful LLM request
 */
export async function postBillingDeduct(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  usedPlatformKey: boolean,
): Promise<{ creditsUsed: number; remainingCredits: number }> {
  return deductCredits(userId, model, inputTokens, outputTokens, usedPlatformKey);
}

/**
 * Add credits after successful payment
 */
export async function completePayment(
  userId: string,
  credits: number,
): Promise<string> {
  const newBalance = await addCredits(userId, credits);
  return `✅ 결제가 완료되었습니다!

🎁 충전된 크레딧: ${formatCredits(credits)}
💰 현재 잔액: ${formatCredits(newBalance)}

이제 대화를 시작하실 수 있습니다.`;
}

/**
 * Get credit status message for appending to responses
 */
export async function getCreditStatusMessage(
  userId: string,
  creditsUsed: number,
  usedPlatformKey: boolean,
  isFreeModel: boolean = false,
): Promise<string> {
  // No charge for custom API key or free models
  if (!usedPlatformKey || isFreeModel) {
    return "";
  }

  const remaining = await getCredits(userId);
  const settings = await getUserSettings(userId);

  if (remaining < 100) {
    const hasAnyKey = Object.values(settings.apiKeys).some(k => !!k);
    if (!hasAnyKey) {
      return `\n\n⚠️ 크레딧 잔액이 부족합니다 (${formatCredits(remaining)})
💡 "Gemini 무료" 또는 "Groq 무료"로 무료 API를 등록하세요!`;
    }
  }

  return `\n\n💳 -${creditsUsed} 크레딧 (잔액: ${formatCredits(remaining)})`;
}

/**
 * Check if user can chat
 */
export async function canUserChat(userId: string): Promise<boolean> {
  const settings = await getUserSettings(userId);

  // Has any custom API key
  if (Object.values(settings.apiKeys).some(k => !!k)) {
    return true;
  }

  // Has credits
  if ((await getCredits(userId)) > 0) {
    return true;
  }

  // Auto-fallback enabled and platform has free keys
  if (settings.autoFallback) {
    const hasFreeKey = !!(
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY
    );
    if (hasFreeKey) {
      return true;
    }
  }

  return false;
}

// Re-export for convenience
export { routeChat, formatResponseWithInfo, getLowCreditWarning };
