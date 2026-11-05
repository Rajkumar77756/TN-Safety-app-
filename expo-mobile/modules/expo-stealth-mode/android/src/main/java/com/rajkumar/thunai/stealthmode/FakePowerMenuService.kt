package com.rajkumar.thunai.stealthmode

import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class FakePowerMenuService : Service() {

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var escapeReceiver: BroadcastReceiver? = null
    private var originalVolumes: IntArray? = null
    private var originalRingerMode: Int = AudioManager.RINGER_MODE_NORMAL
    
    companion object {
        const val TAG = "FakePowerMenuService"
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onCreate() {
        super.onCreate()
        
        // Acquire WakeLock
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Thunai:StealthWakeLock")
        wakeLock?.acquire()
        Log.d(TAG, "WakeLock acquired for Stealth Mode.")

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        
        // Register Escape Receiver — ONLY charger plug-in
        escapeReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                Log.d(TAG, "Charger connected! Escape triggered.")
                stopSelf()
            }
        }
        val filter = IntentFilter()
        filter.addAction(Intent.ACTION_POWER_CONNECTED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(escapeReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(escapeReceiver, filter)
        }

        showFakePowerMenu()
    }

    /**
     * Custom View that draws the power icon as a vector (circle with a line at the top).
     * This avoids relying on Unicode symbols that may not render on all phones.
     */
    private inner class PowerIconView(context: Context) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val radius = Math.min(cx, cy) * 0.55f

            // Draw the circle arc (open at the top)
            paint.color = Color.WHITE
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = radius * 0.22f
            paint.strokeCap = Paint.Cap.ROUND

            val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
            canvas.drawArc(rect, -240f, 300f, false, paint)

            // Draw the vertical line at the top
            paint.style = Paint.Style.STROKE
            canvas.drawLine(cx, cy - radius * 1.3f, cx, cy, paint)
        }
    }

    private fun showFakePowerMenu() {
        // Use FLAG_LAYOUT_NO_LIMITS to extend beyond status bar and nav bar
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
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        // Force the window to cover status bar and nav bar
        params.x = 0
        params.y = 0

        // Root FrameLayout to cover entire screen
        val rootFrame = FrameLayout(this)
        rootFrame.setBackgroundColor(Color.parseColor("#CC000000")) // Dark translucent

        // Dismiss on background tap — returns user to normal screen
        rootFrame.setOnClickListener {
            Log.d(TAG, "Background tapped, dismissing.")
            stopSelf()
        }

        // Center container for the power button
        val centerContainer = LinearLayout(this)
        centerContainer.orientation = LinearLayout.VERTICAL
        centerContainer.gravity = Gravity.CENTER
        centerContainer.setOnClickListener { /* block click passthrough */ }

        val centerParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        )
        centerContainer.layoutParams = centerParams

        // Red Rounded Square Button
        val buttonBg = GradientDrawable()
        buttonBg.shape = GradientDrawable.RECTANGLE
        buttonBg.cornerRadius = 40f
        buttonBg.setColor(Color.parseColor("#E53935"))

        val iconFrame = FrameLayout(this)
        iconFrame.background = buttonBg
        val iconSize = 200
        val iconFrameParams = LinearLayout.LayoutParams(iconSize, iconSize)
        iconFrameParams.gravity = Gravity.CENTER
        iconFrame.layoutParams = iconFrameParams

        // Custom drawn power icon (no Unicode dependency)
        val powerIcon = PowerIconView(this)
        iconFrame.addView(powerIcon, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val titleText = TextView(this)
        titleText.text = "Power off"
        titleText.textSize = 18f
        titleText.setTextColor(Color.WHITE)
        titleText.gravity = Gravity.CENTER
        val titleParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        titleParams.topMargin = 30
        titleText.layoutParams = titleParams

        val subText = TextView(this)
        subText.text = "Tap button to turn off device"
        subText.textSize = 13f
        subText.setTextColor(Color.parseColor("#AAAAAA"))
        subText.gravity = Gravity.CENTER
        val subParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        subParams.topMargin = 8
        subText.layoutParams = subParams

        centerContainer.addView(iconFrame)
        centerContainer.addView(titleText)
        centerContainer.addView(subText)

        rootFrame.addView(centerContainer)

        // CLICK HANDLER — Tap the red button to "shut down"
        iconFrame.setOnClickListener {
            Log.d(TAG, "Power off tapped! Starting shutdown sequence...")
            
            // 1. Immediately mute ALL audio and set phone to silent
            muteAllAudio()
            
            // 2. Fade entire screen to black
            val fadeOut = AlphaAnimation(1f, 0f)
            fadeOut.duration = 800
            fadeOut.fillAfter = true
            fadeOut.setAnimationListener(object : Animation.AnimationListener {
                override fun onAnimationStart(a: Animation?) {}
                override fun onAnimationRepeat(a: Animation?) {}
                override fun onAnimationEnd(a: Animation?) {
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        enterStealthBlackScreen(rootFrame, params)
                    }
                }
            })
            centerContainer.startAnimation(fadeOut)
        }

        overlayView = rootFrame
        windowManager.addView(overlayView, params)
    }

    private fun muteAllAudio() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            
            // Save original volumes so we can restore on exit
            originalRingerMode = audioManager.ringerMode
            val streams = intArrayOf(
                AudioManager.STREAM_MUSIC,
                AudioManager.STREAM_RING,
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM,
                AudioManager.STREAM_DTMF
            )
            originalVolumes = IntArray(streams.size) { audioManager.getStreamVolume(streams[it]) }

            // Mute everything
            for (stream in streams) {
                audioManager.setStreamVolume(stream, 0, 0)
            }
            audioManager.ringerMode = AudioManager.RINGER_MODE_SILENT
            
            // Enable Do Not Disturb if we have permission
            try {
                val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (notificationManager.isNotificationPolicyAccessGranted) {
                    notificationManager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not set DND: ${e.message}")
            }

            Log.d(TAG, "All audio streams muted. Phone set to SILENT mode.")
        } catch (e: Exception) {
            Log.e(TAG, "Error muting audio: ${e.message}")
        }
    }

    private fun restoreAudio() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val streams = intArrayOf(
                AudioManager.STREAM_MUSIC,
                AudioManager.STREAM_RING,
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM,
                AudioManager.STREAM_DTMF
            )
            originalVolumes?.let { vols ->
                for (i in streams.indices) {
                    try {
                        audioManager.setStreamVolume(streams[i], vols[i], 0)
                    } catch (e: Exception) { /* ignore */ }
                }
            }
            audioManager.ringerMode = originalRingerMode
            
            try {
                val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (notificationManager.isNotificationPolicyAccessGranted) {
                    notificationManager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
            } catch (e: Exception) { /* ignore */ }

            Log.d(TAG, "Audio volumes restored.")
        } catch (e: Exception) {
            Log.e(TAG, "Error restoring audio: ${e.message}")
        }
    }

    private fun enterStealthBlackScreen(rootFrame: FrameLayout, params: WindowManager.LayoutParams) {
        // Clear the menu views
        rootFrame.removeAllViews()
        rootFrame.clearAnimation()
        rootFrame.setBackgroundColor(Color.BLACK)

        // Aggressive touch interceptor — swallow EVERYTHING
        rootFrame.setOnTouchListener { _, _ -> true }
        rootFrame.setOnClickListener { /* swallow */ }

        // Update window flags: remove NOT_FOCUSABLE so we consume ALL input
        params.flags = (WindowManager.LayoutParams.FLAG_FULLSCREEN
            or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv() // ensure touchable
            )
        // Force window to cover from very top to very bottom
        params.x = 0
        params.y = 0

        try {
            windowManager.updateViewLayout(rootFrame, params)
        } catch (e: Exception) {
            Log.e(TAG, "Error updating layout: ${e.message}")
        }

        // After 1.5 seconds of pure black, show "Powered by Android" animation
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            showPoweredByAndroid(rootFrame)
        }, 1500)

        Log.d(TAG, "Entered PURE BLACK Stealth Mode.")
        
        // Send broadcast to start audio recording
        val intent = Intent("com.rajkumar.thunai.STEALTH_ACTIVATED")
        sendBroadcast(intent)
    }

    private fun showPoweredByAndroid(rootFrame: FrameLayout) {
        val bootContainer = LinearLayout(this)
        bootContainer.orientation = LinearLayout.VERTICAL
        bootContainer.gravity = Gravity.CENTER
        bootContainer.setBackgroundColor(Color.BLACK)

        // "Powered by" text (small, white)
        val poweredBy = TextView(this)
        poweredBy.text = "Powered by"
        poweredBy.textSize = 14f
        poweredBy.setTextColor(Color.parseColor("#AAAAAA"))
        poweredBy.gravity = Gravity.CENTER

        // "Android" logo text (big, green, bold)
        val androidText = TextView(this)
        androidText.text = "Android"
        androidText.textSize = 30f
        androidText.setTextColor(Color.parseColor("#3DDC84")) // Official Android Green
        androidText.gravity = Gravity.CENTER
        androidText.setTypeface(null, android.graphics.Typeface.BOLD)
        val androidParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        androidParams.topMargin = 10
        androidText.layoutParams = androidParams

        bootContainer.addView(poweredBy)
        bootContainer.addView(androidText)

        val bootLayoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        )
        bootContainer.layoutParams = bootLayoutParams

        // Block all touch on this container too
        bootContainer.setOnTouchListener { _, _ -> true }

        rootFrame.addView(bootContainer)

        // Fade IN the boot animation
        val fadeIn = AlphaAnimation(0f, 1f)
        fadeIn.duration = 1000
        fadeIn.fillAfter = true
        bootContainer.startAnimation(fadeIn)

        // After 3 seconds, fade out and return to pure black
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            val fadeOut = AlphaAnimation(1f, 0f)
            fadeOut.duration = 1000
            fadeOut.fillAfter = true
            fadeOut.setAnimationListener(object : Animation.AnimationListener {
                override fun onAnimationStart(a: Animation?) {}
                override fun onAnimationRepeat(a: Animation?) {}
                override fun onAnimationEnd(a: Animation?) {
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        rootFrame.removeView(bootContainer)
                    }
                }
            })
            bootContainer.startAnimation(fadeOut)
        }, 3000)
    }

    override fun onDestroy() {
        super.onDestroy()
        overlayView?.let {
            try {
                windowManager.removeView(it)
            } catch (e: Exception) { /* already removed */ }
        }
        escapeReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: Exception) { /* already unregistered */ }
        }
        // Restore audio on exit
        restoreAudio()
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released.")
            }
        }
    }
}
