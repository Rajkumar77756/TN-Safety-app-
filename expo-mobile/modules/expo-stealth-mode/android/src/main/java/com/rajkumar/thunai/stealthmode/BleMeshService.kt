package com.rajkumar.thunai.stealthmode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.Collections
import java.util.LinkedHashSet
import java.util.UUID

class BleMeshService : Service() {

    companion object {
        const val TAG = "BleMeshService"
        const val CHANNEL_ID = "ThunaiMeshChannel"
        const val NOTIFICATION_ID = 1001
        const val MANUFACTURER_ID = 0xFFFE
        
        // 16-bit UUID (0xFD69 mapped to 128-bit Bluetooth base)
        val THUNAI_SOS_UUID: ParcelUuid = ParcelUuid(UUID.fromString("0000FD69-0000-1000-8000-00805F9B34FB"))
        
        var isRunning = false
    }

    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothLeScanner: BluetoothLeScanner? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null

    // Track payload currently being transmitted by this phone to prevent self-echo loops
    private var myOwnBroadcastPayload: ByteArray? = null
    private val seenPayloads = Collections.synchronizedSet(LinkedHashSet<Int>())
    private var isCurrentlyAdvertising = false
    private var isCurrentlyScanning = false

    override fun onCreate() {
        super.onCreate()
        ensureBleComponents()
        createNotificationChannel()
    }

    private fun ensureBleComponents(): Boolean {
        try {
            if (bluetoothAdapter == null) {
                val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                bluetoothAdapter = bluetoothManager?.adapter
            }

            if (bluetoothAdapter == null) {
                Log.e(TAG, "Bluetooth hardware not available on this device")
                return false
            }

            if (!bluetoothAdapter!!.isEnabled) {
                Log.w(TAG, "Bluetooth is currently disabled by user")
                return false
            }

            bluetoothLeScanner = bluetoothAdapter!!.bluetoothLeScanner
            bluetoothLeAdvertiser = bluetoothAdapter!!.bluetoothLeAdvertiser

            if (bluetoothLeAdvertiser == null) {
                Log.w(TAG, "BluetoothLeAdvertiser is null - device may not support BLE Peripheral advertising mode")
            }

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing BLE components", e)
            return false
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isRunning) {
            val notification = buildNotification()
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start foreground service", e)
                startForeground(NOTIFICATION_ID, notification)
            }
            isRunning = true
            startScanning()
        }
        
        val action = intent?.action
        Log.d(TAG, "onStartCommand received action: $action")
        if (action == "BROADCAST_SOS") {
            val payload = intent.getByteArrayExtra("payload")
            if (payload != null) {
                Log.d(TAG, "Received BROADCAST_SOS intent with ${payload.size} bytes")
                myOwnBroadcastPayload = payload
                startAdvertising(payload)
            } else {
                Log.e(TAG, "BROADCAST_SOS intent missing 'payload' extra")
            }
        } else if (action == "STOP_BROADCAST") {
            stopAdvertising()
            myOwnBroadcastPayload = null
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onDestroy() {
        super.onDestroy()
        stopScanning()
        stopAdvertising()
        isRunning = false
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Thunai Offline Mesh Relay",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the offline Bluetooth SOS mesh active 24/7."
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Thunai Guardian Mesh")
            .setContentText("Offline relay active. Keeping you safe 24/7.")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()
    }

    private fun startScanning() {
        if (isCurrentlyScanning) {
            Log.d(TAG, "BLE Scanner already running")
            return
        }

        if (!ensureBleComponents() || bluetoothLeScanner == null) {
            Log.e(TAG, "Cannot start BLE scanner: scanner is null or Bluetooth is disabled")
            return
        }
        
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED) // Fast & responsive (every 2-3 seconds)
            .setReportDelay(0) // Zero-latency instant callback
            .build()

        // Match all packets and filter in software to bypass vendor hardware filter bugs
        val filters = listOf(
            ScanFilter.Builder().build()
        )
            
        try {
            bluetoothLeScanner!!.startScan(filters, settings, scanCallback)
            isCurrentlyScanning = true
            Log.d(TAG, "BLE Scanner successfully started (software filtering enabled)")
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing BLUETOOTH_SCAN permission", e)
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error starting BLE scanner", e)
        }
    }

    private fun stopScanning() {
        if (!isCurrentlyScanning) return
        try {
            bluetoothLeScanner?.stopScan(scanCallback)
            isCurrentlyScanning = false
            Log.d(TAG, "BLE Scanner stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping BLE scanner", e)
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val record = result.scanRecord ?: return
            
            // Check both ServiceData (16-bit UUID) and ManufacturerData (0xFFFE)
            var data = record.getServiceData(THUNAI_SOS_UUID)
            if (data == null) {
                data = record.getManufacturerSpecificData(MANUFACTURER_ID)
            }
            
            if (data == null || data.size < 16) return

            // 1. Check if this is our own broadcast echoing back:
            if (myOwnBroadcastPayload != null && myOwnBroadcastPayload.contentEquals(data)) {
                // Silently drop our own broadcast reflection
                return
            }

            // 2. Prevent infinite relay loop: check if we recently forwarded this exact packet
            val payloadHash = data.contentHashCode()
            if (seenPayloads.contains(payloadHash)) {
                return
            }

            seenPayloads.add(payloadHash)
            if (seenPayloads.size > 200) {
                val iterator = seenPayloads.iterator()
                if (iterator.hasNext()) {
                    iterator.next()
                    iterator.remove()
                }
            }

            Log.d(TAG, ">>> RECEIVED OFFLINE SOS VIA BLE! Payload size: ${data.size} bytes. Forwarding to React Native...")
            
            // Fire event back to React Native UI
            val intent = Intent("com.rajkumar.thunai.SOS_RECEIVED").apply {
                putExtra("payload", data)
                setPackage(packageName)
            }
            sendBroadcast(intent)
            
            // Automatically Relay it along the mesh network
            startAdvertising(data)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE Scan failed with error code: $errorCode")
            isCurrentlyScanning = false
        }
    }

    private fun startAdvertising(payload: ByteArray) {
        if (!ensureBleComponents() || bluetoothLeAdvertiser == null) {
            Log.e(TAG, "Cannot advertise: bluetoothLeAdvertiser is null (device may not support BLE advertising)")
            return
        }

        // Maximum transmission power and frequency for emergency SOS
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY) // High frequency pulses (100ms)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH) // Max distance (up to 50-100m)
            .setConnectable(false)
            .setTimeout(0)
            .build()
            
        // Use ONLY addServiceData - DO NOT call addServiceUuid to avoid exceeding the 31-byte limit!
        val data = AdvertiseData.Builder()
            .addServiceData(THUNAI_SOS_UUID, payload)
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()
            
        try {
            stopAdvertising()
            bluetoothLeAdvertiser!!.startAdvertising(settings, data, advertiseCallback)
            isCurrentlyAdvertising = true
            Log.d(TAG, "BLE Advertiser started transmitting SOS payload (${payload.size} bytes) on 0xFD69")
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing BLUETOOTH_ADVERTISE permission", e)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting BLE advertising", e)
            // Fallback: Try advertising using Manufacturer Data
            tryFallbackManufacturerAdvertise(settings, payload)
        }
    }

    private fun tryFallbackManufacturerAdvertise(settings: AdvertiseSettings, payload: ByteArray) {
        try {
            val fallbackData = AdvertiseData.Builder()
                .addManufacturerData(MANUFACTURER_ID, payload)
                .setIncludeDeviceName(false)
                .setIncludeTxPowerLevel(false)
                .build()
            bluetoothLeAdvertiser?.startAdvertising(settings, fallbackData, advertiseCallback)
            isCurrentlyAdvertising = true
            Log.d(TAG, "BLE Fallback ManufacturerData advertising started successfully")
        } catch (err: Exception) {
            Log.e(TAG, "Fallback ManufacturerData advertising also failed", err)
        }
    }

    private fun stopAdvertising() {
        if (!isCurrentlyAdvertising) return
        try {
            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
            isCurrentlyAdvertising = false
            Log.d(TAG, "BLE Advertiser stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping BLE advertiser", e)
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Log.d(TAG, ">>> BLE ADVERTISING ACTIVE: SOS beacon is broadcasting in the air!")
            isCurrentlyAdvertising = true
        }

        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "BLE Advertise failed with error code: $errorCode")
            isCurrentlyAdvertising = false
            if (errorCode == AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE && myOwnBroadcastPayload != null) {
                Log.w(TAG, "Payload too large for ServiceData; retrying with ManufacturerData format...")
                val settings = AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .setConnectable(false)
                    .build()
                tryFallbackManufacturerAdvertise(settings, myOwnBroadcastPayload!!)
            }
        }
    }
}
