package com.rajkumar.thunai.stealthmode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoStealthModeModule : Module() {

  private val stealthReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action == "com.rajkumar.thunai.STEALTH_ACTIVATED") {
              this@ExpoStealthModeModule.sendEvent("onStealthActivated")
          }
      }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoStealthMode")

    Events("onStealthActivated")

    OnCreate {
        val filter = IntentFilter("com.rajkumar.thunai.STEALTH_ACTIVATED")
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
  }
}
