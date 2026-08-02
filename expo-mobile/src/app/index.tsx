import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Image, Dimensions, Vibration, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
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
  const [deviceId] = useState(`user_${Math.floor(Math.random() * 10000)}`);

  // Contacts State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Pulse animation values
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);
  const buttonScale = useSharedValue(1);

  const [incomingSOS, setIncomingSOS] = useState<any>(null);

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

    initSocket();

    return () => {
      if (newSocket) newSocket.disconnect();
      Vibration.cancel();
    };
  }, []);

  const loadContacts = async () => {
    try {
      const savedContacts = await SecureStore.getItemAsync('trusted_contacts');
      if (savedContacts) {
        setContacts(JSON.parse(savedContacts));
      }
    } catch (e) {
      console.error('Failed to load contacts', e);
    }
  };

  const saveContact = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    
    const newContact: Contact = {
      id: Date.now().toString(),
      name: newName,
      phone: newPhone,
      image: `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=random`
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

      let location = await Location.getCurrentPositionAsync({});
      
      if (socket) {
        const phone = await SecureStore.getItemAsync('user_phone');
        const trustedPhoneNumbers = contacts.map(c => c.phone);
        
        socket.emit('sos-alert', {
          userId: deviceId,
          senderPhone: phone || null,
          trustedContacts: trustedPhoneNumbers,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error fetching location:', error);
      setIsAlertActive(false);
    }
  };

  const disarmSOS = () => {
    if (!isAlertActive) return;
    Vibration.vibrate(100); // Small haptic to confirm disarm
    setIsAlertActive(false);
    if (socket) {
      socket.emit('cancel-sos', { userId: deviceId });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
        <View style={styles.header}>
          <Text style={styles.logoText}>Thunai</Text>
          <TouchableOpacity onPress={() => router.push('/profile')}>
            <Ionicons name="person-circle-outline" size={32} color="#fff" />
          </TouchableOpacity>
        </View>

      {/* Instagram-style "Stories" Row (Trusted Contacts) */}
      <View style={styles.storiesContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesScroll}>
          {/* Add New Contact Button */}
          <TouchableOpacity style={styles.storyWrapper} onPress={() => setIsModalVisible(true)}>
            <View style={[styles.storyRing, styles.addStoryRing]}>
              <View style={styles.addIconContainer}>
                <Text style={styles.addIcon}>+</Text>
              </View>
            </View>
            <Text style={styles.storyName}>Add Contact</Text>
          </TouchableOpacity>

          {/* Trusted Contacts */}
          {contacts.map(contact => (
            <View key={contact.id} style={styles.storyWrapper}>
              <View style={styles.storyRing}>
                <Image source={{ uri: contact.image }} style={styles.storyImage} />
              </View>
              <Text style={styles.storyName}>{contact.name}</Text>
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
            <Animated.View style={[styles.sosButton, animatedButtonStyle, isAlertActive && styles.sosButtonActive]}>
              <Text style={styles.sosText}>{isAlertActive ? 'ACTIVE' : 'SOS'}</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>

        <Text style={styles.statusText}>
          {isAlertActive 
            ? 'Alert sent to Trusted Contacts & Control Room.' 
            : 'Press and hold for 1.5 seconds if you are in danger.'}
        </Text>
      </View>

      {/* Subtle Disarm System Button */}
      {isAlertActive && (
        <View style={styles.disarmContainer}>
          <TouchableOpacity onLongPress={disarmSOS} delayLongPress={3000}>
            <Text style={styles.disarmText}>Disarm System (Hold 3s)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Contact Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Trusted Contact</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Name (e.g. Mom)"
              placeholderTextColor="#666"
              value={newName}
              onChangeText={setNewName}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              placeholderTextColor="#666"
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={setNewPhone}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveContact}>
                <Text style={styles.saveBtnText}>Save Contact</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PEER TO PEER SOS ALERT MODAL */}
      <Modal visible={!!incomingSOS} animationType="slide" transparent={false}>
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
    backgroundColor: '#000000', 
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
    fontStyle: 'italic',
  },
  storiesContainer: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#262626',
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
    borderColor: '#ff0050',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  addStoryRing: {
    borderColor: '#262626',
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
    backgroundColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addIcon: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '200',
  },
  storyName: {
    color: '#A8A8A8',
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
    backgroundColor: '#1c1c1c',
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
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusText: {
    color: '#A8A8A8',
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
    color: '#333333', // Very dark grey so it's barely noticeable to an attacker
    fontSize: 14,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#1c1c1c',
    padding: 25,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#000000',
    color: '#FFFFFF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333',
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
    backgroundColor: '#333',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#FFFFFF',
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
