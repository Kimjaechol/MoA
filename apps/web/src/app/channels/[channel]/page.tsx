"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import Nav from "../../../components/Nav";

/* ============================================
   Channel detail data
   ============================================ */

interface ChannelDetail {
  name: string;
  emoji: string;
  color: string;
  textColor: string;
  tagline: string;
  description: string;
  connectUrl: string;
  connectLabel: string;
  features: string[];
  setupGuide: Array<{ step: number; title: string; detail: string }>;
  tips: string[];
  supportedActions: string[];
}

const CHANNEL_DETAILS: Record<string, ChannelDetail> = {
  kakaotalk: {
    name: "KakaoTalk",
    emoji: "\uD83D\uDFE1",
    color: "#FFE812",
    textColor: "#3B1E1E",
    tagline: "한국 최대 메신저에서 AI를 만나세요",
    description: "5,000만 한국인이 매일 사용하는 카카오톡에서 MoA AI와 대화하세요. 채널을 추가하는 것만으로 바로 시작할 수 있습니다. 별도 앱 설치 없이 익숙한 환경에서 AI를 활용하세요.",
    connectUrl: "https://pf.kakao.com/moa-ai",
    connectLabel: "\uCE74\uCE74\uC624\uD1A1 \uCC44\uB110 \uCD94\uAC00\uD558\uAE30",
    features: ["\uBA54\uC2DC\uC9C0\uB85C AI \uB300\uD654", "\uD30C\uC77C \uC804\uC1A1/\uC218\uC2E0", "\uC74C\uC131 \uBA54\uC2DC\uC9C0 \uC9C0\uC6D0", "\uC6D0\uACA9 PC \uC81C\uC5B4", "\uADF8\uB8F9\uCC44\uD305 AI \uD638\uCD9C", "\uC2A4\uD0AC \uBA85\uB839\uC5B4 \uC0AC\uC6A9"],
    setupGuide: [
      { step: 1, title: "\uCE74\uCE74\uC624\uD1A1 \uC571 \uC5F4\uAE30", detail: "\uD734\uB300\uD3F0\uC5D0\uC11C \uCE74\uCE74\uC624\uD1A1 \uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "MoA AI \uCC44\uB110 \uAC80\uC0C9", detail: "\uCC44\uB110 \uD0ED\uC5D0\uC11C 'MoA AI'\uB97C \uAC80\uC0C9\uD558\uAC70\uB098 \uC544\uB798 \uBC84\uD2BC\uC744 \uD074\uB9AD\uD558\uC138\uC694." },
      { step: 3, title: "\uCC44\uB110 \uCD94\uAC00", detail: "MoA AI \uCC44\uB110\uC744 \uCD94\uAC00\uD558\uBA74 \uC790\uB3D9\uC73C\uB85C \uCE5C\uAD6C \uBAA9\uB85D\uC5D0 \uB4F1\uB85D\uB429\uB2C8\uB2E4." },
      { step: 4, title: "\uB300\uD654 \uC2DC\uC791!", detail: "\uCE74\uCE74\uC624\uD1A1\uCC98\uB7FC \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uBC14\uB85C \uC751\uB2F5\uD569\uB2C8\uB2E4. '\uC548\uB155'\uC73C\uB85C \uC2DC\uC791\uD574\uBCF4\uC138\uC694!" },
    ],
    tips: ["\uADF8\uB8F9\uCC44\uD305\uC5D0\uC11C\uB294 @MoA\uB85C \uD638\uCD9C\uD558\uC138\uC694", "\uC74C\uC131 \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 \uC74C\uC131 AI\uAC00 \uC751\uB2F5\uD569\uB2C8\uB2E4", "\uD30C\uC77C\uC744 \uBCF4\uB0B4\uBA74 \uC790\uB3D9\uC73C\uB85C \uBD84\uC11D/\uC694\uC57D\uD569\uB2C8\uB2E4"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uC74C\uC131 \uBA54\uC2DC\uC9C0", "\uD30C\uC77C \uC804\uC1A1", "\uC774\uBBF8\uC9C0 \uBD84\uC11D", "\uC6D0\uACA9 \uBA85\uB839"],
  },
  telegram: {
    name: "Telegram",
    emoji: "\u2708\uFE0F",
    color: "#0088cc",
    textColor: "#ffffff",
    tagline: "\uC804 \uC138\uACC4\uC5D0\uC11C \uAC00\uC7A5 \uBE60\uB978 AI \uB300\uD654",
    description: "Telegram\uC758 \uBE60\uB978 \uC18D\uB3C4\uC640 \uBCF4\uC548\uC744 \uADF8\uB300\uB85C \uD65C\uC6A9\uD558\uC5EC MoA AI\uC640 \uB300\uD654\uD558\uC138\uC694. \uBD07 API\uB97C \uD1B5\uD574 \uCD5C\uC801\uD654\uB41C \uC751\uB2F5\uC744 \uC81C\uACF5\uD569\uB2C8\uB2E4.",
    connectUrl: "https://t.me/MoA_AI_Bot",
    connectLabel: "\uD154\uB808\uADF8\uB7A8\uC5D0\uC11C \uB300\uD654 \uC2DC\uC791",
    features: ["\uCD08\uACE0\uC18D \uC751\uB2F5", "\uC778\uB77C\uC778 \uBC84\uD2BC \uBA85\uB839", "Markdown \uD3EC\uB9F7 \uC9C0\uC6D0", "\uD30C\uC77C/\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305 AI", "\uBD07 \uBA85\uB839\uC5B4 (/moa, /help)"],
    setupGuide: [
      { step: 1, title: "Telegram \uC571 \uC5F4\uAE30", detail: "\uBAA8\uBC14\uC77C \uB610\uB294 \uB370\uC2A4\uD06C\uD1B1\uC5D0\uC11C Telegram\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "@MoA_AI_Bot \uAC80\uC0C9", detail: "\uAC80\uC0C9\uCC3D\uC5D0\uC11C @MoA_AI_Bot\uC744 \uAC80\uC0C9\uD558\uC138\uC694." },
      { step: 3, title: "Start \uBC84\uD2BC \uD074\uB9AD", detail: "\uBD07 \uD504\uB85C\uD544\uC5D0\uC11C Start \uBC84\uD2BC\uC744 \uB204\uB974\uBA74 \uBC14\uB85C \uC5F0\uACB0\uB429\uB2C8\uB2E4." },
      { step: 4, title: "\uBA54\uC2DC\uC9C0 \uBCF4\uB0B4\uAE30", detail: "\uC77C\uBC18 \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uC989\uC2DC \uC751\uB2F5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["/help \uBA85\uB839\uC5B4\uB85C \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uAE30\uB2A5 \uD655\uC778", "\uADF8\uB8F9\uC5D0 \uBD07\uC744 \uCD08\uB300\uD558\uBA74 \uD300 \uC804\uCCB4\uAC00 \uC0AC\uC6A9 \uAC00\uB2A5", "Secret Chat\uC5D0\uC11C\uB3C4 \uC0AC\uC6A9 \uAC00\uB2A5"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uC74C\uC131 \uBA54\uC2DC\uC9C0", "\uD30C\uC77C \uC804\uC1A1", "\uC774\uBBF8\uC9C0 \uBD84\uC11D", "\uC778\uB77C\uC778 \uBC84\uD2BC", "\uBD07 \uBA85\uB839\uC5B4", "\uADF8\uB8F9 \uCC44\uD305"],
  },
  discord: {
    name: "Discord",
    emoji: "\uD83C\uDFAE",
    color: "#5865F2",
    textColor: "#ffffff",
    tagline: "\uCEE4\uBBA4\uB2C8\uD2F0\uC5D0 AI\uB97C \uCD08\uB300\uD558\uC138\uC694",
    description: "Discord \uC11C\uBC84\uC5D0 MoA \uBD07\uC744 \uCD08\uB300\uD558\uBA74 \uBAA8\uB4E0 \uBA64\uBC84\uAC00 AI\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. DM\uC73C\uB85C \uAC1C\uC778 \uB300\uD654\uB3C4 \uAC00\uB2A5\uD569\uB2C8\uB2E4.",
    connectUrl: "https://discord.com/oauth2/authorize?client_id=MOA_BOT_ID&permissions=274878023680&scope=bot",
    connectLabel: "Discord \uBD07 \uCD08\uB300\uD558\uAE30",
    features: ["\uC11C\uBC84 \uBD07 + DM", "\uC2A4\uB808\uB4DC \uC9C0\uC6D0", "\uC784\uBCA0\uB4DC \uC751\uB2F5", "Slash \uBA85\uB839\uC5B4", "\uBC18\uC751 \uD53C\uB4DC\uBC31", "\uD30C\uC77C \uCCA8\uBD80 \uBD84\uC11D"],
    setupGuide: [
      { step: 1, title: "Discord \uC5F4\uAE30", detail: "\uB370\uC2A4\uD06C\uD1B1 \uB610\uB294 \uBAA8\uBC14\uC77C\uC5D0\uC11C Discord\uB97C \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "\uBD07 \uCD08\uB300 \uB9C1\uD06C \uD074\uB9AD", detail: "\uC544\uB798 \uBC84\uD2BC\uC744 \uD074\uB9AD\uD558\uC5EC MoA \uBD07\uC744 \uC11C\uBC84\uC5D0 \uCD08\uB300\uD558\uC138\uC694." },
      { step: 3, title: "\uC11C\uBC84 \uC120\uD0DD & \uAD8C\uD55C \uC2B9\uC778", detail: "MoA \uBD07\uC744 \uCD08\uB300\uD560 \uC11C\uBC84\uB97C \uC120\uD0DD\uD558\uACE0 \uAD8C\uD55C\uC744 \uC2B9\uC778\uD558\uC138\uC694." },
      { step: 4, title: "\uCC44\uB110\uC5D0\uC11C @MoA \uD638\uCD9C", detail: "@MoA \uBA58\uC158\uC73C\uB85C AI\uB97C \uD638\uCD9C\uD558\uAC70\uB098 /moa \uBA85\uB839\uC5B4\uB97C \uC0AC\uC6A9\uD558\uC138\uC694." },
    ],
    tips: ["/moa help\uB85C \uBAA8\uB4E0 \uBA85\uB839\uC5B4 \uD655\uC778", "DM\uC73C\uB85C \uBCF4\uB0B4\uBA74 \uBE44\uACF5\uAC1C \uB300\uD654 \uAC00\uB2A5", "\uC2A4\uB808\uB4DC\uC5D0\uC11C \uD638\uCD9C\uD558\uBA74 \uC8FC\uC81C\uBCC4 \uB300\uD654 \uAC00\uB2A5"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uD30C\uC77C \uCCA8\uBD80", "\uC2A4\uB808\uB4DC", "Slash \uBA85\uB839\uC5B4", "\uBC18\uC751", "\uC784\uBCA0\uB4DC"],
  },
  whatsapp: {
    name: "WhatsApp",
    emoji: "\uD83D\uDCDE",
    color: "#25D366",
    textColor: "#ffffff",
    tagline: "20\uC5B5 \uC0AC\uC6A9\uC790\uC758 \uBA54\uC2E0\uC800\uC5D0\uC11C AI\uB97C",
    description: "\uC804 \uC138\uACC4\uC5D0\uC11C \uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uB418\uB294 \uBA54\uC2E0\uC800 WhatsApp\uC5D0\uC11C MoA\uC640 \uB300\uD654\uD558\uC138\uC694.",
    connectUrl: "https://wa.me/MoA_NUMBER?text=\uC548\uB155\uD558\uC138\uC694",
    connectLabel: "WhatsApp\uC5D0\uC11C \uB300\uD654 \uC2DC\uC791",
    features: ["\uD14D\uC2A4\uD2B8/\uC74C\uC131 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305 AI", "Web \uC790\uB3D9\uD654", "\uC77D\uC74C \uD655\uC778", "\uBE44\uB3D9\uAE30 \uC74C\uC131"],
    setupGuide: [
      { step: 1, title: "WhatsApp \uC5F4\uAE30", detail: "WhatsApp \uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "MoA \uBC88\uD638\uB85C \uBA54\uC2DC\uC9C0", detail: "\uC544\uB798 \uBC84\uD2BC\uC744 \uD074\uB9AD\uD558\uC5EC MoA \uBC88\uD638\uB85C \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uC138\uC694." },
      { step: 3, title: "\uC790\uB3D9 \uC5F0\uACB0 \uC644\uB8CC", detail: "\uCCAB \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 \uC790\uB3D9\uC73C\uB85C MoA\uC640 \uC5F0\uACB0\uB429\uB2C8\uB2E4." },
    ],
    tips: ["\uC74C\uC131 \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 \uC74C\uC131 AI\uAC00 \uC751\uB2F5", "\uC774\uBBF8\uC9C0\uB97C \uBCF4\uB0B4\uBA74 \uC790\uB3D9 \uBD84\uC11D", "\uADF8\uB8F9\uC5D0\uC11C\uB294 @MoA\uB85C \uD638\uCD9C"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uC74C\uC131 \uBA54\uC2DC\uC9C0", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305"],
  },
  slack: {
    name: "Slack",
    emoji: "\uD83D\uDCAC",
    color: "#4A154B",
    textColor: "#ffffff",
    tagline: "\uC5C5\uBB34 \uD658\uACBD\uC5D0 AI\uB97C \uD1B5\uD569\uD558\uC138\uC694",
    description: "Slack \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0 MoA\uB97C \uC124\uCE58\uD558\uBA74 \uD300 \uC804\uCCB4\uAC00 AI\uB97C \uD65C\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    connectUrl: "https://slack.com/oauth/v2/authorize?client_id=MOA_SLACK_ID&scope=chat:write,commands",
    connectLabel: "Slack\uC5D0 MoA \uCD94\uAC00",
    features: ["Slash \uBA85\uB839\uC5B4", "\uC2A4\uB808\uB4DC \uC9C0\uC6D0", "\uCC44\uB110 \uD1B5\uD569", "DM AI \uB300\uD654", "\uD30C\uC77C \uBD84\uC11D", "Socket Mode"],
    setupGuide: [
      { step: 1, title: "Slack \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4 \uC5F4\uAE30", detail: "Slack \uC571 \uB610\uB294 \uC6F9\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "MoA \uC571 \uC124\uCE58", detail: "\uC544\uB798 \uBC84\uD2BC\uC73C\uB85C MoA \uC571\uC744 \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0 \uC124\uCE58\uD558\uC138\uC694." },
      { step: 3, title: "/moa \uBA85\uB839\uC5B4 \uC0AC\uC6A9", detail: "\uCC44\uB110\uC5D0\uC11C /moa \uBA85\uB839\uC5B4\uB97C \uC785\uB825\uD558\uBA74 \uBC14\uB85C \uC0AC\uC6A9 \uAC00\uB2A5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["/moa help\uB85C \uBAA8\uB4E0 \uBA85\uB839\uC5B4 \uD655\uC778", "DM\uC73C\uB85C \uBCF4\uB0B4\uBA74 \uBE44\uACF5\uAC1C AI \uB300\uD654", "\uC2A4\uB808\uB4DC\uC5D0\uC11C AI\uB97C \uD638\uCD9C\uD558\uBA74 \uB9E5\uB77D \uC720\uC9C0"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "Slash \uBA85\uB839\uC5B4", "\uC2A4\uB808\uB4DC", "\uD30C\uC77C \uBD84\uC11D", "DM"],
  },
  signal: {
    name: "Signal",
    emoji: "\uD83D\uDD12",
    color: "#3A76F0",
    textColor: "#ffffff",
    tagline: "\uCD5C\uACE0 \uBCF4\uC548 \uBA54\uC2E0\uC800\uC5D0\uC11C AI\uB97C",
    description: "Signal\uC758 \uC5C5\uACC4 \uCD5C\uACE0 E2E \uC554\uD638\uD654\uC640 \uD568\uAED8 MoA AI\uB97C \uC0AC\uC6A9\uD558\uC138\uC694.",
    connectUrl: "https://signal.me/#eu/MoA_AI",
    connectLabel: "Signal\uC5D0\uC11C \uB300\uD654 \uC2DC\uC791",
    features: ["E2E \uC554\uD638\uD654", "\uD14D\uC2A4\uD2B8/\uC74C\uC131 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305", "\uBC18\uC751 \uC9C0\uC6D0", "\uBCF4\uC548 \uBA54\uC2DC\uC9C0"],
    setupGuide: [
      { step: 1, title: "Signal \uC571 \uC5F4\uAE30", detail: "Signal \uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "MoA AI \uC5F0\uB77D\uCC98 \uCD94\uAC00", detail: "\uC544\uB798 \uBC84\uD2BC\uC73C\uB85C MoA \uC5F0\uB77D\uCC98\uB97C \uCD94\uAC00\uD558\uC138\uC694." },
      { step: 3, title: "\uBA54\uC2DC\uC9C0 \uC804\uC1A1", detail: "Signal \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uC751\uB2F5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["\uBAA8\uB4E0 \uB300\uD654\uB294 Signal\uC758 E2E \uC554\uD638\uD654\uB85C \uBCF4\uD638", "\uC74C\uC131 \uBA54\uC2DC\uC9C0\uB85C\uB3C4 AI \uD638\uCD9C \uAC00\uB2A5"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uC74C\uC131 \uBA54\uC2DC\uC9C0", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uBC18\uC751"],
  },
  imessage: {
    name: "iMessage",
    emoji: "\uD83D\uDCF1",
    color: "#34C759",
    textColor: "#ffffff",
    tagline: "Apple \uC0DD\uD0DC\uACC4\uC758 AI \uD30C\uD2B8\uB108",
    description: "macOS\uC640 iOS\uC758 \uAE30\uBCF8 \uBA54\uC2DC\uC9C0 \uC571\uC5D0\uC11C MoA AI\uC640 \uB300\uD654\uD558\uC138\uC694. \uBCC4\uB3C4 \uC571 \uC124\uCE58 \uC5C6\uC774 iMessage\uB85C \uBC14\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    connectUrl: "imessage://moa@lawith.kr",
    connectLabel: "iMessage\uB85C \uB300\uD654 \uC2DC\uC791",
    features: ["Apple \uAE30\uAE30 \uC6D0\uB124\uC774\uD2F0\uBE0C", "iCloud \uB3D9\uAE30", "\uD14D\uC2A4\uD2B8/\uBBF8\uB514\uC5B4", "\uADF8\uB8F9 \uCC44\uD305 \uC9C0\uC6D0", "Siri \uC5F0\uB3D9 \uAC00\uB2A5", "\uBA40\uC158 \uC9C0\uC6D0"],
    setupGuide: [
      { step: 1, title: "\uBA54\uC2DC\uC9C0 \uC571 \uC5F4\uAE30", detail: "Mac \uB610\uB294 iPhone\uC758 \uBA54\uC2DC\uC9C0 \uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "\uC218\uC2E0\uC790\uC5D0 moa@lawith.kr \uC785\uB825", detail: "\uC0C8 \uBA54\uC2DC\uC9C0\uB97C \uC791\uC131\uD558\uACE0 \uC218\uC2E0\uC790\uC5D0 \uC785\uB825\uD558\uC138\uC694." },
      { step: 3, title: "\uBA54\uC2DC\uC9C0 \uC804\uC1A1", detail: "\uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 MoA AI\uAC00 \uC751\uB2F5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["Mac\uACFC iPhone \uBAA8\uB450 iCloud\uB85C \uB3D9\uAE30", "\uADF8\uB8F9\uCC44\uD305\uC5D0\uC11C\uB294 @MoA\uB85C \uD638\uCD9C", "\uC774\uBBF8\uC9C0\uB97C \uBCF4\uB0B4\uBA74 \uC790\uB3D9 \uBD84\uC11D"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305", "\uBA40\uC158"],
  },
  line: {
    name: "LINE",
    emoji: "\uD83D\uDFE2",
    color: "#06C755",
    textColor: "#ffffff",
    tagline: "\uC544\uC2DC\uC544 \uCD5C\uB300 \uBA54\uC2E0\uC800\uC5D0\uC11C AI\uB97C",
    description: "\uC77C\uBCF8, \uD0DC\uAD6D, \uB300\uB9CC \uB4F1 \uC544\uC2DC\uC544 \uCD5C\uB300 \uBA54\uC2E0\uC800 LINE\uC5D0\uC11C MoA AI\uC640 \uB300\uD654\uD558\uC138\uC694.",
    connectUrl: "https://line.me/R/ti/p/@moa-ai",
    connectLabel: "LINE\uC5D0\uC11C \uB300\uD654 \uC2DC\uC791",
    features: ["\uACF5\uC2DD \uACC4\uC815 \uD1B5\uD569", "\uD14D\uC2A4\uD2B8/\uBBF8\uB514\uC5B4 \uB300\uD654", "\uADF8\uB8F9 \uCC44\uD305 AI", "\uB9AC\uCE58 \uBA54\uB274 \uC9C0\uC6D0", "\uC2A4\uD0F0\uD504 \uC5F0\uB3D9", "\uB2E4\uAD6D\uC5B4 \uC9C0\uC6D0"],
    setupGuide: [
      { step: 1, title: "LINE \uC571 \uC5F4\uAE30", detail: "LINE \uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "@moa-ai \uCE5C\uAD6C \uCD94\uAC00", detail: "ID \uAC80\uC0C9\uC5D0\uC11C @moa-ai\uB97C \uCC3E\uC544 \uCE5C\uAD6C \uCD94\uAC00\uD558\uC138\uC694." },
      { step: 3, title: "\uB300\uD654 \uC2DC\uC791", detail: "\uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uC751\uB2F5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["\uB9AC\uCE58 \uBA54\uB274\uB85C \uBE60\uB978 \uAE30\uB2A5 \uC811\uADFC", "\uC77C\uBCF8\uC5B4/\uD55C\uAD6D\uC5B4/\uC601\uC5B4 \uBAA8\uB450 \uC9C0\uC6D0"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "\uADF8\uB8F9 \uCC44\uD305", "\uB9AC\uCE58 \uBA54\uB274"],
  },
};

/* ============================================
   Default data for channels without detailed info
   ============================================ */

function getDefaultDetail(channelId: string): ChannelDetail {
  return {
    name: channelId.charAt(0).toUpperCase() + channelId.slice(1),
    emoji: "\uD83D\uDCAC",
    color: "#667eea",
    textColor: "#ffffff",
    tagline: `${channelId}\uC5D0\uC11C MoA AI\uC640 \uB300\uD654\uD558\uC138\uC694`,
    description: `${channelId} \uCC44\uB110\uC744 \uD1B5\uD574 MoA AI\uC640 \uC27D\uAC8C \uB300\uD654\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`,
    connectUrl: "#",
    connectLabel: `${channelId}\uC5D0\uC11C \uB300\uD654 \uC2DC\uC791`,
    features: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1", "100+ \uC2A4\uD0AC \uC0AC\uC6A9"],
    setupGuide: [
      { step: 1, title: `${channelId} \uC571 \uC5F4\uAE30`, detail: "\uC571\uC744 \uC5F4\uC5B4\uC8FC\uC138\uC694." },
      { step: 2, title: "MoA \uAC80\uC0C9 \uBC0F \uCD94\uAC00", detail: "MoA AI\uB97C \uAC80\uC0C9\uD558\uC5EC \uCD94\uAC00\uD558\uC138\uC694." },
      { step: 3, title: "\uB300\uD654 \uC2DC\uC791", detail: "\uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uC751\uB2F5\uD569\uB2C8\uB2E4." },
    ],
    tips: ["\uBAA8\uB4E0 \uCC44\uB110\uC5D0\uC11C \uB3D9\uC77C\uD55C AI \uACBD\uD5D8", "\uAE30\uC5B5\uC774 \uCC44\uB110 \uAC04 \uACF5\uC720\uB429\uB2C8\uB2E4"],
    supportedActions: ["\uD14D\uC2A4\uD2B8 \uB300\uD654", "\uBBF8\uB514\uC5B4 \uC804\uC1A1"],
  };
}

export default function ChannelDetailPage() {
  const params = useParams();
  const channelId = params.channel as string;
  const ch = CHANNEL_DETAILS[channelId] ?? getDefaultDetail(channelId);

  return (
    <>
      <Nav />
      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "900px" }}>
          {/* Breadcrumb */}
          <div style={{ marginBottom: "32px" }}>
            <Link href="/channels" style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              &larr; \uBAA8\uB4E0 \uCC44\uB110
            </Link>
          </div>

          {/* Channel Header */}
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <div style={{ fontSize: "4rem", marginBottom: "16px" }}>{ch.emoji}</div>
            <h1 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "8px" }}>
              {ch.name}
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "1.1rem", marginBottom: "24px" }}>
              {ch.tagline}
            </p>
            <a
              href={ch.connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-lg"
              style={{ background: ch.color, color: ch.textColor, minWidth: "280px" }}
            >
              {ch.connectLabel}
            </a>
          </div>

          {/* Description */}
          <div className="card" style={{ marginBottom: "32px", padding: "24px 32px" }}>
            <p style={{ fontSize: "1rem", lineHeight: 1.8, color: "var(--text)" }}>
              {ch.description}
            </p>
          </div>

          {/* Features */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"\u2728"} \uC9C0\uC6D0 \uAE30\uB2A5
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {ch.features.map((feat) => (
                <span
                  key={feat}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "20px",
                    background: `${ch.color}15`,
                    color: ch.color,
                    border: `1px solid ${ch.color}30`,
                    fontSize: "0.9rem",
                    fontWeight: 500,
                  }}
                >
                  {feat}
                </span>
              ))}
            </div>
          </section>

          {/* Setup Guide */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"\uD83D\uDCCB"} \uC124\uC815 \uAC00\uC774\uB4DC
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {ch.setupGuide.map((step) => (
                <div
                  key={step.step}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "16px",
                    padding: "20px 24px",
                    borderLeft: `4px solid ${ch.color}`,
                  }}
                >
                  <span
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: ch.color,
                      color: ch.textColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {step.step}
                  </span>
                  <div>
                    <h3 style={{ fontSize: "1rem", marginBottom: "4px" }}>{step.title}</h3>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Tips */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"\uD83D\uDCA1"} \uD301
            </h2>
            <div className="card" style={{ padding: "20px 24px" }}>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                {ch.tips.map((tip) => (
                  <li key={tip} style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {"\u2713"} {tip}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Actions supported */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"\u26A1"} \uC9C0\uC6D0 \uC791\uC5C5
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {ch.supportedActions.map((action) => (
                <span
                  key={action}
                  className="tag"
                  style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                >
                  {action}
                </span>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <a
              href={ch.connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-lg"
              style={{ background: ch.color, color: ch.textColor, minWidth: "280px", marginBottom: "16px" }}
            >
              {ch.connectLabel}
            </a>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }}>
              <Link href="/chat" className="btn btn-outline btn-sm">
                \uC6F9\uC5D0\uC11C \uBC14\uB85C \uCC44\uD305
              </Link>
              <Link href="/channels" className="btn btn-outline btn-sm">
                \uB2E4\uB978 \uCC44\uB110 \uBCF4\uAE30
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
