/**
 * Payment Module
 *
 * 결제 연동 모듈
 * - 토스페이먼츠 (한국)
 * - 카카오페이 (한국)
 * - Stripe + Link (글로벌)
 * - 웹훅 처리
 */

// Toss Payments
export {
  cancelPayment as cancelTossPayment,
  chargeBilling,
  confirmPayment,
  generatePaymentWidgetData,
  getPayment,
  getTossConfig,
  issueBillingKey,
  verifyWebhookSignature,
  type BillingKeyRequest,
  type BillingKeyResult,
  type BillingPaymentRequest,
  type PaymentConfirmation,
  type PaymentRequest,
  type PaymentResult,
  type PaymentStatus,
  type TossPaymentsConfig,
} from "./toss-payments.js";

// Kakao Pay
export {
  approvePayment,
  cancelPayment as cancelKakaoPayment,
  chargeSubscription,
  getKakaoPayConfig,
  getSubscriptionStatus,
  inactivateSubscription,
  readyPayment,
  readySubscription,
  type KakaoPayApproveRequest,
  type KakaoPayApproveResponse,
  type KakaoPayCancelRequest,
  type KakaoPayCancelResponse,
  type KakaoPayConfig,
  type KakaoPayReadyRequest,
  type KakaoPayReadyResponse,
  type KakaoPaySubscriptionInfo,
  type KakaoPaySubscriptionPaymentRequest,
  type KakaoPaySubscriptionReadyRequest,
} from "./kakao-pay.js";

// Stripe (Global)
export {
  cancelPaymentIntent,
  cancelSubscription as cancelStripeSubscription,
  createCheckoutSession,
  createCustomer,
  createLinkPaymentUrl,
  createPaymentIntent,
  createRefund,
  createSubscription as createStripeSubscription,
  CURRENCY_DECIMALS,
  CURRENCY_MINIMUM,
  fromStripeAmount,
  getCheckoutSession,
  getCustomer,
  getOrCreateCustomer,
  getPaymentIntent,
  getPrice,
  getStripeConfig,
  getSubscription as getStripeSubscription,
  resumeSubscription,
  toStripeAmount,
  verifyWebhookSignature as verifyStripeWebhook,
  type CreateCheckoutSessionRequest,
  type CreatePaymentIntentRequest,
  type StripeCurrency,
  type StripeCheckoutSession,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripePaymentStatus,
  type StripePrice,
  type StripeSubscription,
  type StripeSubscriptionStatus,
  type StripeWebhookEvent,
} from "./stripe-payments.js";

// Payment webhook handler
export {
  getPaymentSession,
  getStripePaymentSession,
  handlePaymentRequest,
  savePaymentSession,
  saveStripePaymentSession,
  type PaymentCallbackParams,
  type WebhookPayload,
} from "./payment-webhook.js";
