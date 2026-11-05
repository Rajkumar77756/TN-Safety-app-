package com.rajkumar.thunai.stealthmode

import android.accessibilityservice.AccessibilityService
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class StealthModeAccessibilityService : AccessibilityService() {

    companion object {
        const val TAG = "StealthModeService"
        var isServiceActive = false
        var isStealthModeEnabled = false
        var instance: StealthModeAccessibilityService? = null
    }

    private var overlayView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var escapeReceiver: BroadcastReceiver? = null
    private var originalVolumes: IntArray? = null
    private var originalRingerMode: Int = AudioManager.RINGER_MODE_NORMAL
    private var isBlackScreenActive = false
    private val handler = Handler(Looper.getMainLooper())

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceActive = true
        instance = this
        Log.d(TAG, "Stealth Mode Accessibility Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!isStealthModeEnabled) return

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val className = event.className?.toString() ?: ""
            val packageName = event.packageName?.toString() ?: ""

            Log.d(TAG, "Window: pkg=$packageName, cls=$className")

            // If black screen is active and the real power menu appears, kill it instantly
            if (isBlackScreenActive) {
                if (packageName == "android" || packageName == "com.android.systemui") {
                    var isPowerMenu = false
                    if (className.contains("GlobalActions") || className.contains("PowerMenu") || className.contains("ShutdownThread")) {
                        isPowerMenu = true
                    }
                    val node = event.source
                    if (node != null && !isPowerMenu) {
                        if (node.findAccessibilityNodeInfosByText("Power off").isNotEmpty() || node.findAccessibilityNodeInfosByText("Restart").isNotEmpty()) {
                            isPowerMenu = true
                        }
                    }
                    if (isPowerMenu) {
                        Log.d(TAG, "BLOCKED real power menu during stealth (Universal)!")
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
                    }
                }
                return
            }

            // Detect Android system power menu (Universal approach for all manufacturers)
            if (packageName == "android" || packageName == "com.android.systemui") {
                var isPowerMenu = false
                
                // 1. Fallback class name check (Samsung/Pixel)
                if (className.contains("GlobalActions") || className.contains("ResolverActivity") || className.contains("PowerMenu")) {
                    isPowerMenu = true
                }
                
                // 2. Universal Node Text Check (Nokia, Xiaomi, Vivo, Oppo)
                val node = event.source
                if (node != null && !isPowerMenu) {
                    val nodes = node.findAccessibilityNodeInfosByText("Power off")
                    val nodes2 = node.findAccessibilityNodeInfosByText("Restart")
                    if (nodes.isNotEmpty() || nodes2.isNotEmpty()) {
                        isPowerMenu = true
                    }
                }

                if (isPowerMenu) {
                    Log.d(TAG, "Detected Power Menu (Universal)! Triggering INSTANTLY!")
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    performGlobalAction(GLOBAL_ACTION_HOME)
                    showFakePowerMenu()
                }
            }
        }
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (!isStealthModeEnabled) return super.onKeyEvent(event)

        if (event.keyCode == KeyEvent.KEYCODE_POWER) {
            Log.d(TAG, "Power button: ${event.action}, blackScreen=$isBlackScreenActive")
            
            if (isBlackScreenActive) {
                // While in black screen, SWALLOW all power button events completely
                return true
            }
            
            if (event.action == KeyEvent.ACTION_UP && overlayView == null) {
                showFakePowerMenu()
            }
            return true
        }
        return super.onKeyEvent(event)
    }

    /**
     * Custom View that draws a power icon as a vector — no Unicode dependency.
     */
    private inner class PowerIconView(context: Context) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val radius = Math.min(cx, cy) * 0.5f

            paint.color = Color.WHITE
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = radius * 0.2f
            paint.strokeCap = Paint.Cap.ROUND

            // Arc (open at top)
            val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
            canvas.drawArc(rect, -240f, 300f, false, paint)

            // Vertical line at top
            canvas.drawLine(cx, cy - radius * 1.25f, cx, cy - radius * 0.1f, paint)
        }
    }

    private var isAwaitingConfirmation = false
    private lateinit var rootFrame: FrameLayout
    private lateinit var overlayParams: WindowManager.LayoutParams

    private fun showFakePowerMenu() {
        if (overlayView != null) return

        overlayParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )
        overlayParams.gravity = Gravity.TOP or Gravity.START
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            overlayParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        rootFrame = FrameLayout(this)
        rootFrame.setBackgroundColor(Color.parseColor("#E6000000")) // Deep translucent black
        
        // Hide navigation and status bar
        rootFrame.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)

        rootFrame.setOnClickListener {
            if (isAwaitingConfirmation) {
                // Cancel confirmation and show all buttons again
                isAwaitingConfirmation = false
                rootFrame.removeAllViews()
                buildSamsungMenu(rootFrame)
            } else {
                Log.d(TAG, "Background tapped, dismissing.")
                removeFakeOverlay()
            }
        }

        buildSamsungMenu(rootFrame)

        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        overlayView = rootFrame
        wm.addView(overlayView, overlayParams)
    }

    private fun buildSamsungMenu(rootFrame: FrameLayout) {
        val centerContainer = LinearLayout(this)
        centerContainer.orientation = LinearLayout.VERTICAL
        centerContainer.gravity = Gravity.CENTER
        centerContainer.setOnClickListener { /* block click passthrough */ }

        val centerParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        )
        centerContainer.layoutParams = centerParams

        // Samsung has 3 buttons vertically
        val powerOffBtn = createSamsungButton("Power off", Color.parseColor("#DE4339"), true)
        val restartBtn = createSamsungButton("Restart", Color.parseColor("#44B04B"), false)
        val emergencyBtn = createSamsungButton("Emergency mode", Color.parseColor("#DE4339"), false)

        centerContainer.addView(powerOffBtn)
        centerContainer.addView(restartBtn)
        centerContainer.addView(emergencyBtn)
        rootFrame.addView(centerContainer)

        // Power off click logic
        powerOffBtn.setOnClickListener {
            if (!isAwaitingConfirmation) {
                // First tap: hide other buttons and show confirmation text
                isAwaitingConfirmation = true
                centerContainer.removeAllViews()
                
                val confirmBtn = createSamsungButton("Tap again to turn off phone", Color.parseColor("#DE4339"), true)
                centerContainer.addView(confirmBtn)
                
                confirmBtn.setOnClickListener {
                    Log.d(TAG, "Power off CONFIRMED!")
                    muteAllAudio()
                    showSamsungSpinner(rootFrame)
                }
            }
        }
    }

    private fun createSamsungButton(text: String, color: Int, isPower: Boolean): View {
        val container = LinearLayout(this)
        container.orientation = LinearLayout.VERTICAL
        container.gravity = Gravity.CENTER
        container.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = 80 }

        val buttonBg = GradientDrawable()
        buttonBg.shape = GradientDrawable.OVAL
        buttonBg.setColor(color)

        val iconFrame = FrameLayout(this)
        iconFrame.background = buttonBg
        val iconSize = 180
        iconFrame.layoutParams = LinearLayout.LayoutParams(iconSize, iconSize).apply {
            gravity = Gravity.CENTER
        }

        if (isPower) {
            val powerIcon = PowerIconView(this)
            iconFrame.addView(powerIcon, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
        }

        val titleText = TextView(this).apply {
            this.text = text
            textSize = 16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 20 }
        }

        container.addView(iconFrame)
        container.addView(titleText)
        return container
    }

    private inner class SpinnerView(context: Context) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        var sweepAngle = 0f

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val radius = Math.min(cx, cy) * 0.8f

            paint.color = Color.parseColor("#007BFF") // Samsung blue
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = radius * 0.15f
            paint.strokeCap = Paint.Cap.ROUND

            val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
            canvas.drawArc(rect, -90f, sweepAngle, false, paint)
        }
    }

    private fun showSamsungSpinner(rootFrame: FrameLayout) {
        rootFrame.removeAllViews()
        rootFrame.setBackgroundColor(Color.BLACK)
        
        val spinner = SpinnerView(this)
        spinner.layoutParams = FrameLayout.LayoutParams(200, 200, Gravity.CENTER)
        rootFrame.addView(spinner)

        // Spin animation
        var angle = 0f
        val spinRunnable = object : Runnable {
            override fun run() {
                angle = (angle + 10) % 360
                spinner.sweepAngle = angle
                spinner.invalidate()
                handler.postDelayed(this, 16)
            }
        }
        handler.post(spinRunnable)

        // After 2 seconds of spinning, go pure black
        handler.postDelayed({
            handler.removeCallbacks(spinRunnable)
            enterBlackScreen(rootFrame)
        }, 2000)
    }

    private fun enterBlackScreen(rootFrame: FrameLayout) {
        rootFrame.removeAllViews()
        rootFrame.clearAnimation()
        rootFrame.setBackgroundColor(Color.BLACK)
        isBlackScreenActive = true

        // Acquire WakeLock
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Thunai:StealthLock")
        wakeLock?.acquire()

        // AGGRESSIVE touch blocker — swallow 100% of touches
        rootFrame.setOnTouchListener { _, _ -> true }
        rootFrame.setOnClickListener { /* swallow */ }

        // Remove FLAG_NOT_FOCUSABLE so we consume ALL input
        overlayParams.flags = (WindowManager.LayoutParams.FLAG_FULLSCREEN
            or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL.inv().and(0))

        try {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.updateViewLayout(rootFrame, overlayParams)
        } catch (e: Exception) {
            Log.e(TAG, "Layout update error: ${e.message}")
        }

        // Register charger escape
        escapeReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                Log.d(TAG, "Charger connected — ESCAPE!")
                removeFakeOverlay()
            }
        }
        val filter = IntentFilter(Intent.ACTION_POWER_CONNECTED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(escapeReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(escapeReceiver, filter)
        }

        // After 1.5s pure black, show "Powered by Android"
        handler.postDelayed({ showPoweredByAndroid(rootFrame) }, 1500)

        Log.d(TAG, "BLACK SCREEN ACTIVE — all input blocked.")

        // Start audio recording
        val intent = Intent("com.rajkumar.thunai.STEALTH_ACTIVATED")
        sendBroadcast(intent)
    }

    private fun showPoweredByAndroid(rootFrame: FrameLayout) {
        val bootContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setOnTouchListener { _, _ -> true }
        }

        val poweredBy = TextView(this).apply {
            text = "Powered by"
            textSize = 14f
            setTextColor(Color.parseColor("#AAAAAA"))
            gravity = Gravity.CENTER
        }

        val androidText = TextView(this).apply {
            text = "Android"
            textSize = 30f
            setTextColor(Color.parseColor("#3DDC84"))
            gravity = Gravity.CENTER
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 10 }
        }

        bootContainer.addView(poweredBy)
        bootContainer.addView(androidText)
        bootContainer.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        )

        rootFrame.addView(bootContainer)

        // Fade in
        val fadeIn = AlphaAnimation(0f, 1f)
        fadeIn.duration = 1000
        fadeIn.fillAfter = true
        bootContainer.startAnimation(fadeIn)

        // Hold 3s then fade out
        handler.postDelayed({
            val fadeOut = AlphaAnimation(1f, 0f)
            fadeOut.duration = 1000
            fadeOut.fillAfter = true
            fadeOut.setAnimationListener(object : Animation.AnimationListener {
                override fun onAnimationStart(a: Animation?) {}
                override fun onAnimationRepeat(a: Animation?) {}
                override fun onAnimationEnd(a: Animation?) {
                    handler.post { rootFrame.removeView(bootContainer) }
                }
            })
            bootContainer.startAnimation(fadeOut)
        }, 3000)
    }

    private fun muteAllAudio() {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            originalRingerMode = am.ringerMode
            val streams = intArrayOf(
                AudioManager.STREAM_MUSIC, AudioManager.STREAM_RING,
                AudioManager.STREAM_ALARM, AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM, AudioManager.STREAM_DTMF
            )
            originalVolumes = IntArray(streams.size) { am.getStreamVolume(streams[it]) }
            for (stream in streams) am.setStreamVolume(stream, 0, 0)
            am.ringerMode = AudioManager.RINGER_MODE_SILENT

            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (nm.isNotificationPolicyAccessGranted) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
                }
            } catch (e: Exception) { Log.w(TAG, "DND: ${e.message}") }

            Log.d(TAG, "ALL audio MUTED + SILENT mode.")
        } catch (e: Exception) { Log.e(TAG, "Mute error: ${e.message}") }
    }

    private fun restoreAudio() {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val streams = intArrayOf(
                AudioManager.STREAM_MUSIC, AudioManager.STREAM_RING,
                AudioManager.STREAM_ALARM, AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM, AudioManager.STREAM_DTMF
            )
            originalVolumes?.let { vols ->
                for (i in streams.indices) {
                    try { am.setStreamVolume(streams[i], vols[i], 0) } catch (e: Exception) {}
                }
            }
            am.ringerMode = originalRingerMode
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (nm.isNotificationPolicyAccessGranted) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
            } catch (e: Exception) {}
            Log.d(TAG, "Audio restored.")
        } catch (e: Exception) { Log.e(TAG, "Restore error: ${e.message}") }
    }

    private fun removeFakeOverlay() {
        overlayView?.let {
            try {
                val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
                wm.removeView(it)
            } catch (e: Exception) {}
        }
        overlayView = null
        isBlackScreenActive = false
        restoreAudio()
        escapeReceiver?.let {
            try { unregisterReceiver(it) } catch (e: Exception) {}
        }
        escapeReceiver = null
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
        Log.d(TAG, "Fake overlay REMOVED. Phone back to normal.")
    }

    fun triggerFakePowerMenu() {
        showFakePowerMenu()
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service Interrupted")
    }

    override fun onUnbind(intent: Intent?): Boolean {
        isServiceActive = false
        removeFakeOverlay()
        Log.d(TAG, "Service Unbound")
        return super.onUnbind(intent)
    }
}
