/**
 * 알림톡 템플릿 정의
 *
 * NHN Cloud Toast에 사전 등록해야 하는 템플릿입니다.
 * 카카오 비즈메시지 검수 후 사용 가능합니다.
 *
 * 등록 절차:
 *   1. NHN Cloud Console → Notification → KakaoTalk Bizmessage
 *   2. 알림톡 → 템플릿 관리 → 등록
 *   3. templateCode를 여기에 입력한 코드와 동일하게 설정
 *   4. 검수 완료 후 사용 가능
 */

export type AlimtalkTemplate = {
  code: string;
  name: string;
  /** 템플릿 본문 (#{변수명} 형식) */
  body: string;
  /** 치환 변수 키 목록 */
  variables: string[];
  /** 버튼 (NHN Cloud에 등록 시 동일하게 설정) */
  buttons?: Array<{
    ordering: number;
    type: "WL" | "AL" | "DS" | "BK" | "MD";
    name: string;
    linkMo?: string;
    linkPc?: string;
  }>;
};

/**
 * 채널 추가 유도 알림톡
 *
 * 회원가입 후 자동 발송됩니다.
 * 이용자가 카카오톡 채널을 추가하면 MoA와 카카오톡으로 대화할 수 있습니다.
 */
export const CHANNEL_INVITE_TEMPLATE: AlimtalkTemplate = {
  code: "MoA_CHANNEL_INVITE",
  name: "MoA 카카오톡 채널 추가 안내",
  body: [
    "#{nickname}님, MoA 가입을 환영합니다!",
    "",
    "MoA 카카오톡 채널을 추가하시면:",
    "- 카카오톡으로 AI에게 바로 질문",
    "- 중요 알림을 카카오톡으로 수신",
    "- 문서 분석, 번역, 요약 등 AI 기능 사용",
    "",
    "아래 버튼을 눌러 채널을 추가해 주세요.",
  ].join("\n"),
  variables: ["nickname"],
  buttons: [
    {
      ordering: 1,
      type: "WL",
      name: "MoA 채널 추가하기",
      linkMo: "https://pf.kakao.com/_xoMoAC",
      linkPc: "https://pf.kakao.com/_xoMoAC",
    },
    {
      ordering: 2,
      type: "WL",
      name: "MoA 웹에서 시작하기",
      linkMo: "https://mymoa.app",
      linkPc: "https://mymoa.app",
    },
  ],
};

/**
 * 가입 완료 안내 알림톡 (대체용 — 채널 추가 미포함 간단 버전)
 */
export const WELCOME_TEMPLATE: AlimtalkTemplate = {
  code: "MoA_WELCOME",
  name: "MoA 가입 완료 안내",
  body: [
    "#{nickname}님, MoA에 가입해 주셔서 감사합니다!",
    "",
    "MoA는 여러 AI를 한 곳에서 사용할 수 있는 서비스입니다.",
    "무료 체험 기간: #{trial_days}일",
    "",
    "지금 바로 AI에게 질문해 보세요!",
  ].join("\n"),
  variables: ["nickname", "trial_days"],
  buttons: [
    {
      ordering: 1,
      type: "WL",
      name: "MoA 시작하기",
      linkMo: "https://mymoa.app",
      linkPc: "https://mymoa.app",
    },
  ],
};

/**
 * NHN Cloud Toast에 등록할 전체 템플릿 목록
 */
export const ALIMTALK_TEMPLATES: Record<string, AlimtalkTemplate> = {
  [CHANNEL_INVITE_TEMPLATE.code]: CHANNEL_INVITE_TEMPLATE,
  [WELCOME_TEMPLATE.code]: WELCOME_TEMPLATE,
};
