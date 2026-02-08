/**
 * Mobile App Configuration
 *
 * Configuration and deep link handling for Android and iOS apps.
 * Provides app store links, deep link schemes, and QR code generation.
 */

// ============================================
// Types
// ============================================

export interface MobileAppConfig {
  platform: "android" | "ios";
  appName: string;
  packageId: string;
  appStoreUrl: string;
  deepLinkScheme: string;
  minVersion: string;
}

export interface DeepLinkParams {
  action: "pair" | "open" | "settings";
  pairingCode?: string;
  userId?: string;
}

export interface QRCodeData {
  url: string;
  deepLink: string;
  fallbackUrl: string;
}

// ============================================
// Configuration
// ============================================

export const ANDROID_CONFIG: MobileAppConfig = {
  platform: "android",
  appName: "MoA - Master of AI",
  packageId: "com.moa.client",
  appStoreUrl: "https://play.google.com/store/apps/details?id=com.moa.client",
  deepLinkScheme: "moa://",
  minVersion: "1.0.0",
};

export const IOS_CONFIG: MobileAppConfig = {
  platform: "ios",
  appName: "MoA - Master of AI",
  packageId: "com.moa.client",
  appStoreUrl: "https://apps.apple.com/app/moa-master-of-ai/id123456789",
  deepLinkScheme: "moa://",
  minVersion: "1.0.0",
};

// Universal link domain
export const UNIVERSAL_LINK_DOMAIN = "moa.example.com";

// ============================================
// Deep Link Generation
// ============================================

/**
 * Generate a deep link URL for the mobile app
 */
export function generateDeepLink(params: DeepLinkParams): string {
  const scheme = "moa://";
  const queryParams = new URLSearchParams();

  if (params.pairingCode) {
    queryParams.set("code", params.pairingCode);
  }
  if (params.userId) {
    queryParams.set("user", params.userId);
  }

  const query = queryParams.toString();
  return `${scheme}${params.action}${query ? `?${query}` : ""}`;
}

/**
 * Generate a universal link (iOS) / app link (Android)
 */
export function generateUniversalLink(params: DeepLinkParams): string {
  const baseUrl = `https://${UNIVERSAL_LINK_DOMAIN}/app`;
  const queryParams = new URLSearchParams();

  queryParams.set("action", params.action);
  if (params.pairingCode) {
    queryParams.set("code", params.pairingCode);
  }
  if (params.userId) {
    queryParams.set("user", params.userId);
  }

  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Generate QR code data for mobile app installation/pairing
 */
export function generateQRCodeData(pairingCode: string, userId: string): QRCodeData {
  const deepLink = generateDeepLink({
    action: "pair",
    pairingCode,
    userId,
  });

  const universalLink = generateUniversalLink({
    action: "pair",
    pairingCode,
    userId,
  });

  // Fallback URL for when app is not installed
  const fallbackUrl = `https://${UNIVERSAL_LINK_DOMAIN}/install?code=${pairingCode}&user=${userId}`;

  return {
    url: universalLink,
    deepLink,
    fallbackUrl,
  };
}

// ============================================
// App Store Smart Banner
// ============================================

/**
 * Generate meta tags for iOS Smart App Banner
 */
export function generateIOSSmartBanner(pairingCode?: string): string {
  const appId = "123456789"; // Apple App Store ID
  const appArgument = pairingCode ? `moa://pair?code=${pairingCode}` : "moa://open";

  return `<meta name="apple-itunes-app" content="app-id=${appId}, app-argument=${appArgument}">`;
}

/**
 * Generate link tag for Android App Links
 */
export function generateAndroidAppLink(): string {
  return `<link rel="alternate" href="android-app://${ANDROID_CONFIG.packageId}/https/${UNIVERSAL_LINK_DOMAIN}/app">`;
}

// ============================================
// Platform Detection
// ============================================

/**
 * Detect mobile platform from user agent
 */
export function detectMobilePlatform(userAgent: string): "android" | "ios" | null {
  const ua = userAgent.toLowerCase();

  if (/android/.test(ua)) {
    return "android";
  }
  if (/iphone|ipad|ipod/.test(ua)) {
    return "ios";
  }

  return null;
}

/**
 * Get app config for detected platform
 */
export function getMobileAppConfig(userAgent: string): MobileAppConfig | null {
  const platform = detectMobilePlatform(userAgent);

  if (platform === "android") {
    return ANDROID_CONFIG;
  }
  if (platform === "ios") {
    return IOS_CONFIG;
  }

  return null;
}

// ============================================
// Intent URL Generation
// ============================================

/**
 * Generate Android intent URL with fallback
 */
export function generateAndroidIntent(params: DeepLinkParams): string {
  const _deepLink = generateDeepLink(params);
  const fallbackUrl = encodeURIComponent(ANDROID_CONFIG.appStoreUrl);

  // Android intent format
  return `intent://${params.action}?${new URLSearchParams({
    code: params.pairingCode ?? "",
    user: params.userId ?? "",
  }).toString()}#Intent;scheme=moa;package=${ANDROID_CONFIG.packageId};S.browser_fallback_url=${fallbackUrl};end`;
}

/**
 * Generate iOS universal link with app store fallback
 */
export function generateIOSUniversalLink(params: DeepLinkParams): string {
  return generateUniversalLink(params);
}

// ============================================
// Mobile Install Page Generation
// ============================================

/**
 * Generate mobile-specific install page HTML
 */
export function generateMobileInstallPage(params: {
  pairingCode: string;
  userId: string;
  platform: "android" | "ios";
}): string {
  const config = params.platform === "android" ? ANDROID_CONFIG : IOS_CONFIG;
  const deepLink = generateDeepLink({
    action: "pair",
    pairingCode: params.pairingCode,
    userId: params.userId,
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>MoA 설치 - ${config.platform === "android" ? "Android" : "iOS"}</title>
  ${params.platform === "ios" ? generateIOSSmartBanner(params.pairingCode) : ""}
  ${params.platform === "android" ? generateAndroidAppLink() : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 32px;
      text-align: center;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      font-size: 64px;
      margin-bottom: 16px;
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 24px;
    }
    .pairing-code {
      background: #f5f5f5;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .pairing-code label {
      display: block;
      font-size: 12px;
      color: #999;
      margin-bottom: 4px;
    }
    .pairing-code .code {
      font-family: monospace;
      font-size: 28px;
      font-weight: bold;
      color: #667eea;
      letter-spacing: 4px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      margin-bottom: 12px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    .btn-secondary {
      background: #f5f5f5;
      color: #333;
    }
    .steps {
      text-align: left;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #eee;
    }
    .steps h3 {
      font-size: 14px;
      color: #333;
      margin-bottom: 12px;
    }
    .steps ol {
      padding-left: 20px;
      color: #666;
      font-size: 14px;
      line-height: 1.8;
    }
    .platform-icon {
      font-size: 20px;
      vertical-align: middle;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🤖</div>
    <h1>MoA 설치</h1>
    <p class="subtitle">Master of AI를 ${params.platform === "android" ? "Android" : "iPhone"}에 설치하세요</p>

    <div class="pairing-code">
      <label>페어링 코드</label>
      <div class="code">${params.pairingCode}</div>
    </div>

    <a href="${deepLink}" class="btn btn-primary" id="openApp">
      <span class="platform-icon">${params.platform === "android" ? "🤖" : "📱"}</span>
      앱 열기
    </a>

    <a href="${config.appStoreUrl}" class="btn btn-secondary">
      ${params.platform === "android" ? "Play 스토어" : "App Store"}에서 다운로드
    </a>

    <div class="steps">
      <h3>설치 방법:</h3>
      <ol>
        <li>위 버튼으로 앱을 설치하세요</li>
        <li>앱을 열고 페어링 코드를 입력하세요</li>
        <li>카카오톡에서 /연결상태 로 확인하세요</li>
      </ol>
    </div>
  </div>

  <script>
    // Try to open app, fallback to store
    document.getElementById('openApp').addEventListener('click', function(e) {
      const deepLink = '${deepLink}';
      const storeUrl = '${config.appStoreUrl}';

      // Try deep link first
      window.location.href = deepLink;

      // Fallback to store after delay
      setTimeout(function() {
        window.location.href = storeUrl;
      }, 1500);

      e.preventDefault();
    });

    // Auto-redirect if app is installed
    setTimeout(function() {
      window.location.href = '${deepLink}';
    }, 500);
  </script>
</body>
</html>`;
}

// ============================================
// assetlinks.json / apple-app-site-association
// ============================================

/**
 * Generate Android assetlinks.json content
 */
export function generateAssetLinks(sha256Fingerprint: string): object {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_CONFIG.packageId,
        sha256_cert_fingerprints: [sha256Fingerprint],
      },
    },
  ];
}

/**
 * Generate iOS apple-app-site-association content
 */
export function generateAppleAppSiteAssociation(teamId: string, bundleId: string): object {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ["/app/*", "/install/*", "/pair/*"],
        },
      ],
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`],
    },
  };
}

// ============================================
// React Native / Flutter Config Templates
// ============================================

/**
 * Generate React Native deep link config
 */
export function generateReactNativeConfig(): string {
  return `// app.json (Expo) or Info.plist + AndroidManifest.xml config
{
  "expo": {
    "name": "${ANDROID_CONFIG.appName}",
    "slug": "moa-client",
    "scheme": "moa",
    "ios": {
      "bundleIdentifier": "${IOS_CONFIG.packageId}",
      "associatedDomains": [
        "applinks:${UNIVERSAL_LINK_DOMAIN}",
        "webcredentials:${UNIVERSAL_LINK_DOMAIN}"
      ]
    },
    "android": {
      "package": "${ANDROID_CONFIG.packageId}",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "${UNIVERSAL_LINK_DOMAIN}",
              "pathPrefix": "/app"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}`;
}

/**
 * Generate Flutter deep link config
 */
export function generateFlutterConfig(): string {
  return `# pubspec.yaml
name: moa_client
description: MoA - Master of AI

# android/app/src/main/AndroidManifest.xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="${UNIVERSAL_LINK_DOMAIN}" android:pathPrefix="/app" />
</intent-filter>
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="moa" />
</intent-filter>

# ios/Runner/Info.plist
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>moa</string>
        </array>
    </dict>
</array>
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:${UNIVERSAL_LINK_DOMAIN}</string>
</array>`;
}
