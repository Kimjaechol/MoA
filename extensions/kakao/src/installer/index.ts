/**
 * MoA 원클릭 설치 시스템
 *
 * 모듈 익스포트
 */

// 설치 설정
export {
  DEFAULT_INSTALLER_CONFIG,
  detectPlatform,
  getInstallerForPlatform,
  PLATFORM_INSTALLERS,
  type InstallerConfig,
  type PlatformInstaller,
} from "./install-config.js";

// 디바이스 연결
export {
  detectDeviceInfo,
  DeviceConnector,
  generateDefaultDeviceName,
  generateDeviceId,
  type ConnectionState,
  type DeviceInfo,
} from "./device-connector.js";

// 구독 서비스
export {
  cancelSubscription,
  checkSubscriptionLimits,
  createOrUpdateSubscription,
  formatPlanComparison,
  formatPlanComparisonEn,
  formatSubscriptionStatus,
  generatePaymentUrl,
  getPaymentHistory,
  getUserSubscription,
  isBetaPeriod,
  recordPayment,
  SUBSCRIPTION_PLANS,
  updateSubscriptionStatus,
  type PaymentRecord,
  type PlanType,
  type SubscriptionPlan,
  type UserSubscription,
} from "./subscription.js";

// 크레딧 시스템
export {
  addCredits,
  CREDIT_PACKAGES,
  deductCredits,
  formatCreditPackages,
  formatCreditPackagesEn,
  getUserCredits,
  LLM_CREDIT_COSTS,
  type CreditPackage,
  type UserCredits,
} from "./subscription.js";

// 웹 설치 페이지
export { generateInstallPage, handleInstallRequest } from "./install-page.js";

// 설치 스크립트 (동적 생성)
export { getInstallScript } from "./install-scripts.js";

// 모바일 앱 설정
export {
  ANDROID_CONFIG,
  detectMobilePlatform,
  generateAndroidIntent,
  generateAppleAppSiteAssociation,
  generateAssetLinks,
  generateDeepLink,
  generateFlutterConfig,
  generateIOSSmartBanner,
  generateIOSUniversalLink,
  generateMobileInstallPage,
  generateQRCodeData,
  generateReactNativeConfig,
  generateUniversalLink,
  getMobileAppConfig,
  IOS_CONFIG,
  UNIVERSAL_LINK_DOMAIN,
  type DeepLinkParams,
  type MobileAppConfig,
  type QRCodeData,
} from "./mobile-config.js";
