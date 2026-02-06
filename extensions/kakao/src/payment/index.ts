/**
 * Payment Module
 *
 * 결제 연동 모듈
 * - 토스페이먼츠
 * - 카카오페이
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

// Payment webhook handler
export {
  getPaymentSession,
  handlePaymentRequest,
  savePaymentSession,
  type PaymentCallbackParams,
  type WebhookPayload,
} from "./payment-webhook.js";
