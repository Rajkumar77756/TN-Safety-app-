import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Image, Dimensions, Vibration, Modal, TextInput, KeyboardAvoidingView, Platform, Appearance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing 
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { startBackgroundRelayScanner, startOfflineSosBroadcast, stopOfflineSosBroadcast, requestBluetoothPermissions } from './BleManager';
import { requireNativeModule, EventEmitter as ExpoEventEmitter } from 'expo-modules-core';
import StealthSettings from './StealthSettings';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

const { width } = Dimensions.get('window');
export const SERVER_URL = 'https://tn-safety-app-qq1f.onrender.com';

interface Contact {
  id: string;
  name: string;
  phone: string;
  image: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const [socket, setSocket] = useState<any>(null);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationSub, setLocationSub] = useState<Location.LocationSubscription | null>(null);
  const [deviceId] = useState(`user_${Math.floor(Math.random() * 10000)}`);

  // Contacts State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Onboarding Identity Gate State
  const [isProfileComplete, setIsProfileComplete] = useState<boolean | null>(null);
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingPhone, setOnboardingPhone] = useState('');
  const [onboardingAge, setOnboardingAge] = useState('');
  const [onboardingAddress, setOnboardingAddress] = useState('');
  const [onboardingWorkplace, setOnboardingWorkplace] = useState('');
  const [onboardingContactName, setOnboardingContactName] = useState('');
  const [onboardingContactPhone, setOnboardingContactPhone] = useState('');

  // New Profile & Settings State
  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [isProfileModalVisible, setIsProfileModalVisible] = useState(false);
  const [userProfileData, setUserProfileData] = useState<any>(null);
  const [sosHistory, setSosHistory] = useState<any[]>([]);

  // Pulse animation values
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);
  const buttonScale = useSharedValue(1);

  const [incomingSOS, setIncomingSOS] = useState<any>(null);

  const systemColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useState(systemColorScheme ?? 'light');

  useEffect(() => {
    const subscription = Appearance.addChangeListener((preferences) => {
      setColorScheme(preferences.colorScheme ?? 'light');
    });
    return () => subscription.remove();
  }, []);

  const theme = Colors[colorScheme];

  useEffect(() => {
    const checkConsentAndProfile = async () => {
      try {
        const consent = await SecureStore.getItemAsync('dpdp_consent');
        if (!consent) {
          router.replace('/ConsentScreen');
          return;
        }

        const storedName = await SecureStore.getItemAsync('user_name');
        const storedPhone = await SecureStore.getItemAsync('user_phone');
        const storedAddress = await SecureStore.getItemAsync('user_address');
        const storedContacts = await SecureStore.getItemAsync('trusted_contacts');
        let contactsList: Contact[] = [];
        if (storedContacts) {
          try { contactsList = JSON.parse(storedContacts); } catch (e) {}
        }

        if (storedName && storedPhone && /^\+?[0-9]{10,15}$/.test(storedPhone) && storedAddress && contactsList.length > 0) {
          setIsProfileComplete(true);
        } else {
          setIsProfileComplete(false);
        }
      } catch (e) {
        console.error('Error checking profile completion', e);
        setIsProfileComplete(false);
      }
    };
    checkConsentAndProfile();
  }, []);

  useEffect(() => {
    let newSocket: any;
    const initSocket = async () => {
      await loadContacts();
      const phone = await SecureStore.getItemAsync('user_phone');
      
      newSocket = io(SERVER_URL, {
        extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' },
        auth: phone ? { civilianPhone: phone } : {}
      });
      
      newSocket.on('connect', () => console.log('Connected to server'));
      
      // Peer-to-Peer SOS Alert Listener
      newSocket.on('trusted_sos_alert', (payload: any) => {
        setIncomingSOS(payload);
        // High intensity haptic vibration to wake user
        Vibration.vibrate([0, 500, 200, 500, 200, 500], true);
      });

      setSocket(newSocket);
    };

    const setupBle = async () => {
      const hasPermission = await requestBluetoothPermissions();
      if (hasPermission) {
        // Start listening for Mesh SOS broadcasts from victims around you
        startBackgroundRelayScanner(SERVER_URL);
      } else {
        console.warn('Bluetooth permissions denied, cannot run mesh scanner.');
      }
    };

    initSocket();
    setupBle();

    // === BLE MESH RELAY-TO-SERVER BRIDGE ===
    // When this phone's BLE scanner picks up an SOS from a nearby victim,
    // forward the encrypted payload to the backend server immediately.
    let stealthModule: any = null;
    let relaySubscription: any = null;
    try {
      stealthModule = requireNativeModule('ExpoStealthMode');
      const emitter: any = new ExpoEventEmitter(stealthModule);
      relaySubscription = emitter.addListener('onSosRelayReceived', async (event: any) => {
        console.log('[BLE RELAY] Received SOS from nearby victim! Forwarding to server...');
        const relayBody = {
          relayDeviceId: deviceId,
          encryptedPayload: event.payloadBase64,
          relayTimestamp: new Date().toISOString()
        };

        // 1. Dual delivery: WebSocket
        if (newSocket && newSocket.connected) {
          newSocket.emit('mesh-relay', relayBody);
          console.log('[BLE RELAY] Forwarded via WebSocket!');
        }

        // 2. Dual delivery: HTTP POST fallback
        try {
          const res = await fetch(`${SERVER_URL}/api/mesh/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(relayBody)
          });
          if (res.ok) {
            console.log('[BLE RELAY] Forwarded via HTTP POST successfully!');
          }
        } catch (fetchErr) {
          console.warn('[BLE RELAY] HTTP POST forward error (offline or unreachable):', fetchErr);
        }
      });
    } catch (e) {
      console.warn('[BLE RELAY] Native module not available for relay listening', e);
    }

    return () => {
      if (newSocket) newSocket.disconnect();
      if (relaySubscription) relaySubscription.remove();
      Vibration.cancel();
    };
  }, []);

  const loadContacts = async () => {
    try {
      const savedContacts = await SecureStore.getItemAsync('trusted_contacts');
      if (savedContacts) {
        setContacts(JSON.parse(savedContacts));
      }

      // Load Profile Data
      const name = await SecureStore.getItemAsync('user_name');
      const phone = await SecureStore.getItemAsync('user_phone');
      const age = await SecureStore.getItemAsync('user_age');
      const address = await SecureStore.getItemAsync('user_address');
      const photo = await SecureStore.getItemAsync('user_photo_base64');
      setUserProfileData({ name, phone, age, address, photo });

      // Load SOS History
      const historyStr = await SecureStore.getItemAsync('sos_history');
      if (historyStr) setSosHistory(JSON.parse(historyStr));
    } catch (e) {
      console.error('Failed to load contacts or profile data', e);
    }
  };

  const handleSaveOnboardingProfile = async () => {
    if (!onboardingName.trim() || !onboardingPhone.trim() || !onboardingAddress.trim() || !onboardingContactName.trim() || !onboardingContactPhone.trim()) {
      alert('Please fill in all required fields (Name, Phone, Address, and Emergency Contact) before continuing.');
      return;
    }

    const cleanUserPhone = onboardingPhone.trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleanUserPhone)) {
      alert('Invalid Phone Number: Phone number must contain only numbers (10 to 15 digits). Letters and words are not accepted.');
      return;
    }

    let parsedAge: number | null = null;
    if (onboardingAge.trim()) {
      const num = Number(onboardingAge.trim());
      if (!Number.isInteger(num) || num < 1 || num > 120) {
        alert('Invalid Age: Age must be a number between 1 and 120. Letters and words are not accepted.');
        return;
      }
      parsedAge = num;
    }

    const cleanContactPhone = onboardingContactPhone.trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleanContactPhone)) {
      alert('Invalid Contact Phone: Emergency contact phone must contain only numbers (10 to 15 digits). Letters and words are not accepted.');
      return;
    }

    try {
      // 1. Save user identity locally
      await SecureStore.setItemAsync('user_name', onboardingName.trim());
      await SecureStore.setItemAsync('user_phone', cleanUserPhone);
      if (parsedAge !== null) {
        await SecureStore.setItemAsync('user_age', String(parsedAge));
      }
      await SecureStore.setItemAsync('user_address', onboardingAddress.trim());
      if (onboardingWorkplace.trim()) {
        await SecureStore.setItemAsync('user_workplace', onboardingWorkplace.trim());
      }

      // 2. Save primary trusted emergency contact
      const initialContact: Contact = {
        id: Date.now().toString(),
        name: onboardingContactName.trim(),
        phone: cleanContactPhone,
        image: `https://ui-avatars.com/api/?name=${encodeURIComponent(onboardingContactName.trim())}&background=random`
      };
      const initialContactsList = [initialContact];
      await SecureStore.setItemAsync('trusted_contacts', JSON.stringify(initialContactsList));
      setContacts(initialContactsList);

      // 3. Mark profile completed
      await SecureStore.setItemAsync('user_profile_completed', 'true');

      setUserProfileData({
        name: onboardingName.trim(),
        phone: cleanUserPhone,
        age: parsedAge,
        address: onboardingAddress.trim(),
        photo: null
      });

      // 4. Sync profile to backend
      fetch(`${SERVER_URL}/api/civilian/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: cleanUserPhone,
          name: onboardingName.trim(),
          age: parsedAge,
          currentAddress: onboardingAddress.trim(),
          workplaceDetails: onboardingWorkplace.trim() || null,
          photoBase64: null
        })
      }).catch(err => console.log('Backend sync delayed:', err));

      // 5. Connect socket with verified phone
      if (socket) {
        socket.auth = { civilianPhone: cleanUserPhone };
        socket.connect();
      }

      // 6. Transition to SOS page!
      setIsProfileComplete(true);
      alert('Identity verified and saved. Your SOS button is now active and protected.');
    } catch (e) {
      console.error('Failed to save profile during onboarding', e);
      alert('Failed to save profile. Please try again.');
    }
  };

  const saveContact = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      alert('Please enter both name and phone number for the contact.');
      return;
    }
    
    const cleanPhone = newPhone.trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      alert('Invalid phone number: Must contain only numbers (10 to 15 digits). Letters and words are not accepted.');
      return;
    }

    const newContact: Contact = {
      id: Date.now().toString(),
      name: newName.trim(),
      phone: cleanPhone,
      image: `https://ui-avatars.com/api/?name=${encodeURIComponent(newName.trim())}&background=random`
    };

    const updatedContacts = [...contacts, newContact];
    try {
      await SecureStore.setItemAsync('trusted_contacts', JSON.stringify(updatedContacts));
      setContacts(updatedContacts);
      setIsModalVisible(false);
      setNewName('');
      setNewPhone('');
    } catch (e) {
      console.error('Failed to save contact', e);
    }
  };

  // Pulse effect when alert is active
  useEffect(() => {
    if (isAlertActive) {
      pulseScale.value = withRepeat(
        withTiming(2, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1, false
      );
      pulseOpacity.value = withRepeat(
        withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1, false
      );
    } else {
      pulseScale.value = 1;
      pulseOpacity.value = 0.5;
    }
  }, [isAlertActive]);

  const animatedPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const triggerSOS = async () => {
    if (isAlertActive) return; // Prevent multiple triggers

    buttonScale.value = withSequence(
      withTiming(0.9, { duration: 100 }),
      withTiming(1, { duration: 100 })
    );

    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access location was denied');
        return;
      }

      setIsAlertActive(true);
      
      // Silent Haptic Feedback (Two quick pulses)
      Vibration.vibrate([0, 100, 100, 100]);

      const phone = await SecureStore.getItemAsync('user_phone');
      const trustedPhoneNumbers = contacts.map(c => c.phone);

      // 1. INSTANT SOS FIRED: Get Last Known Location for zero-latency dispatch
      let initialLoc = await Location.getLastKnownPositionAsync();
      if (!initialLoc) {
        // Fallback: request low-accuracy quick fix if no last known location exists
        initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      }

      const emitSosPayload = (loc: Location.LocationObject) => {
        if (socket && socket.connected) {
          socket.emit('sos-alert', {
            userId: deviceId,
            senderPhone: phone || null,
            trustedContacts: trustedPhoneNumbers,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            timestamp: new Date().toISOString()
          });
          
          // VERIFY NETWORK STATE BEFORE MEDIA STREAMING
          // Since socket is connected, internet is available.
          console.log("Internet confirmed: Starting Live Audio/Video streaming...");
          // startMediaStreams();
          
        } else {
          // OFFLINE MESH FALLBACK: Broadcast via Bluetooth LE
          console.log("No internet: Using offline BLE broadcast, media streaming disabled.");
          startOfflineSosBroadcast({
            userId: deviceId,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            senderPhone: phone || null
          });
        }
      };

      // Fire immediately!
      emitSosPayload(initialLoc);

      // Save History locally instantly
      try {
        const newSOSLog = {
          timestamp: new Date().toISOString(),
          latitude: initialLoc.coords.latitude,
          longitude: initialLoc.coords.longitude
        };
        const updatedHistory = [newSOSLog, ...sosHistory];
        setSosHistory(updatedHistory);
        await SecureStore.setItemAsync('sos_history', JSON.stringify(updatedHistory));
      } catch(e) {
        console.log("Failed to log history", e);
      }

      // 2. Start continuous live tracking to update the dispatch dashboard as the victim moves
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (newLocation) => {
          emitSosPayload(newLocation);
        }
      );
      
      setLocationSub(sub);

    } catch (error) {
      console.error('Error fetching location:', error);
      setIsAlertActive(false);
    }
  };

  const disarmSOS = () => {
    if (!isAlertActive) return;
    Vibration.vibrate(100); // Small haptic to confirm disarm
    setIsAlertActive(false);
    
    
    if (locationSub) {
      locationSub.remove();
      setLocationSub(null);
    }
    
    stopOfflineSosBroadcast();

    if (socket) {
      socket.emit('cancel-sos', { userId: deviceId });
    }
  };

  if (isProfileComplete === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="shield-checkmark" size={64} color="#ff0050" />
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold', marginTop: 15 }}>Thunai Emergency Guardian</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 5 }}>Securing local encryption...</Text>
      </SafeAreaView>
    );
  }

  if (!isProfileComplete) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={{ alignItems: 'center', marginBottom: 24, marginTop: 10 }}>
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255, 0, 80, 0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Ionicons name="shield-checkmark" size={38} color="#ff0050" />
              </View>
              <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' }}>
                Emergency Identity Setup
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 10 }}>
                For your safety, the SOS emergency button is unlocked only after registering your verified details and emergency contact.
              </Text>
            </View>

            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Full Name *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="Your Full Name"
                placeholderTextColor={theme.textSecondary}
                value={onboardingName}
                onChangeText={setOnboardingName}
              />
            </View>

            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Phone Number * (Numbers Only)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="e.g. 9876543210 (10-15 digits)"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                value={onboardingPhone}
                onChangeText={text => setOnboardingPhone(text.replace(/[^0-9+]/g, ''))}
                autoCapitalize="none"
              />
            </View>

            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Age * (Numbers Only)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="e.g. 24"
                placeholderTextColor={theme.textSecondary}
                keyboardType="numeric"
                maxLength={3}
                value={onboardingAge}
                onChangeText={text => setOnboardingAge(text.replace(/[^0-9]/g, ''))}
              />
            </View>

            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Residential Address *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected, minHeight: 65 }]}
                placeholder="Full address (helps police & ambulance reach you)"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={2}
                value={onboardingAddress}
                onChangeText={setOnboardingAddress}
              />
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Workplace / Daily Route (Optional)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="e.g. Tidel Park / Anna University"
                placeholderTextColor={theme.textSecondary}
                value={onboardingWorkplace}
                onChangeText={setOnboardingWorkplace}
              />
            </View>

            <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.backgroundSelected, marginBottom: 24 }}>
              <Text style={{ color: '#ff0050', fontSize: 14, fontWeight: 'bold', marginBottom: 12 }}>
                🚨 Primary Trusted Emergency Contact
              </Text>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Contact Name *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="e.g. Mom / Dad / Sister / Friend"
                placeholderTextColor={theme.textSecondary}
                value={onboardingContactName}
                onChangeText={setOnboardingContactName}
              />
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Contact Phone Number * (Numbers Only)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
                placeholder="e.g. 9876543210 (10-15 digits)"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                value={onboardingContactPhone}
                onChangeText={text => setOnboardingContactPhone(text.replace(/[^0-9+]/g, ''))}
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity 
              style={[styles.saveBtn, { marginLeft: 0, paddingVertical: 18, borderRadius: 12, shadowColor: '#ff0050', shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 }]} 
              onPress={handleSaveOnboardingProfile}
            >
              <Text style={[styles.saveBtnText, { fontSize: 16, letterSpacing: 1 }]}>SAVE DETAILS & ACTIVATE SOS</Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center', marginTop: 24 }}>
              <TouchableOpacity onPress={() => router.push('/privacy-policy')}>
                <Text style={{ color: theme.textSecondary, fontSize: 13, textDecorationLine: 'underline' }}>Privacy Policy & DPDP Data Protection</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Top Header */}
        <View style={styles.header}>
          <Text style={[styles.logoText, { color: theme.text }]}>Thunai</Text>
          <View style={styles.headerIcons}>
            <TouchableOpacity onPress={() => setIsProfileModalVisible(true)} style={styles.iconBtn}>
              <Ionicons name="person-circle-outline" size={32} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsSettingsModalVisible(true)} style={styles.iconBtn}>
              <Ionicons name="settings-outline" size={28} color={theme.text} />
            </TouchableOpacity>
          </View>
        </View>

      {/* Instagram-style "Stories" Row (Trusted Contacts) */}
      <View style={[styles.storiesContainer, { borderBottomColor: theme.backgroundSelected }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesScroll}>
          {/* Add New Contact Button */}
          <TouchableOpacity style={styles.storyWrapper} onPress={() => setIsModalVisible(true)}>
            <View style={[styles.storyRing, { borderColor: theme.backgroundSelected }]}>
              <View style={[styles.addIconContainer, { backgroundColor: theme.backgroundElement }]}>
                <Text style={[styles.addIcon, { color: theme.text }]}>+</Text>
              </View>
            </View>
            <Text style={[styles.storyName, { color: theme.textSecondary }]}>Add Contact</Text>
          </TouchableOpacity>

          {/* Trusted Contacts */}
          {contacts.map(contact => (
            <View key={contact.id} style={styles.storyWrapper}>
              <View style={[styles.storyRing, { borderColor: '#ff0050' }]}>
                <Image source={{ uri: contact.image }} style={styles.storyImage} />
              </View>
              <Text style={[styles.storyName, { color: theme.textSecondary }]}>{contact.name}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Center Feed (SOS Button) */}
      <View style={styles.feedContainer}>
        <View style={styles.sosWrapper}>
          {isAlertActive && (
            <Animated.View style={[styles.pulseRing, animatedPulseStyle]} />
          )}
          
          <TouchableOpacity activeOpacity={0.9} onLongPress={triggerSOS} delayLongPress={1500}>
            <Animated.View style={[styles.sosButton, { backgroundColor: theme.backgroundElement }, animatedButtonStyle, isAlertActive && styles.sosButtonActive]}>
              <Text style={[styles.sosText, isAlertActive && { color: '#FFFFFF' }]}>{isAlertActive ? 'ACTIVE' : 'SOS'}</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>

        <Text style={[styles.statusText, { color: theme.textSecondary }]}>
          {isAlertActive 
            ? 'Alert sent to Trusted Contacts & Control Room.' 
            : 'Press and hold for 1.5 seconds if you are in danger.'}
        </Text>
      </View>

      {/* Subtle Disarm System Button */}
      {isAlertActive && (
        <View style={styles.disarmContainer}>
          <TouchableOpacity onLongPress={disarmSOS} delayLongPress={3000}>
            <Text style={[styles.disarmText, { color: theme.textSecondary }]}>Disarm System (Hold 3s)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Privacy Policy Link */}
      <View style={styles.footerLinkContainer}>
         <TouchableOpacity onPress={() => router.push('/privacy-policy')}>
           <Text style={[styles.footerLink, { color: theme.textSecondary }]}>Privacy Policy</Text>
         </TouchableOpacity>
      </View>

      {/* Add Contact Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Trusted Contact</Text>
            
            <TextInput
              style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
              placeholder="Name (e.g. Mom)"
              placeholderTextColor={theme.textSecondary}
              value={newName}
              onChangeText={setNewName}
            />
            
            <TextInput
              style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.backgroundSelected }]}
              placeholder="Phone Number (Digits only)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={text => setNewPhone(text.replace(/[^0-9+]/g, ''))}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.backgroundSelected }]} onPress={() => setIsModalVisible(false)}>
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveContact}>
                <Text style={styles.saveBtnText}>Save Contact</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={isSettingsModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsSettingsModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { padding: 0, backgroundColor: theme.backgroundElement }]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: theme.backgroundSelected}}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Settings</Text>
              <TouchableOpacity onPress={() => setIsSettingsModalVisible(false)}>
                <Ionicons name="close" size={28} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{padding: 20}}>
               <StealthSettings />
               <Text style={{color: theme.textSecondary, textAlign: 'center', marginTop: 30, marginBottom: 20}}>Beta 1.0</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Profile History Modal */}
      <Modal visible={isProfileModalVisible} animationType="fade" transparent={true} onRequestClose={() => setIsProfileModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20}}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Profile & History</Text>
              <TouchableOpacity onPress={() => setIsProfileModalVisible(false)}>
                <Ionicons name="close" size={28} color={theme.text} />
              </TouchableOpacity>
            </View>
            
            <View style={{alignItems: 'center', marginBottom: 20}}>
               {userProfileData?.photo ? (
                 <Image source={{ uri: userProfileData.photo }} style={{width: 100, height: 100, borderRadius: 50, marginBottom: 10, borderWidth: 2, borderColor: theme.background}} />
               ) : (
                 <View style={{width: 100, height: 100, borderRadius: 50, backgroundColor: theme.backgroundSelected, justifyContent: 'center', alignItems: 'center', marginBottom: 10}}>
                    <Ionicons name="person" size={50} color={theme.textSecondary} />
                 </View>
               )}
               <Text style={{color: theme.text, fontSize: 24, fontWeight: 'bold'}}>{userProfileData?.name || 'Unregistered'}</Text>
               <Text style={{color: theme.textSecondary, fontSize: 16}}>{userProfileData?.phone || 'No Phone Number'}</Text>
               <Text style={{color: theme.textSecondary, fontSize: 14}}>{userProfileData?.age ? `${userProfileData.age} years old` : ''}</Text>
               <Text style={{color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 5}}>{userProfileData?.address || ''}</Text>
               
               <TouchableOpacity 
                 style={{marginTop: 15, backgroundColor: theme.backgroundSelected, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20}}
                 onPress={() => { setIsProfileModalVisible(false); router.push('/profile'); }}
               >
                  <Text style={{color: theme.text, fontWeight: 'bold'}}>Edit Profile</Text>
               </TouchableOpacity>
            </View>

            <Text style={{color: theme.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10}}>SOS History ({sosHistory.length})</Text>
            <ScrollView style={{maxHeight: 200}}>
               {sosHistory.length === 0 ? (
                 <Text style={{color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: 20}}>No SOS alerts triggered yet.</Text>
               ) : (
                 sosHistory.map((log, index) => (
                   <View key={index} style={{backgroundColor: theme.background, padding: 10, borderRadius: 8, marginBottom: 10}}>
                     <Text style={{color: '#ff0050', fontWeight: 'bold'}}>Alert {sosHistory.length - index}</Text>
                     <Text style={{color: theme.textSecondary, fontSize: 12, marginTop: 2}}>{new Date(log.timestamp).toLocaleString()}</Text>
                     <Text style={{color: theme.textSecondary, fontSize: 12}}>Lat: {log.latitude.toFixed(4)}, Lng: {log.longitude.toFixed(4)}</Text>
                   </View>
                 ))
               )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PEER TO PEER SOS ALERT MODAL */}
      <Modal visible={!!incomingSOS} animationType="slide" transparent={false} onRequestClose={() => { Vibration.cancel(); setIncomingSOS(null); }}>
        <View style={styles.sosAlertModal}>
          <Text style={styles.sosAlertTitle}>🚨 EMERGENCY SOS 🚨</Text>
          <Text style={styles.sosAlertSubtitle}>A trusted contact is in danger!</Text>
          
          {incomingSOS?.senderProfile && (
            <View style={styles.sosAlertProfile}>
              {incomingSOS.senderProfile.photo_base64 ? (
                <Image source={{ uri: incomingSOS.senderProfile.photo_base64 }} style={styles.sosAlertImage} />
              ) : (
                <View style={[styles.sosAlertImage, { backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="person" size={50} color="#666" />
                </View>
              )}
              <Text style={styles.sosAlertName}>{incomingSOS.senderProfile.name}</Text>
              <Text style={styles.sosAlertPhone}>{incomingSOS.senderProfile.phone_number}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.sosAlertDismiss} onPress={() => { Vibration.cancel(); setIncomingSOS(null); }}>
            <Text style={styles.sosAlertDismissText}>I AM RESPONDING</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    marginLeft: 15,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    fontStyle: 'italic',
  },
  storiesContainer: {
    borderBottomWidth: 0.5,
    paddingBottom: 15,
  },
  storiesScroll: {
    paddingHorizontal: 15,
    gap: 15,
  },
  storyWrapper: {
    alignItems: 'center',
    width: 75,
  },
  storyRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  storyImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  addIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addIcon: {
    fontSize: 30,
    fontWeight: '200',
  },
  storyName: {
    fontSize: 12,
    marginTop: 5,
  },
  feedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sosWrapper: {
    width: width * 0.6,
    height: width * 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: width * 0.3,
    backgroundColor: '#ff0050',
  },
  sosButton: {
    width: width * 0.5,
    height: width * 0.5,
    borderRadius: width * 0.25,
    borderWidth: 5,
    borderColor: '#ff0050',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ff0050',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 15,
  },
  sosButtonActive: {
    backgroundColor: '#ff0050',
  },
  sosText: {
    color: '#ff0050',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusText: {
    fontSize: 16,
    marginTop: 40,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  disarmContainer: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  disarmText: {
    fontSize: 14,
  },
  footerLinkContainer: {
    padding: 20,
    alignItems: 'center',
  },
  footerLink: {
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    padding: 25,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  cancelBtn: {
    padding: 15,
    borderRadius: 10,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontWeight: 'bold',
  },
  saveBtn: {
    padding: 15,
    borderRadius: 10,
    flex: 1,
    marginLeft: 10,
    backgroundColor: '#ff0050',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  sosAlertModal: {
    flex: 1,
    backgroundColor: '#ff0000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sosAlertTitle: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
  },
  sosAlertSubtitle: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 40,
  },
  sosAlertProfile: {
    alignItems: 'center',
    marginBottom: 50,
  },
  sosAlertImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 4,
    borderColor: '#fff',
    marginBottom: 20,
  },
  sosAlertName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  sosAlertPhone: {
    color: '#fff',
    fontSize: 18,
    marginTop: 5,
    opacity: 0.9,
  },
  sosAlertDismiss: {
    backgroundColor: '#fff',
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 30,
    position: 'absolute',
    bottom: 50,
  },
  sosAlertDismissText: {
    color: '#ff0000',
    fontSize: 20,
    fontWeight: 'bold',
  }
});
