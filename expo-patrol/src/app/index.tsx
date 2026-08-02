import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Switch, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';

const SERVER_URL = 'https://tn-safety-app-qq1f.onrender.com';
const { width, height } = Dimensions.get('window');

export default function PatrolScreen() {
  const [socket, setSocket] = useState<any>(null);
  
  // Auth State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  
  // Patrol State
  const [isOnDuty, setIsOnDuty] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  
  // Dispatch State
  const [activeSOS, setActiveSOS] = useState<{ lat: number, lng: number, incidentId: string } | null>(null);

  const locationInterval = useRef<NodeJS.Timeout | null>(null);

  // Re-establish socket when token changes
  useEffect(() => {
    if (!token) return;

    const newSocket = io(SERVER_URL, {
      extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' },
      auth: { token } // Pass the JWT securely
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to Dispatch Server securely');
    });

    newSocket.on('connect_error', (err) => {
      console.log('Socket Connection Error:', err.message);
      if (err.message === 'unauthorized_patrol') {
        Alert.alert('Access Denied', 'Your account is PENDING or REVOKED by the Admin.');
        setIsOnDuty(false);
      }
    });

    newSocket.on('dispatch_patrol', (data: any) => {
      console.log('RECEIVED DISPATCH!', data);
      setActiveSOS({ lat: data.lat, lng: data.lng, incidentId: data.incidentId });
      Alert.alert('🚨 EMERGENCY DISPATCH 🚨', 'A nearby SOS has been triggered! See map for coordinates.');
    });

    setSocket(newSocket);

    return () => newSocket.disconnect();
  }, [token]);

  const handleLogin = async () => {
    if (!phoneNumber || !badgeNumber) return Alert.alert('Error', 'Please enter phone number and badge number.');

    try {
      const res = await fetch(`${SERVER_URL}/api/patrol/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, badgeNumber })
      });
      const data = await res.json();
      
      if (res.ok) {
        setToken(data.token);
        if (data.status === 'VERIFIED') {
          setIsVerified(true);
        } else {
          Alert.alert('Account Pending', 'Your phone number is verified. Please wait for the Control Room Admin to cross-check your badge number and verify your account.');
        }
      } else {
        Alert.alert('Error', data.error);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to connect to server.');
    }
  };

  const toggleDuty = async () => {
    if (!isOnDuty) {
      // Going ON duty
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location is required to go on duty.');
        return;
      }
      
      setIsOnDuty(true);
      
      // Start background ping
      locationInterval.current = setInterval(async () => {
        let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation(loc);
        socket.emit('patrol_location_update', {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude
        });
      }, 5000); // Update every 5 seconds
      
    } else {
      // Going OFF duty
      setIsOnDuty(false);
      setActiveSOS(null);
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    }
  };

  if (!isVerified) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <View style={styles.authBox}>
          <Text style={styles.title}>PATROL LOGIN</Text>
          <Text style={styles.subtitle}>Authorized personnel only.</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Phone Number"
            placeholderTextColor="#666"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Badge Number"
            placeholderTextColor="#666"
            value={badgeNumber}
            onChangeText={setBadgeNumber}
          />
          
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginBtnText}>REQUEST ACCESS</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>OFFICER PORTAL</Text>
          <Text style={styles.badgeText}>Badge: {badgeNumber}</Text>
        </View>
        <View style={styles.toggleContainer}>
          <Text style={[styles.dutyText, isOnDuty ? styles.dutyActive : styles.dutyInactive]}>
            {isOnDuty ? 'ON DUTY' : 'OFF DUTY'}
          </Text>
          <Switch
            value={isOnDuty}
            onValueChange={toggleDuty}
            trackColor={{ false: '#333', true: '#ff4d4f' }}
            thumbColor={'#fff'}
          />
        </View>
      </View>

      <View style={styles.mapContainer}>
        {location ? (
          <MapView 
            style={styles.map}
            initialRegion={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            }}
            showsUserLocation={true}
            userInterfaceStyle="dark"
          >
            {activeSOS && (
              <>
                <Marker 
                  coordinate={{ latitude: activeSOS.lat, longitude: activeSOS.lng }}
                  pinColor="#ff4d4f"
                  title="SOS EMERGENCY"
                  description="Victim Location"
                />
                <Polyline 
                  coordinates={[
                    { latitude: location.coords.latitude, longitude: location.coords.longitude },
                    { latitude: activeSOS.lat, longitude: activeSOS.lng }
                  ]}
                  strokeColor="#00ff00"
                  strokeWidth={3}
                  lineDashPattern={[5, 5]}
                />
              </>
            )}
          </MapView>
        ) : (
          <View style={styles.noMap}>
            <Text style={styles.noMapText}>{isOnDuty ? 'Acquiring GPS Signal...' : 'Go ON DUTY to access Live Map'}</Text>
          </View>
        )}
      </View>

      {activeSOS && (
        <View style={styles.dispatchCard}>
          <Text style={styles.dispatchTitle}>🚨 ACTIVE DISPATCH 🚨</Text>
          <Text style={styles.dispatchInfo}>Incident ID: {activeSOS.incidentId.substring(0,8)}</Text>
          <Text style={styles.dispatchInfo}>Navigate immediately to the red pin.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  authContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '85%', backgroundColor: '#111', padding: 30, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 2, marginBottom: 5 },
  subtitle: { color: '#ff4d4f', fontSize: 12, marginBottom: 30, textTransform: 'uppercase' },
  input: { backgroundColor: '#000', color: '#fff', padding: 15, borderRadius: 5, marginBottom: 15, borderWidth: 1, borderColor: '#333' },
  loginBtn: { backgroundColor: '#ff4d4f', padding: 15, borderRadius: 5, alignItems: 'center', marginTop: 10 },
  loginBtnText: { color: '#fff', fontWeight: 'bold', letterSpacing: 1 },
  
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#333' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  badgeText: { color: '#888', fontSize: 12 },
  toggleContainer: { alignItems: 'flex-end' },
  dutyText: { fontSize: 10, fontWeight: 'bold', marginBottom: 5, letterSpacing: 1 },
  dutyActive: { color: '#00ff00' },
  dutyInactive: { color: '#888' },
  
  mapContainer: { flex: 1, backgroundColor: '#050505' },
  map: { width, height: height * 0.7 },
  noMap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noMapText: { color: '#666', fontSize: 16 },
  
  dispatchCard: { position: 'absolute', bottom: 30, left: 20, right: 20, backgroundColor: '#ff4d4f', padding: 20, borderRadius: 10, shadowColor: '#ff4d4f', shadowOpacity: 0.5, shadowRadius: 10 },
  dispatchTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 10, textAlign: 'center' },
  dispatchInfo: { color: '#fff', fontSize: 14, textAlign: 'center' }
});
