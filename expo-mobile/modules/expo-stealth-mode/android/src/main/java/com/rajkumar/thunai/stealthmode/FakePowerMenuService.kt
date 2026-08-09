package com.rajkumar.thunai.stealthmode

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

class FakePowerMenuService : Service() {

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null
    
    companion object {
        const val TAG = "FakePowerMenuService"
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onCreate() {
        super.onCreate()
        
        // 🚨 EXTREME SURVIVAL MODE: Acquire aggressive WakeLock to survive hardware partial-destruction
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Thunai:ExtremeSurvivalWakeLock")
        wakeLock?.acquire()
        Log.d(TAG, "🚨 Aggressive PARTIAL_WAKE_LOCK acquired for Extreme Survival Mode.")

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        showFakePowerMenu()
    }

    private fun showFakePowerMenu() {
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )

        params.gravity = Gravity.CENTER

        // Create a simple UI dynamically
        val layout = LinearLayout(this)
        layout.orientation = LinearLayout.VERTICAL
        layout.gravity = Gravity.CENTER
        layout.setBackgroundColor(Color.parseColor("#99000000")) // Semi-transparent black background

        // Fake Power Off Button
        val powerOffBtn = TextView(this)
        powerOffBtn.text = "Power Off"
        powerOffBtn.textSize = 24f
        powerOffBtn.setTextColor(Color.WHITE)
        powerOffBtn.setPadding(50, 50, 50, 50)
        powerOffBtn.setBackgroundColor(Color.parseColor("#D32F2F")) // Red button
        
        powerOffBtn.setOnClickListener {
            Log.d(TAG, "Fake Power Off Clicked!")
            enterStealthBlackScreen(layout)
        }

        layout.addView(powerOffBtn)
        
        overlayView = layout
        windowManager.addView(overlayView, params)
    }

    private fun enterStealthBlackScreen(layout: LinearLayout) {
        // Clear all views and make it pure black
        layout.removeAllViews()
        layout.setBackgroundColor(Color.BLACK)
        
        // Hide System UI (Immersive Mode)
        layout.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN)
                
        Log.d(TAG, "Entered Pure Black Stealth Mode. Beginning background audio recording...")
        
        // Send event to React Native to start Audio Recording and Location broadcasting!
        val intent = Intent("com.rajkumar.thunai.STEALTH_ACTIVATED")
        sendBroadcast(intent)
    }

    override fun onDestroy() {
        super.onDestroy()
        overlayView?.let {
            windowManager.removeView(it)
        }
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "🚨 Aggressive PARTIAL_WAKE_LOCK released.")
            }
        }
    }
}
