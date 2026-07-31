import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class OnlineService {
  IO.Socket? _socket;
  StreamSubscription<Position>? _positionStream;
  Timer? _adaptiveCadenceTimer;
  bool _isHighCadence = true;
  
  final String serverUrl;
  final String deviceUuid;

  OnlineService({required this.serverUrl, required this.deviceUuid});

  void connectAndStream(String incidentId) {
    _socket = IO.io(serverUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
    });

    _socket?.connect();
    
    _socket?.onConnect((_) {
      print('Connected to Tier 1 Socket');
      _socket?.emit('join_incident', incidentId);
      _startAdaptiveLocationStreaming(incidentId);
    });
  }

  void _startAdaptiveLocationStreaming(String incidentId) {
    // Start with high cadence (3 seconds)
    _isHighCadence = true;
    _startLocationStream(incidentId, distanceFilter: 0);

    // After 2 minutes, switch to lower cadence to save battery
    _adaptiveCadenceTimer = Timer(const Duration(minutes: 2), () {
      _isHighCadence = false;
      _positionStream?.cancel();
      // Backoff: Only emit if device moves more than 10 meters, or rely on a slower timer
      _startLocationStream(incidentId, distanceFilter: 10);
      print('Switched to low battery-saving cadence.');
    });
  }

  void _startLocationStream(String incidentId, {required int distanceFilter}) {
    final locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: distanceFilter, // 0 for continuous, >0 for movement-based
    );

    _positionStream = Geolocator.getPositionStream(locationSettings: locationSettings).listen(
      (Position? position) {
        if (position != null) {
          _socket?.emit('location_update', {
            'deviceUuid': deviceUuid,
            'incidentId': incidentId,
            'lat': position.latitude,
            'lng': position.longitude,
            'timestamp': position.timestamp?.millisecondsSinceEpoch,
            'battery': 85, // In real app, query Battery API
          });
        }
      }
    );
  }

  void disconnect() {
    _adaptiveCadenceTimer?.cancel();
    _positionStream?.cancel();
    _socket?.disconnect();
  }
}
