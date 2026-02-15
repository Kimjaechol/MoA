import Foundation
import UIKit
import UserNotifications

/// MoA 푸시 알림 관리자
///
/// 3계층 무료 우선 발송 체계의 2계층 (APNs 푸시)을 앱에서 처리합니다.
/// - APNs 디바이스 토큰을 등록하고 게이트웨이 서버에 전달
/// - 포그라운드/백그라운드 알림 표시
///
/// 비용: 무료 (APNs는 무제한 무료)
@MainActor
final class PushNotificationManager: NSObject, ObservableObject {
    static let shared = PushNotificationManager()

    private var deviceToken: String?
    private var gateway: GatewayNodeSession?
    private var isRegistered = false

    private override init() {
        super.init()
    }

    /// 게이트웨이 세션 연결 (앱 시작 시 호출)
    func attachGateway(_ gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    /// 푸시 알림 권한 요청 + APNs 등록
    func requestPermissionAndRegister() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("[push] Permission request failed: \(error.localizedDescription)")
                return
            }

            guard granted else {
                print("[push] Permission denied by user")
                return
            }

            print("[push] Permission granted")
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// APNs 디바이스 토큰 수신 (AppDelegate에서 호출)
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = tokenString
        print("[push] APNs device token: \(tokenString.prefix(20))...")
        sendTokenToGateway()
    }

    /// APNs 등록 실패
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[push] APNs registration failed: \(error.localizedDescription)")
    }

    /// 게이트웨이에 푸시 토큰 전송
    private func sendTokenToGateway() {
        guard let token = deviceToken, let gateway else {
            print("[push] Cannot send token: missing token or gateway")
            return
        }

        guard !isRegistered else { return }

        Task {
            do {
                let payload: [String: Any] = [
                    "pushToken": token,
                    "pushPlatform": "apns"
                ]
                let payloadJSON = try JSONSerialization.data(withJSONObject: payload)
                let payloadString = String(data: payloadJSON, encoding: .utf8) ?? "{}"
                try await gateway.sendEvent(event: "push_token.register", payloadJSON: payloadString)
                isRegistered = true
                print("[push] Push token registered with gateway")
            } catch {
                print("[push] Failed to register push token: \(error.localizedDescription)")
            }
        }
    }

    /// 게이트웨이 재연결 시 토큰 재등록
    func onGatewayReconnected() {
        isRegistered = false
        sendTokenToGateway()
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {
    /// 포그라운드에서 알림 수신 시 배너 표시
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    /// 알림 탭 시 처리
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("[push] Notification tapped: \(userInfo)")
        completionHandler()
    }
}
