import 'package:flutter/services.dart';

class SmsService {
  static const platform = MethodChannel('offline_guardian.sms');

  /// Sends a structured SMS payload. If it exceeds 160 characters (GSM-7 limit),
  /// it relies on SmsManager.divideMessage() under the hood in the Android plugin.
  Future<void> sendSosPayload({
    required String relayNumber,
    required String hmacAuth,
    required double lat,
    required double lng,
    required int batteryPct,
    required int timestampEpoch,
  }) async {
    // Compact encoding: [hmac, lat, lng, batt, ts]
    // e.g. "SOS:auth1234:12.12345:77.12345:85:167890123"
    final String payload = 'SOS:$hmacAuth:${lat.toStringAsFixed(5)}:${lng.toStringAsFixed(5)}:$batteryPct:$timestampEpoch';
    
    try {
      await platform.invokeMethod('sendMultipartSms', {
        'number': relayNumber,
        'message': payload,
      });
      print('Multipart SMS handed off to platform channel.');
    } on PlatformException catch (e) {
      print("Failed to send SMS: '${e.message}'.");
    }
  }

  /// Opens the dialer pre-filled with a SAFE TEST NUMBER (9999999999) 
  /// without requiring CALL_PHONE permission.
  Future<void> openEmergencyDialer() async {
    try {
      await platform.invokeMethod('actionDial', {'number': '9999999999'});
    } on PlatformException catch (e) {
      print("Failed to open dialer: '${e.message}'.");
    }
  }
}
