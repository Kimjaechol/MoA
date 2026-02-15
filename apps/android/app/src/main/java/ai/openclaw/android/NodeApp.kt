package ai.openclaw.android

import android.app.Application
import android.os.StrictMode
import ai.openclaw.android.push.MoaFirebaseMessagingService
import ai.openclaw.android.push.PushTokenManager

class NodeApp : Application() {
  val runtime: NodeRuntime by lazy { NodeRuntime(this) }

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.DEBUG) {
      StrictMode.setThreadPolicy(
        StrictMode.ThreadPolicy.Builder()
          .detectAll()
          .penaltyLog()
          .build(),
      )
      StrictMode.setVmPolicy(
        StrictMode.VmPolicy.Builder()
          .detectAll()
          .penaltyLog()
          .build(),
      )
    }

    // FCM 알림 채널 생성 + 푸시 토큰 등록
    MoaFirebaseMessagingService.createNotificationChannel(this)
    PushTokenManager.registerTokenWithGateway(this)
  }
}
