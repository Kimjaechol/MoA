/**
 * Action Guard - 행동 실행 전 권한 검증 미들웨어
 *
 * 모든 민감한 행동 실행 전에 이 모듈을 통해 권한을 확인합니다.
 *
 * 사용 예:
 * ```typescript
 * const guard = await ActionGuard.check(userId, "send_email", { to: "user@example.com" });
 * if (!guard.canProceed) {
 *   return guard.responseMessage; // 사용자에게 권한 요청 메시지 반환
 * }
 * // 실제 이메일 발송 로직
 * ```
 */

import {
  type SensitiveActionCategory,
  type PendingConfirmation,
  checkPermission,
  grantPermission,
  revokePermission,
  revokeAllPermissions,
  createConfirmationRequest,
  handleConfirmationResponse,
  isConfirmationResponse,
  detectSensitiveIntent,
  parsePermissionCommand,
  formatPermissionRequestMessage,
  formatConfirmationMessage,
  formatPermissionStatusMessage,
  logAction,
  SENSITIVE_ACTIONS,
} from "./action-permissions.js";

// ============================================
// 행동 가드 결과
// ============================================

export interface ActionGuardResult {
  canProceed: boolean;
  needsResponse: boolean;
  responseMessage?: string;
  quickReplies?: string[];
  permissionStatus: "granted" | "denied" | "pending" | "needs_permission" | "needs_confirmation";
  pendingConfirmation?: PendingConfirmation;
}

// ============================================
// 행동 가드 클래스
// ============================================

export class ActionGuard {
  /**
   * 행동 수행 전 권한 확인
   */
  static async check(
    kakaoUserId: string,
    action: SensitiveActionCategory,
    details: Record<string, unknown> = {},
  ): Promise<ActionGuardResult> {
    // 권한 확인
    const permCheck = await checkPermission(kakaoUserId, action);
    const actionInfo = SENSITIVE_ACTIONS[action];

    // 권한 있음
    if (permCheck.allowed) {
      // 감사 로그
      await logAction(kakaoUserId, `action_executed:${action}`, details, "success");

      return {
        canProceed: true,
        needsResponse: false,
        permissionStatus: "granted",
      };
    }

    // 권한 없음 또는 확인 필요
    switch (permCheck.reason) {
      case "not_requested":
        // 권한이 없음 - 구체적 행위 내용과 함께 1회성 권한 요청 메시지 생성
        const actionDetails = formatActionDetails(action, details);
        await logAction(kakaoUserId, `permission_requested:${action}`, details, "pending");

        return {
          canProceed: false,
          needsResponse: true,
          responseMessage: formatPermissionRequestMessage(action, actionDetails),
          quickReplies: ["네", "아니오", "계속 허용"],
          permissionStatus: "needs_permission",
        };

      case "needs_confirmation":
        // 매번 확인 필요한 행동 - 확인 요청 생성
        const detailsStr = formatActionDetails(action, details);
        const confirmation = createConfirmationRequest(kakaoUserId, action, detailsStr);

        await logAction(kakaoUserId, `confirmation_requested:${action}`, details, "pending");

        return {
          canProceed: false,
          needsResponse: true,
          responseMessage: formatConfirmationMessage(action, detailsStr),
          quickReplies: ["네", "아니오", "계속 허용"],
          permissionStatus: "needs_confirmation",
          pendingConfirmation: confirmation,
        };

      case "expired":
        // 이전 1회성 권한 사용 완료 - 다시 동의 필요
        const expiredDetails = formatActionDetails(action, details);
        await logAction(kakaoUserId, `permission_expired:${action}`, details, "blocked");

        return {
          canProceed: false,
          needsResponse: true,
          responseMessage: formatPermissionRequestMessage(action, expiredDetails),
          quickReplies: ["네", "아니오", "계속 허용"],
          permissionStatus: "needs_permission",
        };

      case "denied":
        // 명시적 거부
        await logAction(kakaoUserId, `action_blocked:${action}`, details, "blocked");

        return {
          canProceed: false,
          needsResponse: true,
          responseMessage: `🚫 "${actionInfo.name}" 행위가 거부되었습니다.\n\n다음에 필요하시면 다시 요청해주세요.`,
          permissionStatus: "denied",
        };

      default:
        return {
          canProceed: false,
          needsResponse: true,
          responseMessage: "알 수 없는 오류가 발생했습니다.",
          permissionStatus: "denied",
        };
    }
  }

  /**
   * 메시지에서 민감한 의도 감지 및 사전 차단
   */
  static async precheck(
    kakaoUserId: string,
    message: string,
  ): Promise<{
    hasSensitiveIntent: boolean;
    guardResults: ActionGuardResult[];
    blockedActions: SensitiveActionCategory[];
  }> {
    const intent = detectSensitiveIntent(message);

    if (!intent.detected) {
      return {
        hasSensitiveIntent: false,
        guardResults: [],
        blockedActions: [],
      };
    }

    const guardResults: ActionGuardResult[] = [];
    const blockedActions: SensitiveActionCategory[] = [];

    for (const action of intent.actions) {
      const result = await this.check(kakaoUserId, action, { message });

      if (!result.canProceed) {
        blockedActions.push(action);
      }

      guardResults.push(result);
    }

    return {
      hasSensitiveIntent: true,
      guardResults,
      blockedActions,
    };
  }

  /**
   * 권한 관련 명령어 처리
   */
  static async handlePermissionCommand(
    kakaoUserId: string,
    message: string,
  ): Promise<{
    handled: boolean;
    response?: string;
    quickReplies?: string[];
  }> {
    const cmd = parsePermissionCommand(message);

    if (!cmd.isCommand) {
      return { handled: false };
    }

    switch (cmd.action) {
      case "status":
        const statusMsg = await formatPermissionStatusMessage(kakaoUserId);
        return {
          handled: true,
          response: statusMsg,
          quickReplies: ["권한 허용 이메일", "모든 권한 취소"],
        };

      case "grant":
        if (cmd.category) {
          // 명시적 명령어로 부여해도 1회성
          await grantPermission(kakaoUserId, cmd.category, {
            expiresIn: 30 * 1000,
            scope: "one_time",
          });
          const info = SENSITIVE_ACTIONS[cmd.category];
          return {
            handled: true,
            response: `✅ "${info.name}" 행위가 이번 1회에 한해 허용되었습니다.`,
            quickReplies: ["권한 상태"],
          };
        }
        return {
          handled: true,
          response: "허용할 권한을 지정해주세요.\n\n예: 권한 허용 이메일",
        };

      case "revoke":
        if (cmd.category) {
          await revokePermission(kakaoUserId, cmd.category);
          const info = SENSITIVE_ACTIONS[cmd.category];
          return {
            handled: true,
            response: `🚫 "${info.name}" 권한이 취소되었습니다.`,
            quickReplies: ["권한 상태"],
          };
        }
        return {
          handled: true,
          response: "취소할 권한을 지정해주세요.\n\n예: 권한 취소 이메일",
        };

      case "revoke_all":
        await revokeAllPermissions(kakaoUserId);
        return {
          handled: true,
          response: "🔒 모든 권한이 취소되었습니다.\n\n앞으로 민감한 작업을 수행하려면 다시 권한을 요청해야 합니다.",
          quickReplies: ["권한 상태"],
        };

      default:
        return { handled: false };
    }
  }

  /**
   * 확인 응답 처리
   */
  static async handleConfirmationResponse(
    kakaoUserId: string,
    message: string,
  ): Promise<{
    handled: boolean;
    response?: string;
    approved?: boolean;
    action?: SensitiveActionCategory;
  }> {
    const confirmResponse = isConfirmationResponse(message);

    if (!confirmResponse.isResponse) {
      return { handled: false };
    }

    const result = await handleConfirmationResponse(
      kakaoUserId,
      confirmResponse.approved ?? false,
      confirmResponse.permanent ?? false,
    );

    if (!result.found) {
      return { handled: false };
    }

    return {
      handled: true,
      response: result.message,
      approved: confirmResponse.approved,
      action: result.confirmation?.action,
    };
  }

  /**
   * 권한 부여 응답 처리 (첫 권한 요청에 대한 응답)
   */
  static async handlePermissionResponse(
    kakaoUserId: string,
    message: string,
    pendingAction?: SensitiveActionCategory,
  ): Promise<{
    handled: boolean;
    granted?: boolean;
    response?: string;
  }> {
    const confirmResponse = isConfirmationResponse(message);

    if (!confirmResponse.isResponse || !pendingAction) {
      return { handled: false };
    }

    if (confirmResponse.approved) {
      const info = SENSITIVE_ACTIONS[pendingAction];

      if (confirmResponse.permanent) {
        // "계속 허용": 영구 권한 부여 (다시 묻지 않음)
        await grantPermission(kakaoUserId, pendingAction, {
          scope: "permanent",
        });
        return {
          handled: true,
          granted: true,
          response: `✅ "${info.name}" 행위가 계속 허용되었습니다.\n\n앞으로 동일한 행위를 할 때 다시 동의를 구하지 않습니다.\n취소하려면 "권한 취소 ${getActionKeyword(pendingAction)}"이라고 말씀해주세요.\n\n요청하신 작업을 진행합니다.`,
        };
      }

      // "네": 1회성 권한 부여 (이번 한 번만)
      await grantPermission(kakaoUserId, pendingAction, {
        expiresIn: 30 * 1000, // 30초 후 자동 만료 (1회 실행 충분한 시간)
        scope: "one_time",
      });
      return {
        handled: true,
        granted: true,
        response: `✅ "${info.name}" 행위가 이번 1회에 한해 허용되었습니다.\n\n요청하신 작업을 진행합니다.`,
      };
    } else {
      const info = SENSITIVE_ACTIONS[pendingAction];
      return {
        handled: true,
        granted: false,
        response: `🚫 "${info.name}" 행위가 거부되었습니다.\n\n다음에 필요하시면 다시 요청해주세요.`,
      };
    }
  }
}

// ============================================
// 헬퍼 함수
// ============================================

/**
 * 행동 상세 내용 포맷팅
 */
function formatActionDetails(
  action: SensitiveActionCategory,
  details: Record<string, unknown>,
): string {
  const lines: string[] = [];

  switch (action) {
    case "send_email":
      if (details.to) { lines.push(`• 받는 사람: ${String(details.to as string)}`); }
      if (details.subject) { lines.push(`• 제목: ${String(details.subject as string)}`); }
      break;

    case "send_sms":
    case "send_kakao":
    case "send_message":
      if (details.to) { lines.push(`• 받는 사람: ${String(details.to as string)}`); }
      if (details.preview) { lines.push(`• 내용 미리보기: ${String(details.preview as string).slice(0, 50)}...`); }
      break;

    case "make_payment":
      if (details.amount) { lines.push(`• 금액: ${String(details.amount as string)}원`); }
      if (details.recipient) { lines.push(`• 받는 곳: ${String(details.recipient as string)}`); }
      if (details.description) { lines.push(`• 설명: ${String(details.description as string)}`); }
      break;

    case "book_reservation":
      if (details.place) { lines.push(`• 장소: ${String(details.place as string)}`); }
      if (details.date) { lines.push(`• 날짜: ${String(details.date as string)}`); }
      if (details.time) { lines.push(`• 시간: ${String(details.time as string)}`); }
      break;

    case "execute_code":
      if (details.language) { lines.push(`• 언어: ${String(details.language as string)}`); }
      if (details.preview) { lines.push(`• 코드 미리보기:\n\`\`\`\n${String(details.preview as string).slice(0, 100)}...\n\`\`\``); }
      break;

    default:
      for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null && key !== "message") {
          lines.push(`• ${key}: ${String(value as string).slice(0, 100)}`);
        }
      }
  }

  return lines.length > 0 ? lines.join("\n") : "(상세 정보 없음)";
}

/**
 * 행동 카테고리의 한국어 키워드 반환
 */
function getActionKeyword(action: SensitiveActionCategory): string {
  const keywordMap: Record<SensitiveActionCategory, string> = {
    send_email: "이메일",
    send_sms: "문자",
    send_kakao: "카톡",
    send_message: "메시지",
    make_payment: "결제",
    access_contacts: "연락처",
    access_calendar: "캘린더",
    access_files: "파일",
    execute_code: "코드실행",
    api_call: "API",
    post_social: "SNS",
    book_reservation: "예약",
    modify_settings: "설정",
    share_data: "데이터공유",
  };

  return keywordMap[action] ?? action;
}

// ============================================
// 세션 상태 관리 (pending action 추적)
// ============================================

const pendingPermissionRequests = new Map<string, {
  action: SensitiveActionCategory;
  createdAt: Date;
  originalMessage: string;
}>();

/**
 * 권한 요청 대기 상태 설정
 */
export function setPendingPermissionRequest(
  kakaoUserId: string,
  action: SensitiveActionCategory,
  originalMessage: string,
): void {
  pendingPermissionRequests.set(kakaoUserId, {
    action,
    createdAt: new Date(),
    originalMessage,
  });

  // 5분 후 자동 만료
  setTimeout(() => {
    const pending = pendingPermissionRequests.get(kakaoUserId);
    if (pending && pending.action === action) {
      pendingPermissionRequests.delete(kakaoUserId);
    }
  }, 5 * 60 * 1000);
}

/**
 * 권한 요청 대기 상태 조회
 */
export function getPendingPermissionRequest(
  kakaoUserId: string,
): {
  action: SensitiveActionCategory;
  originalMessage: string;
} | undefined {
  const pending = pendingPermissionRequests.get(kakaoUserId);
  if (!pending) { return undefined; }

  // 5분 초과 시 만료
  if (Date.now() - pending.createdAt.getTime() > 5 * 60 * 1000) {
    pendingPermissionRequests.delete(kakaoUserId);
    return undefined;
  }

  return {
    action: pending.action,
    originalMessage: pending.originalMessage,
  };
}

/**
 * 권한 요청 대기 상태 해제
 */
export function clearPendingPermissionRequest(kakaoUserId: string): void {
  pendingPermissionRequests.delete(kakaoUserId);
}
