package com.rajkumar.thunai.stealthmode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoStealthModeModule : Module() {

  private val stealthReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action == "com.rajkumar.thunai.STEALTH_ACTIVATED") {
              this@ExpoStealthModeModule.sendEvent("onStealthActivated")
          } else if (intent?.action == "com.rajkumar.thunai.SOS_RECEIVED") {
              val payload = intent.getByteArrayExtra("payload")
              if (payload != null) {
                  this@ExpoStealthModeModule.sendEvent("onSosRelayReceived", mapOf(
                      "payloadBase64" to android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP)
                  ))
              }
          }
      }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoStealthMode")

    Events("onStealthActivated", "onSosRelayReceived")

    OnCreate {
        val filter = IntentFilter()
        filter.addAction("com.rajkumar.thunai.STEALTH_ACTIVATED")
        filter.addAction("com.rajkumar.thunai.SOS_RECEIVED")
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            appContext.reactContext?.registerReceiver(stealthReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            appContext.reactContext?.registerReceiver(stealthReceiver, filter)
        }
    }

    OnDestroy {
        try {
            appContext.reactContext?.unregisterReceiver(stealthReceiver)
        } catch (e: Exception) {
            // Ignored
        }
    }

    Function("isAccessibilityServiceEnabled") {
        // Just a simple check for now, production apps iterate through Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        StealthModeAccessibilityService.isServiceActive
    }

    Function("setStealthModeActive") { active: Boolean ->
        StealthModeAccessibilityService.isStealthModeEnabled = active
    }

    Function("openAccessibilitySettings") {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.reactContext?.startActivity(intent)
    }
    
    Function("openOverlaySettings") {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.reactContext?.startActivity(intent)
    }

    Function("startMeshService") {
        val context = appContext.reactContext
        if (context != null) {
            try {
                val intent = Intent(context, BleMeshService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                android.util.Log.d("ExpoStealthMode", "startMeshService called successfully")
            } catch (e: Exception) {
                android.util.Log.e("ExpoStealthMode", "Failed to start BleMeshService", e)
            }
        }
    }

    Function("stopMeshService") {
        val context = appContext.reactContext
        if (context != null) {
            try {
                val intent = Intent(context, BleMeshService::class.java)
                context.stopService(intent)
                android.util.Log.d("ExpoStealthMode", "stopMeshService called successfully")
            } catch (e: Exception) {
                android.util.Log.e("ExpoStealthMode", "Failed to stop BleMeshService", e)
            }
        }
    }

    Function("broadcastSosPayload") { payloadBase64: String ->
        val context = appContext.reactContext
        if (context != null) {
            try {
                val payload = android.util.Base64.decode(payloadBase64, android.util.Base64.NO_WRAP)
                val intent = Intent(context, BleMeshService::class.java).apply {
                    action = "BROADCAST_SOS"
                    putExtra("payload", payload)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                android.util.Log.d("ExpoStealthMode", "broadcastSosPayload called successfully, payload bytes: ${payload.size}")
            } catch (e: Exception) {
                android.util.Log.e("ExpoStealthMode", "Failed to call broadcastSosPayload", e)
            }
        }
    }

    Function("requestBatteryExemption") {
        val context = appContext.reactContext
        if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            }
        }
    }
  }
}
