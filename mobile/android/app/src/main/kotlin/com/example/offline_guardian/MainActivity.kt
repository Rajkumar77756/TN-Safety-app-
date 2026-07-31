package com.example.offline_guardian

import android.content.Intent
import android.net.Uri
import android.telephony.SmsManager
import androidx.annotation.NonNull
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
    private val CHANNEL = "offline_guardian.sms"

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler {
            call, result ->
            when (call.method) {
                "sendMultipartSms" -> {
                    val number = call.argument<String>("number")
                    val message = call.argument<String>("message")
                    if (number != null && message != null) {
                        sendMultipartSms(number, message)
                        result.success(null)
                    } else {
                        result.error("INVALID_ARGS", "Number or message missing", null)
                    }
                }
                "actionDial" -> {
                    val number = call.argument<String>("number")
                    if (number != null) {
                        actionDial(number)
                        result.success(null)
                    } else {
                        result.error("INVALID_ARGS", "Number missing", null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun sendMultipartSms(phoneNumber: String, message: String) {
        val smsManager = SmsManager.getDefault()
        val parts = smsManager.divideMessage(message)
        smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
    }

    private fun actionDial(phoneNumber: String) {
        val intent = Intent(Intent.ACTION_DIAL).apply {
            data = Uri.parse("tel:$phoneNumber")
        }
        startActivity(intent)
    }
}
