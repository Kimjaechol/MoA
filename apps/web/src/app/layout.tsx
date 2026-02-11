import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoA - Master of AI | 모든 기기를 하나의 AI로",
  description:
    "MoA는 노트북, 태블릿, 데스크탑을 하나의 AI로 연결하는 차세대 AI 에이전트입니다. 카카오톡에서 원격 제어, AI 대화, 파일 관리를 한번에.",
  keywords: ["MoA", "AI", "에이전트", "원격제어", "카카오톡", "AI 어시스턴트"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MoA",
  },
  openGraph: {
    title: "MoA - Master of AI",
    description: "모든 기기를 하나의 AI로 연결하세요",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#667eea",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        {children}
        {/* Service Worker registration for PWA install */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
