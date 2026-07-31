import 'package:flutter/material.dart';
import 'tier1_online/online_service.dart';
import 'tier2_sms/sms_service.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  runApp(const OfflineGuardianApp());
}

class OfflineGuardianApp extends StatelessWidget {
  const OfflineGuardianApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Offline Guardian',
      theme: ThemeData.dark().copyWith(
        primaryColor: Colors.red,
        scaffoldBackgroundColor: const Color(0xFF111111),
      ),
      home: const SosHomeScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class SosHomeScreen extends StatefulWidget {
  const SosHomeScreen({Key? key}) : super(key: key);

  @override
  State<SosHomeScreen> createState() => _SosHomeScreenState();
}

class _SosHomeScreenState extends State<SosHomeScreen> {
  // Pass required parameters to OnlineService
  final OnlineService _onlineService = OnlineService(
    serverUrl: 'http://10.62.202.51:4000', 
    deviceUuid: 'device-uuid-1234'
  );
  final SmsService _smsService = SmsService();
  
  bool _isSosActive = false;
  String _statusMessage = 'System Ready';

  Future<void> _requestPermissions() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
  }

  void _triggerSos() async {
    await _requestPermissions();

    setState(() {
      _isSosActive = true;
      _statusMessage = 'SOS TRIGGERED!\nBroadcasting to Master Control...';
    });

    // 1. Attempt Tier 1 (Wi-Fi/Data)
    try {
      _onlineService.connectAndStream('incident-999');
      setState(() {
        _statusMessage = 'SOS Delivered via Tier 1 (Online)';
      });
    } catch (e) {
      // 2. Fallback to Tier 2 (SMS) if Tier 1 fails
      setState(() {
        _statusMessage = 'Network error. Falling back to Tier 2 (SMS)...';
      });
      
      await _smsService.sendSosPayload(
        relayNumber: '9999999999',
        hmacAuth: 'auth123',
        lat: 0.0, // Should be fetched from Geolocator in real app
        lng: 0.0,
        batteryPct: 85,
        timestampEpoch: DateTime.now().millisecondsSinceEpoch
      );
      await _smsService.openEmergencyDialer();
    }
  }

  void _cancelSos() {
    setState(() {
      _isSosActive = false;
      _statusMessage = 'System Ready';
    });
    _onlineService.disconnect();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline Guardian'),
        backgroundColor: Colors.black,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            GestureDetector(
              onTap: _isSosActive ? null : _triggerSos,
              onLongPress: _cancelSos,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                width: 200,
                height: 200,
                decoration: BoxDecoration(
                  color: _isSosActive ? Colors.orange : Colors.red,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: _isSosActive ? Colors.orange.withOpacity(0.5) : Colors.red.withOpacity(0.5),
                      blurRadius: _isSosActive ? 50 : 20,
                      spreadRadius: _isSosActive ? 20 : 5,
                    )
                  ],
                ),
                child: Center(
                  child: Text(
                    _isSosActive ? 'ACTIVE\n(Hold to Cancel)' : 'SOS',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 50),
            Text(
              _statusMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
