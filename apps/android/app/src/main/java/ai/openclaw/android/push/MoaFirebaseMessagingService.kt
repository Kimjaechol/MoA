package ai.openclaw.android.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ai.openclaw.android.MainActivity
import ai.openclaw.android.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * MoA FCM 메시지 수신 서비스
 *
 * 3계층 무료 우선 발송 체계의 2계층(FCM)에서 전송된 푸시 알림을 수신합니다.
 * 앱이 포그라운드가 아닐 때 서버에서 보낸 알림을 처리합니다.
 *
 * 비용: 무료 (FCM은 무제한 무료)
 */
class MoaFirebaseMessagingService : FirebaseMessagingService() {

  companion object {
    const val CHANNEL_ID = "moa_messages"
    private const val CHANNEL_NAME = "MoA 메시지"
    private const val CHANNEL_DESCRIPTION = "MoA AI 어시스턴트 알림"

    /**
     * 알림 채널 생성 (앱 시작 시 호출)
     */
    fun createNotificationChannel(context: Context) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = CHANNEL_DESCRIPTION
        enableVibration(true)
      }

      val manager = context.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }

  /**
   * FCM 토큰이 갱신될 때 호출
   * 새 토큰을 게이트웨이 서버에 등록합니다
   */
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    PushTokenManager.onTokenRefreshed(applicationContext, token)
  }

  /**
   * 푸시 메시지 수신
   * data 메시지와 notification 메시지 모두 처리
   */
  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)

    val title = message.notification?.title
      ?: message.data["title"]
      ?: "MoA"
    val body = message.notification?.body
      ?: message.data["body"]
      ?: return // 본문 없으면 무시

    showNotification(title, body, message.data)
  }

  private fun showNotification(
    title: String,
    body: String,
    data: Map<String, String>,
  ) {
    // 알림 권한 체크
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
      != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      data.forEach { (key, value) -> putExtra(key, value) }
    }

    val pendingIntent = PendingIntent.getActivity(
      this,
      System.currentTimeMillis().toInt(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build()

    NotificationManagerCompat.from(this)
      .notify(System.currentTimeMillis().toInt(), notification)
  }
}
