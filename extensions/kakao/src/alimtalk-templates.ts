/**
 * AlimTalk (알림톡) Template Definitions
 *
 * These templates must be registered and approved in NHN Cloud Console
 * before they can be used for sending notifications.
 *
 * Registration path: NHN Cloud Console > Notification > KakaoTalk Bizmessage > 알림톡 > 템플릿 관리
 *
 * Template variables use #{variableName} format in NHN Cloud.
 * Each template must pass Kakao's review (영업일 2일 이내).
 */

export interface AlimTalkTemplate {
  /** Template code registered in NHN Cloud */
  code: string;
  /** Human-readable template name */
  name: string;
  /** Template description */
  description: string;
  /** Required parameter names */
  requiredParams: string[];
  /** Optional parameter names */
  optionalParams?: string[];
  /** Template message preview (for reference — actual template is in NHN Cloud) */
  messagePreview: string;
  /** Buttons (if any) */
  buttons?: Array<{
    ordering: number;
    type: "WL" | "AL" | "DS" | "BK" | "MD" | "AC";
    name: string;
    linkMo?: string;
    linkPc?: string;
  }>;
}

/**
 * MoA AlimTalk Template Registry
 *
 * Register these templates in NHN Cloud Console before use.
 */
export const ALIMTALK_TEMPLATES: Record<string, AlimTalkTemplate> = {
  // ============================================
  // Device Management Templates
  // ============================================

  /** Device pairing complete notification */
  moa_device_paired: {
    code: "moa_device_paired",
    name: "MoA 기기 연결 완료",
    description: "기기가 MoA에 페어링 완료되었을 때 발송",
    requiredParams: ["deviceName"],
    messagePreview: `#{deviceName} 기기가 MoA에 성공적으로 연결되었습니다.

이제 카카오톡에서 바로 기기를 제어할 수 있습니다.

사용 예시:
@#{deviceName} 파일 목록 보여줘
@#{deviceName} 오늘 일정 알려줘

MoA가 항상 대기하고 있습니다!`,
    buttons: [
      {
        ordering: 1,
        type: "WL",
        name: "MoA 사용법 보기",
        linkMo: "https://mymoa.app/guide",
        linkPc: "https://mymoa.app/guide",
      },
    ],
  },

  /** Remote command execution result */
  moa_command_result: {
    code: "moa_command_result",
    name: "MoA 원격 명령 결과",
    description: "원격 명령 실행 완료 시 결과 알림",
    requiredParams: ["deviceName", "commandText", "status", "resultSummary", "commandId"],
    messagePreview: `#{deviceName} 기기의 명령 실행이 완료되었습니다.

명령: #{commandText}
상태: #{status}
결과: #{resultSummary}

카카오톡에서 "/원격결과 #{commandId}"를 입력하여 상세 내용을 확인하세요.`,
  },

  /** Device went offline */
  moa_device_offline: {
    code: "moa_device_offline",
    name: "MoA 기기 오프라인 알림",
    description: "연결된 기기가 오프라인이 되었을 때 알림",
    requiredParams: ["deviceName", "lastSeenAt"],
    messagePreview: `#{deviceName} 기기와의 연결이 끊어졌습니다.

마지막 연결 시각: #{lastSeenAt}

기기의 인터넷 연결과 MoA 에이전트 실행 상태를 확인해주세요.

카카오톡에서 "/연결상태"를 입력하면 전체 기기 상태를 확인할 수 있습니다.`,
  },

  // ============================================
  // Security Templates
  // ============================================

  /** Security alert (e.g., panic stop, unauthorized access) */
  moa_security_alert: {
    code: "moa_security_alert",
    name: "MoA 보안 알림",
    description: "보안 관련 이벤트 발생 시 긴급 알림",
    requiredParams: ["alertType", "alertMessage", "timestamp"],
    messagePreview: `MoA 보안 알림

#{alertType}: #{alertMessage}

시각: #{timestamp}

즉시 확인이 필요합니다.
카카오톡에서 "사용자 인증" 을 입력하여 본인 확인 후 조치해주세요.`,
    buttons: [
      {
        ordering: 1,
        type: "WL",
        name: "확인하기",
        linkMo: "https://mymoa.app/security",
        linkPc: "https://mymoa.app/security",
      },
    ],
  },

  // ============================================
  // Backup & Recovery Templates
  // ============================================

  /** Backup completed */
  moa_backup_complete: {
    code: "moa_backup_complete",
    name: "MoA 백업 완료",
    description: "자동/수동 백업이 완료되었을 때 알림",
    requiredParams: ["backupType", "backupSize", "timestamp"],
    messagePreview: `MoA 백업이 완료되었습니다.

유형: #{backupType}
크기: #{backupSize}
시각: #{timestamp}

백업은 암호화되어 안전하게 저장됩니다.`,
    buttons: [
      {
        ordering: 1,
        type: "WL",
        name: "백업 관리",
        linkMo: "https://mymoa.app/backup",
        linkPc: "https://mymoa.app/backup",
      },
    ],
  },

  // ============================================
  // Account Templates
  // ============================================

  /** Welcome after signup */
  moa_welcome: {
    code: "moa_welcome",
    name: "MoA 가입 환영",
    description: "회원가입 완료 후 환영 메시지",
    requiredParams: ["username"],
    messagePreview: `#{username}님, MoA에 오신 것을 환영합니다!

MoA는 당신의 모든 기기를 하나의 AI로 연결하는 어시스턴트입니다.

시작하기:
1. 기기에 MoA 설치
2. 카카오톡에서 기기 제어
3. 어디서든 AI와 대화

궁금한 점이 있으면 언제든 카카오톡으로 물어보세요!`,
    buttons: [
      {
        ordering: 1,
        type: "WL",
        name: "MoA 설치하기",
        linkMo: "https://mymoa.app/install",
        linkPc: "https://mymoa.app/install",
      },
    ],
  },

  /** Subscription status change */
  moa_subscription_change: {
    code: "moa_subscription_change",
    name: "MoA 구독 변경 알림",
    description: "구독 플랜 변경/갱신 시 알림",
    requiredParams: ["planName", "status", "nextBillingDate"],
    messagePreview: `MoA 구독 안내

플랜: #{planName}
상태: #{status}
다음 결제일: #{nextBillingDate}

구독 관리는 카카오톡에서 "/구독상태"를 입력하세요.`,
  },

  // ============================================
  // Channel Engagement Templates
  // ============================================

  /** Channel join invitation (sent to website signups who aren't channel friends) */
  moa_channel_join: {
    code: "moa_channel_join",
    name: "MoA 카카오톡 채널 가입 안내",
    description: "웹사이트에서 가입한 사용자에게 카카오톡 채널 가입을 유도하는 알림",
    requiredParams: ["username", "channelName"],
    messagePreview: `#{username}님, MoA 가입을 환영합니다!

카카오톡에서도 MoA를 사용할 수 있습니다.

카카오톡 #{channelName} 채널을 추가하시면:
- 카카오톡에서 바로 AI와 대화
- 기기 원격 제어 명령
- 매일 아침 날씨 알림
- 중요 알림 실시간 수신

아래 버튼을 눌러 채널을 추가해주세요!`,
    buttons: [
      {
        ordering: 1,
        type: "AC",
        name: "채널 추가하기",
      },
    ],
  },

  /** Daily weather greeting (AlimTalk version — for non-friends as backup) */
  moa_daily_greeting: {
    code: "moa_daily_greeting",
    name: "MoA 일일 인사",
    description: "매일 아침 날씨와 함께 보내는 인사 메시지",
    requiredParams: ["date", "weather", "temp", "advice"],
    messagePreview: `좋은 아침이에요! #{date}

오늘의 날씨: #{weather}
현재 기온: #{temp}
#{advice}

오늘도 MoA와 함께 좋은 하루 보내세요!`,
  },

  /** Referral invitation (sent when a friend shares MoA) */
  moa_referral_invite: {
    code: "moa_referral_invite",
    name: "MoA 친구 추천 알림",
    description: "친구가 MoA를 추천했을 때 보내는 알림",
    requiredParams: ["referrerName"],
    messagePreview: `#{referrerName}님이 MoA를 추천했습니다!

MoA는 카카오톡으로 내 컴퓨터를 원격 제어하고 AI 어시스턴트와 대화할 수 있는 서비스입니다.

지금 가입하시면 추천인과 함께 보너스 크레딧을 받으실 수 있습니다!`,
    buttons: [
      {
        ordering: 1,
        type: "WL",
        name: "MoA 시작하기",
        linkMo: "https://mymoa.app/install",
        linkPc: "https://mymoa.app/install",
      },
    ],
  },
};

/**
 * Get a template by code
 */
export function getAlimTalkTemplate(code: string): AlimTalkTemplate | undefined {
  return ALIMTALK_TEMPLATES[code];
}

/**
 * List all available template codes
 */
export function listAlimTalkTemplateCodes(): string[] {
  return Object.keys(ALIMTALK_TEMPLATES);
}

/**
 * Validate template parameters before sending
 */
export function validateTemplateParams(
  code: string,
  params: Record<string, string>,
): { valid: boolean; missing: string[] } {
  const template = ALIMTALK_TEMPLATES[code];
  if (!template) {
    return { valid: false, missing: [`Template "${code}" not found`] };
  }

  const missing: string[] = [];
  for (const required of template.requiredParams) {
    if (!params[required] || params[required].trim() === "") {
      missing.push(required);
    }
  }

  return { valid: missing.length === 0, missing };
}
