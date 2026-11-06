import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Switch, 
  Dimensions, Modal, Image, Animated, Easing, Vibration, Linking 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

const SERVER_URL = 'https://tn-safety-app-qq1f.onrender.com';
const { width, height } = Dimensions.get('window');

export default function PatrolScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [socket, setSocket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Auth State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [name, setName] = useState('');
  const [stationName, setStationName] = useState('');
  const [pincode, setPincode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  
  // Patrol State
  const [isOnDuty, setIsOnDuty] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  
  // Dispatch State
  const [activeSOS, setActiveSOS] = useState<{ lat: number, lng: number, incidentId: string, timestamp: string, senderProfile: any } | null>(null);
  const [claimStatus, setClaimStatus] = useState<'UNCLAIMED' | 'CLAIMED_BY_ME' | 'CLAIMED_BY_OTHER'>('UNCLAIMED');
  const [claimedByInfo, setClaimedByInfo] = useState<string>('');

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [emergencyContact, setEmergencyContact] = useState('');

  const mapRef = useRef<MapView | null>(null);
  const locationInterval = useRef<any>(null);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(100)).current;

  // Auto-load saved credentials on mount
  useEffect(() => {
    loadSavedOfficerSession();
  }, []);

  const loadSavedOfficerSession = async () => {
    try {
      const savedToken = await SecureStore.getItemAsync('patrol_jwt_token');
      const savedPhone = await SecureStore.getItemAsync('patrol_phone');
      const savedBadge = await SecureStore.getItemAsync('patrol_badge');
      const savedName = await SecureStore.getItemAsync('patrol_name');
      const savedStation = await SecureStore.getItemAsync('patrol_station');
      const savedPincode = await SecureStore.getItemAsync('patrol_pincode');

      if (savedPhone) setPhoneNumber(savedPhone);
      if (savedBadge) setBadgeNumber(savedBadge);
      if (savedName) setName(savedName);
      if (savedStation) setStationName(savedStation);
      if (savedPincode) setPincode(savedPincode);

      if (savedToken) {
        setToken(savedToken);
        // Verify token with backend
        await checkOfficerStatus(savedToken);
      }
    } catch (e) {
      console.log('Error loading saved patrol session', e);
    } finally {
      setLoading(false);
    }
  };

  const checkOfficerStatus = async (jwt: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/patrol/profile`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'VERIFIED') {
          setIsVerified(true);
          setPendingVerification(false);
          if (data.photo_base64) setPhotoBase64(data.photo_base64);
          if (data.emergency_contact) setEmergencyContact(data.emergency_contact);
        } else {
          setIsVerified(false);
          setPendingVerification(true);
        }
      } else {
        // Token expired or invalid
        setIsVerified(false);
      }
    } catch (e) {
      console.log('Failed to check officer status', e);
    }
  };

  // Pulse animation when new dispatch arrives
  useEffect(() => {
    if (activeSOS && claimStatus === 'UNCLAIMED') {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 7
      }).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) })
        ])
      ).start();

      // Strong tactical vibration alert
      Vibration.vibrate([0, 500, 200, 500, 200, 500], false);
    } else {
      pulseAnim.stopAnimation();
    }
  }, [activeSOS, claimStatus]);

  // Connect socket when token and verification are ready
  useEffect(() => {
    if (!token || !isVerified) return;

    const newSocket = io(SERVER_URL, {
      extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' },
      auth: { token }
    });
    
    newSocket.on('connect', () => {
      console.log('Patrol connected to Dispatch Server securely');
    });

    newSocket.on('connect_error', (err) => {
      console.log('Socket Connection Error:', err.message);
      if (err.message === 'unauthorized_patrol') {
        Alert.alert('Access Denied', 'Your officer account status is PENDING or REVOKED.');
        setIsOnDuty(false);
        setIsVerified(false);
      }
    });

    // Inbound Emergency Dispatch from Master Control Room or Nearby Mesh Victim
    newSocket.on('dispatch_patrol', (data: any) => {
      console.log('>>> RECEIVED EMERGENCY DISPATCH!', data);
      setActiveSOS({ 
        lat: data.lat, 
        lng: data.lng, 
        incidentId: data.incidentId, 
        timestamp: data.timestamp || new Date().toISOString(), 
        senderProfile: data.senderProfile 
      });
      setClaimStatus('UNCLAIMED');
      Alert.alert('🚨 EMERGENCY SOS DISPATCH 🚨', 'An emergency SOS was detected in your tactical sector! Tap RESPOND to claim.');
    });

    // Handle live pursuit updates as the victim moves
    newSocket.on('incident_location_updated', (data: any) => {
      setActiveSOS(prev => {
        if (prev && prev.incidentId === data.incidentId) {
          return { ...prev, lat: data.lat, lng: data.lng };
        }
        return prev;
      });
    });

    // Handle when another officer claims the dispatch
    newSocket.on('dispatch_claimed_by_officer', (data: any) => {
      setClaimStatus('CLAIMED_BY_OTHER');
      setClaimedByInfo(`CLAIMED: Officer ${data.officerName} (Badge: ${data.badgeNumber}) is responding.`);
      Vibration.cancel();
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token, isVerified]);

  // Live Pursuit auto-framing on map
  useEffect(() => {
    if (activeSOS && location && mapRef.current) {
      mapRef.current.fitToCoordinates([
        { latitude: location.coords.latitude, longitude: location.coords.longitude },
        { latitude: activeSOS.lat, longitude: activeSOS.lng }
      ], {
        edgePadding: { top: 120, right: 60, bottom: 250, left: 60 },
        animated: true
      });
    }
  }, [activeSOS?.lat, activeSOS?.lng, location?.coords.latitude, location?.coords.longitude]);

  const handleLogin = async () => {
    if (!phoneNumber || !badgeNumber || !name || !stationName || !pincode) {
      return Alert.alert('Error', 'Please fill all fields for Singapen Padai registration.');
    }

    const cleanPhone = phoneNumber.trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      return Alert.alert(
        'Invalid Phone Number',
        'Phone number must contain only numbers (10 to 15 digits). Words and letters are not accepted.'
      );
    }

    const cleanPincode = pincode.trim();
    if (!/^\d{6}$/.test(cleanPincode)) {
      return Alert.alert(
        'Invalid Pincode',
        'Station Pincode must be a 6-digit number. Words and letters are not accepted.'
      );
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/patrol/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanPhone, badgeNumber: badgeNumber.trim(), name: name.trim(), stationName: stationName.trim(), pincode: cleanPincode })
      });
      const data = await res.json();
      
      if (res.ok) {
        setToken(data.token);
        // Persist session
        await SecureStore.setItemAsync('patrol_jwt_token', data.token);
        await SecureStore.setItemAsync('patrol_phone', cleanPhone);
        await SecureStore.setItemAsync('patrol_badge', badgeNumber.trim());
        await SecureStore.setItemAsync('patrol_name', name.trim());
        await SecureStore.setItemAsync('patrol_station', stationName.trim());
        await SecureStore.setItemAsync('patrol_pincode', cleanPincode);

        if (data.status === 'VERIFIED') {
          setIsVerified(true);
          setPendingVerification(false);
          fetchProfile(data.token);
        } else {
          setPendingVerification(true);
          Alert.alert('Registration Submitted', 'Your badge has been registered. The Control Room Admin can now verify your badge in the Dashboard.');
        }
      } else {
        Alert.alert('Registration Failed', data.error || 'Server rejected registration');
      }
    } catch (e) {
      Alert.alert('Network Error', 'Failed to connect to control server.');
    }
  };

  const handleLogout = async () => {
    try {
      await SecureStore.deleteItemAsync('patrol_jwt_token');
      if (socket) socket.disconnect();
      if (locationInterval.current) clearInterval(locationInterval.current);
      setToken(null);
      setIsVerified(false);
      setIsOnDuty(false);
      setActiveSOS(null);
      setShowSettings(false);
      Alert.alert('Logged Out', 'Officer session cleared.');
    } catch (e) {
      console.log('Error logging out', e);
    }
  };

  const claimDispatch = () => {
    if (!socket || !activeSOS) return;
    socket.emit('patrol_accept_dispatch', { incidentId: activeSOS.incidentId });
    setClaimStatus('CLAIMED_BY_ME');
    Vibration.cancel();
  };

  const resolveIncident = () => {
    Alert.alert(
      'Resolve Emergency',
      'Confirm that the victim is secure and the incident is handled?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Confirm Resolved', 
          style: 'destructive',
          onPress: () => {
            setActiveSOS(null);
            setClaimStatus('UNCLAIMED');
          }
        }
      ]
    );
  };

  const fetchProfile = async (jwt: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/patrol/profile`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photo_base64) setPhotoBase64(data.photo_base64);
        if (data.emergency_contact) setEmergencyContact(data.emergency_contact);
      }
    } catch (e) {
      console.log('Failed to fetch profile', e);
    }
  };

  const saveProfile = async () => {
    let cleanContact: string | null = null;
    if (emergencyContact && emergencyContact.trim()) {
      cleanContact = emergencyContact.trim();
      if (!/^\+?[0-9]{10,15}$/.test(cleanContact)) {
        return Alert.alert(
          'Invalid Emergency Contact',
          'Emergency contact must contain only numbers (10 to 15 digits). Letters and words are not accepted.'
        );
      }
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/patrol/profile`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ photoBase64, emergencyContact: cleanContact })
      });
      if (res.ok) {
        Alert.alert('Success', 'Profile settings saved.');
        setShowSettings(false);
      } else {
        const data = await res.json();
        Alert.alert('Save Failed', data.error || 'Failed to save settings.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to save settings.');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true
    });

    if (!result.canceled && result.assets[0].base64) {
      setPhotoBase64(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const toggleDuty = async () => {
    if (!isOnDuty) {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'GPS location permission is required for patrol duty.');
        return;
      }
      
      setIsOnDuty(true);
      
      // Update location immediately
      try {
        let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation(loc);
        if (socket && socket.connected) {
          socket.emit('patrol_location_update', {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude
          });
        }
      } catch (err) {}

      // Start continuous background ping every 5 seconds
      locationInterval.current = setInterval(async () => {
        try {
          let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setLocation(loc);
          if (socket && socket.connected) {
            socket.emit('patrol_location_update', {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude
            });
          }
        } catch (e) {}
      }, 5000);
      
    } else {
      setIsOnDuty(false);
      setActiveSOS(null);
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    }
  };

  if (!isVerified) {
    return (
      <SafeAreaView style={[styles.authContainer, { backgroundColor: theme.background }]}>
        <View style={[styles.authBox, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Text style={[styles.title, { color: theme.text }]}>SINGAPEN PADAI</Text>
          <Text style={styles.subtitle}>Tactical Police Patrol Portal</Text>
          
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Officer Name"
            placeholderTextColor={theme.textSecondary}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Officer Phone Number (Digits only)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={text => setPhoneNumber(text.replace(/[^0-9+]/g, ''))}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Badge Number (e.g. TNP-4402)"
            placeholderTextColor={theme.textSecondary}
            value={badgeNumber}
            onChangeText={setBadgeNumber}
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Police Station Name"
            placeholderTextColor={theme.textSecondary}
            value={stationName}
            onChangeText={setStationName}
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Station Pincode (6 digits)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            maxLength={6}
            value={pincode}
            onChangeText={text => setPincode(text.replace(/[^0-9]/g, '').slice(0, 6))}
          />
          
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginBtnText}>REGISTER / SECURE LOGIN</Text>
          </TouchableOpacity>

          {pendingVerification && (
            <View style={styles.pendingBanner}>
              <Text style={styles.pendingText}>⏳ Status: PENDING CONTROL ROOM VERIFICATION</Text>
              <TouchableOpacity onPress={() => token && checkOfficerStatus(token)} style={styles.refreshBtn}>
                <Text style={styles.refreshBtnText}>🔄 Check Verification Status</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={() => router.push('/privacy-policy' as any)}>
            <Text style={{ color: theme.textSecondary, textDecorationLine: 'underline' }}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.backgroundSelected }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {photoBase64 ? (
            <Image source={{ uri: photoBase64 }} style={{ width: 44, height: 44, borderRadius: 22, marginRight: 10, borderWidth: 2, borderColor: '#ff4d4f' }} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: theme.backgroundSelected }]}>
              <Text style={{ fontSize: 20 }}>👮‍♀️</Text>
            </View>
          )}
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>{name || 'OFFICER PORTAL'}</Text>
            <Text style={[styles.badgeText, { color: theme.textSecondary }]}>Badge: {badgeNumber} • {stationName}</Text>
          </View>
        </View>
        <View style={styles.toggleContainer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
            <TouchableOpacity onPress={() => setShowSettings(true)} style={{ marginRight: 15 }}>
              <Text style={{ fontSize: 22 }}>⚙️</Text>
            </TouchableOpacity>
            <Text style={[styles.dutyText, isOnDuty ? styles.dutyActive : styles.dutyInactive]}>
              {isOnDuty ? 'ON DUTY' : 'OFF DUTY'}
            </Text>
          </View>
          <Switch
            value={isOnDuty}
            onValueChange={toggleDuty}
            trackColor={{ false: theme.backgroundSelected, true: '#28a745' }}
            thumbColor={'#fff'}
          />
        </View>
      </View>

      <View style={[styles.mapContainer, { backgroundColor: theme.background }]}>
        {location ? (
          <MapView 
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.03,
            }}
            showsUserLocation={true}
            userInterfaceStyle={colorScheme}
          >
            <UrlTile 
              urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
            />
            {activeSOS && (
              <>
                <Marker 
                  coordinate={{ latitude: activeSOS.lat, longitude: activeSOS.lng }}
                  pinColor="#ff4d4f"
                  title="🚨 SOS EMERGENCY"
                  description={activeSOS.senderProfile?.name || 'Victim Location'}
                />
                <Polyline 
                  coordinates={[
                    { latitude: location.coords.latitude, longitude: location.coords.longitude },
                    { latitude: activeSOS.lat, longitude: activeSOS.lng }
                  ]}
                  strokeColor="#00ff00"
                  strokeWidth={4}
                  lineDashPattern={[6, 6]}
                />
              </>
            )}
          </MapView>
        ) : (
          <View style={styles.noMap}>
            <Text style={[styles.noMapText, { color: theme.textSecondary }]}>
              {isOnDuty ? '🛰️ Acquiring Tactical GPS Signal...' : 'Toggle ON DUTY to access Live Tactical Map'}
            </Text>
          </View>
        )}
      </View>

      {/* Emergency Dispatch Card */}
      {activeSOS && (
        <Animated.View style={[
          styles.dispatchCard, 
          { backgroundColor: theme.backgroundElement, borderColor: '#ff4d4f' }, 
          { transform: [{ translateY: slideAnim }, { scale: claimStatus === 'UNCLAIMED' ? pulseAnim : 1 }] }
        ]}>
          <View style={[styles.dispatchHeader, { borderBottomColor: theme.backgroundSelected }]}>
            <Text style={styles.dispatchTitle}>🚨 EMERGENCY DISPATCH 🚨</Text>
          </View>
          
          <View style={styles.victimDetails}>
            <Text style={[styles.victimName, { color: theme.text }]}>{activeSOS.senderProfile?.name || 'Emergency Victim'}</Text>
            <Text style={[styles.victimPhone, { color: theme.textSecondary }]}>
              {activeSOS.senderProfile?.phone_number ? `Phone: ${activeSOS.senderProfile.phone_number}` : 'Offline Signal Bounced via Bluetooth Mesh'}
            </Text>
            <Text style={[styles.victimTime, { color: theme.textSecondary }]}>
              Triggered: {new Date(activeSOS.timestamp).toLocaleTimeString()}
            </Text>
          </View>

          {claimStatus === 'UNCLAIMED' && (
            <TouchableOpacity style={styles.claimBtn} onPress={claimDispatch}>
              <Text style={styles.claimBtnText}>RESPOND NOW (CLAIM DISPATCH)</Text>
            </TouchableOpacity>
          )}

          {claimStatus === 'CLAIMED_BY_ME' && (
            <View>
              <View style={styles.pursuitActive}>
                <Text style={styles.pursuitText}>🟢 YOU ARE RESPONDING</Text>
                <Text style={styles.pursuitSub}>Live Tactical Route Active</Text>
              </View>
              
              <TouchableOpacity 
                style={styles.navBtn} 
                onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${activeSOS.lat},${activeSOS.lng}`)}
              >
                <Text style={styles.navBtnText}>🧭 OPEN TURN-BY-TURN GPS NAVIGATION</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.resolveBtn} onPress={resolveIncident}>
                <Text style={styles.resolveBtnText}>✓ MARK SECURED / RESOLVED</Text>
              </TouchableOpacity>
            </View>
          )}

          {claimStatus === 'CLAIMED_BY_OTHER' && (
            <View style={[styles.claimedByOther, { backgroundColor: theme.backgroundSelected, borderColor: theme.textSecondary }]}>
              <Text style={[styles.claimedText, { color: theme.text }]}>{claimedByInfo}</Text>
              <Text style={[styles.claimedSub, { color: theme.textSecondary }]}>You may stand down or assist.</Text>
            </View>
          )}
        </Animated.View>
      )}

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>OFFICER PROFILE & SETTINGS</Text>
          
          <TouchableOpacity style={[styles.photoUpload, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]} onPress={pickImage}>
            {photoBase64 ? (
              <Image source={{ uri: photoBase64 }} style={{ width: 100, height: 100, borderRadius: 50 }} />
            ) : (
              <Text style={{ color: theme.textSecondary }}>Upload Badge Photo</Text>
            )}
          </TouchableOpacity>

          <Text style={{ color: theme.textSecondary, marginBottom: 5 }}>Emergency Contact (Partner / Station)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="E.g. +91 9876543210 (Digits only)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            value={emergencyContact}
            onChangeText={text => setEmergencyContact(text.replace(/[^0-9+]/g, ''))}
          />

          <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
            <Text style={styles.saveBtnText}>SAVE SETTINGS</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>LOGOUT / SWITCH OFFICER</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={() => router.push('/privacy-policy' as any)}>
             <Text style={{ color: theme.textSecondary, textDecorationLine: 'underline' }}>Privacy Policy</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={() => setShowSettings(false)}>
            <Text style={{ color: '#ff4d4f' }}>Close</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  authContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '88%', padding: 25, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 2, marginBottom: 5, textAlign: 'center' },
  subtitle: { color: '#ff4d4f', fontSize: 12, marginBottom: 25, textTransform: 'uppercase', textAlign: 'center', fontWeight: 'bold' },
  input: { padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, fontSize: 15 },
  loginBtn: { backgroundColor: '#ff4d4f', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  loginBtnText: { color: '#fff', fontWeight: 'bold', letterSpacing: 1 },
  pendingBanner: { marginTop: 15, padding: 12, borderRadius: 8, backgroundColor: 'rgba(255, 193, 7, 0.15)', borderWidth: 1, borderColor: '#ffc107', alignItems: 'center' },
  pendingText: { color: '#e0a800', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  refreshBtn: { marginTop: 8, padding: 8, borderRadius: 6, backgroundColor: '#ffc107' },
  refreshBtnText: { color: '#000', fontWeight: 'bold', fontSize: 12 },
  
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: 'bold' },
  badgeText: { fontSize: 12 },
  avatarPlaceholder: { width: 44, height: 44, borderRadius: 22, marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  toggleContainer: { alignItems: 'flex-end' },
  dutyText: { fontSize: 10, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 },
  dutyActive: { color: '#28a745' },
  dutyInactive: { color: '#888' },
  
  mapContainer: { flex: 1 },
  map: { width, height: height * 0.72 },
  noMap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  noMapText: { fontSize: 16, textAlign: 'center' },
  
  dispatchCard: { position: 'absolute', bottom: 25, left: 16, right: 16, padding: 18, borderRadius: 14, borderWidth: 2, shadowColor: '#ff4d4f', shadowOpacity: 0.8, shadowRadius: 15, elevation: 10 },
  dispatchHeader: { borderBottomWidth: 1, paddingBottom: 8, marginBottom: 12 },
  dispatchTitle: { color: '#ff4d4f', fontSize: 17, fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  victimDetails: { marginBottom: 12, alignItems: 'center' },
  victimName: { fontSize: 20, fontWeight: 'bold' },
  victimPhone: { fontSize: 14, marginTop: 2 },
  victimTime: { fontSize: 12, marginTop: 4 },
  claimBtn: { backgroundColor: '#ff4d4f', padding: 16, borderRadius: 8, alignItems: 'center' },
  claimBtnText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  pursuitActive: { backgroundColor: 'rgba(40, 167, 69, 0.15)', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#28a745', alignItems: 'center', marginBottom: 10 },
  pursuitText: { color: '#28a745', fontSize: 15, fontWeight: 'bold' },
  pursuitSub: { color: '#218838', fontSize: 12, marginTop: 3 },
  navBtn: { backgroundColor: '#007bff', padding: 14, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  navBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  resolveBtn: { backgroundColor: '#343a40', padding: 12, borderRadius: 8, alignItems: 'center' },
  resolveBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  claimedByOther: { padding: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  claimedText: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  claimedSub: { fontSize: 12, marginTop: 4 },

  modalContainer: { flex: 1, padding: 20 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 25, textAlign: 'center' },
  photoUpload: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 25 },
  saveBtn: { backgroundColor: '#28a745', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#dc3545', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  logoutBtnText: { color: '#fff', fontWeight: 'bold' }
});
