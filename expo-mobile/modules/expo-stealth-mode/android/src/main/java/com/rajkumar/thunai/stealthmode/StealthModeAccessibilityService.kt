package com.rajkumar.thunai.stealthmode

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper

class StealthModeAccessibilityService : AccessibilityService() {

    companion object {
        const val TAG = "StealthModeService"
        var isServiceActive = false
        var isStealthModeEnabled = false // Toggle controlled from React Native
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceActive = true
        Log.d(TAG, "Stealth Mode Accessibility Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!isStealthModeEnabled) return

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val className = event.className?.toString() ?: ""
            val packageName = event.packageName?.toString() ?: ""
            
            Log.d(TAG, "Window State Changed: pkg=$packageName, cls=$className")

            // Detect Android system power menu or global actions dialog
            if (packageName == "android" || packageName == "com.android.systemui") {
                if (className.contains("GlobalActionsDialog") || className.contains("ResolverActivity") || className.contains("PowerMenu")) {
                    Log.d(TAG, "Detected Power Menu! Triggering Fake Overlay!")
                    
                    // Close the real system dialog (if possible)
                    val closeDialogsIntent = Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS)
                    sendBroadcast(closeDialogsIntent)

                    // Launch our Fake Power Menu Overlay Service/Activity
                    triggerFakePowerMenu()
                }
            }
        }
    }

    private fun triggerFakePowerMenu() {
        // We will start a foreground service or overlay window that draws the fake menu
        val intent = Intent(this, FakePowerMenuService::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startService(intent)
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service Interrupted")
    }

    override fun onUnbind(intent: Intent?): Boolean {
        isServiceActive = false
        Log.d(TAG, "Service Unbound")
        return super.onUnbind(intent)
    }
}
