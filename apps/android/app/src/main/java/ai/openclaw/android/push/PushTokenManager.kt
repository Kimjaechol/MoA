package ai.openclaw.android.push

import android.content.Context
import android.util.Log
import ai.openclaw.android.NodeApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * FCM 푸시 토큰 관리
 *
 * FCM 토큰을 가져오고, 게이트웨이 서버에 등록합니다.
 * 토큰이 갱신되면 서버에도 자동으로 업데이트됩니다.
 */
object PushTokenManager {
  private const val TAG = "PushTokenManager"
  private const val PREF_KEY_PUSH_TOKEN = "fcm_push_token"
  private const val PREF_KEY_TOKEN_REGISTERED = "fcm_token_registered"

  /**
   * 현재 FCM 토큰을 가져오고, 게이트웨이에 등록
   * 앱 시작 시 & 게이트웨이 연결 시 호출
   */
  fun registerTokenWithGateway(context: Context) {
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val token = FirebaseMessaging.getInstance().token.await()
        Log.d(TAG, "FCM token obtained: ${token.take(20)}...")
        saveToken(context, token)
        sendTokenToGateway(context, token)
      } catch (e: Exception) {
        Log.w(TAG, "Failed to get FCM token", e)
      }
    }
  }

  /**
   * 토큰 갱신 시 콜백 (MoaFirebaseMessagingService에서 호출)
   */
  fun onTokenRefreshed(context: Context, token: String) {
    Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
    saveToken(context, token)
    markTokenUnregistered(context)
    sendTokenToGateway(context, token)
  }

  /**
   * 게이트웨이에 푸시 토큰 전송
   * NodeRuntime.registerPushToken()을 통해 node.event로 전송
   */
  private fun sendTokenToGateway(context: Context, token: String) {
    val app = context.applicationContext as? NodeApp ?: return
    val runtime = app.runtime

    CoroutineScope(Dispatchers.IO).launch {
      try {
        runtime.registerPushToken(token, "fcm")
        markTokenRegistered(context)
        Log.d(TAG, "Push token registered with gateway")
      } catch (e: Exception) {
        Log.w(TAG, "Failed to register push token with gateway", e)
      }
    }
  }

  /**
   * 저장된 토큰 조회
   */
  fun getSavedToken(context: Context): String? {
    return context.getSharedPreferences("moa_push", Context.MODE_PRIVATE)
      .getString(PREF_KEY_PUSH_TOKEN, null)
  }

  /**
   * 토큰이 서버에 등록되었는지 확인
   */
  fun isTokenRegistered(context: Context): Boolean {
    return context.getSharedPreferences("moa_push", Context.MODE_PRIVATE)
      .getBoolean(PREF_KEY_TOKEN_REGISTERED, false)
  }

  private fun saveToken(context: Context, token: String) {
    context.getSharedPreferences("moa_push", Context.MODE_PRIVATE)
      .edit()
      .putString(PREF_KEY_PUSH_TOKEN, token)
      .apply()
  }

  private fun markTokenRegistered(context: Context) {
    context.getSharedPreferences("moa_push", Context.MODE_PRIVATE)
      .edit()
      .putBoolean(PREF_KEY_TOKEN_REGISTERED, true)
      .apply()
  }

  private fun markTokenUnregistered(context: Context) {
    context.getSharedPreferences("moa_push", Context.MODE_PRIVATE)
      .edit()
      .putBoolean(PREF_KEY_TOKEN_REGISTERED, false)
      .apply()
  }
}
