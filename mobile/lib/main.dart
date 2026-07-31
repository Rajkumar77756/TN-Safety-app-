import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'tier1_online/online_service.dart';
import 'tier2_sms/sms_service.dart';
import 'theme.dart';
import 'dart:ui'; // For ImageFilter

void main() {
  runApp(const OfflineGuardianApp());
}

class OfflineGuardianApp extends StatelessWidget {
  const OfflineGuardianApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Offline Guardian',
      theme: AppTheme.darkTheme,
      home: const MainLayoutScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class MainLayoutScreen extends StatefulWidget {
  const MainLayoutScreen({Key? key}) : super(key: key);

  @override
  State<MainLayoutScreen> createState() => _MainLayoutScreenState();
}

class _MainLayoutScreenState extends State<MainLayoutScreen> with SingleTickerProviderStateMixin {
  int _currentIndex = 0;
  
  // Services
  final OnlineService _onlineService = OnlineService(
    serverUrl: 'http://10.62.202.51:4000', 
    deviceUuid: 'device-uuid-1234'
  );
  final SmsService _smsService = SmsService();
  
  bool _isSosActive = false;
  String _statusMessage = 'All Trusted Contacts are Safe.';

  // Animation controller for the pulsing SOS button
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.15).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

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
    
    _pulseController.repeat(reverse: true);

    try {
      _onlineService.connectAndStream('incident-999');
      setState(() {
        _statusMessage = 'SOS Delivered via Tier 1 (Online)';
      });
    } catch (e) {
      setState(() {
        _statusMessage = 'Network error. Falling back to Tier 2 (SMS)...';
      });
      
      await _smsService.sendSosPayload(
        relayNumber: '9999999999',
        hmacAuth: 'auth123',
        lat: 0.0, 
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
      _statusMessage = 'All Trusted Contacts are Safe.';
    });
    _pulseController.stop();
    _pulseController.reset();
    _onlineService.disconnect();
  }

  Widget _buildEmptyFeed() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.shield_outlined, size: 80, color: AppTheme.borderDark),
          const SizedBox(height: 20),
          Text(
            _statusMessage,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 16, 
              color: _isSosActive ? AppTheme.accentRed : AppTheme.textGrey,
              fontWeight: _isSosActive ? FontWeight.bold : FontWeight.normal,
            ),
          ),
          const SizedBox(height: 10),
          if (!_isSosActive)
            const Text(
              'Your location is completely private.\nWe only broadcast when you press SOS.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: AppTheme.borderDark),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: const BoxDecoration(
                color: AppTheme.accentGreen,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: AppTheme.accentGreen, blurRadius: 10)
                ]
              ),
            ),
            const SizedBox(width: 10),
            const Text('Offline Guardian'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () {}, // Settings placeholder
          )
        ],
      ),
      
      // Main Feed (Empty by default for privacy)
      body: _buildEmptyFeed(),

      // Custom Bottom Navigation with overlapping central button
      bottomNavigationBar: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.bottomCenter,
        children: [
          // The actual navbar background
          ClipRRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: BottomNavigationBar(
                currentIndex: _currentIndex,
                onTap: (index) {
                  if (index != 2) { // Index 2 is the invisible SOS placeholder
                    setState(() => _currentIndex = index);
                  }
                },
                backgroundColor: AppTheme.cardBlack.withOpacity(0.8),
                items: const [
                  BottomNavigationBarItem(icon: Icon(Icons.home_outlined), activeIcon: Icon(Icons.home), label: 'Home'),
                  BottomNavigationBarItem(icon: Icon(Icons.people_outline), activeIcon: Icon(Icons.people), label: 'Contacts'),
                  // Invisible placeholder to make room for the floating SOS button
                  BottomNavigationBarItem(icon: Icon(Icons.warning, color: Colors.transparent), label: ''),
                  BottomNavigationBarItem(icon: Icon(Icons.map_outlined), activeIcon: Icon(Icons.map), label: 'Map'),
                  BottomNavigationBarItem(icon: Icon(Icons.person_outline), activeIcon: Icon(Icons.person), label: 'Profile'),
                ],
              ),
            ),
          ),
          
          // The massive overlapping SOS button
          Positioned(
            bottom: 20, // Elevates it above the navbar
            child: GestureDetector(
              onTap: _isSosActive ? null : _triggerSos,
              onLongPress: _cancelSos,
              child: AnimatedBuilder(
                animation: _pulseAnimation,
                builder: (context, child) {
                  return Transform.scale(
                    scale: _isSosActive ? _pulseAnimation.value : 1.0,
                    child: Container(
                      width: 70,
                      height: 70,
                      decoration: BoxDecoration(
                        color: _isSosActive ? AppTheme.flagOrange : AppTheme.accentRed,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: _isSosActive 
                              ? AppTheme.flagOrange.withOpacity(0.6) 
                              : AppTheme.accentRed.withOpacity(0.4),
                            blurRadius: _isSosActive ? 30 : 15,
                            spreadRadius: _isSosActive ? 15 : 5,
                          )
                        ],
                        border: Border.all(
                          color: Colors.white.withOpacity(0.2),
                          width: 2,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          'SOS',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1,
                            shadows: [
                              Shadow(color: Colors.black.withOpacity(0.5), blurRadius: 4)
                            ]
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
