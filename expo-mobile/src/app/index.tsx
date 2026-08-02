import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Image, Dimensions, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing 
} from 'react-native-reanimated';

const { width } = Dimensions.get('window');

// Connects to the Node.js backend exposed publicly via Localtunnel
const SERVER_URL = 'https://tn-safety-app.onrender.com';

export default function HomeScreen() {
  const [socket, setSocket] = useState<any>(null);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);

  // Pulse animation values
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    // Connect to Socket.io backend with localtunnel bypass header
    const newSocket = io(SERVER_URL, {
      extraHeaders: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Pulse effect when alert is active
  useEffect(() => {
    if (isAlertActive) {
      pulseScale.value = withRepeat(
        withTiming(2, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1, // Infinite repeat
        false
      );
      pulseOpacity.value = withRepeat(
        withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    } else {
      pulseScale.value = 1;
      pulseOpacity.value = 0.5;
    }
  }, [isAlertActive]);

  const animatedPulseStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: pulseScale.value }],
      opacity: pulseOpacity.value,
    };
  });

  const animatedButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: buttonScale.value }],
    };
  });

  const triggerSOS = async () => {
    if (isAlertActive) return; // Prevent multiple triggers

    // Button press animation
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
      
      // Silent Haptic Feedback (Two quick pulses: 100ms vibrate, 100ms pause, 100ms vibrate)
      Vibration.vibrate([0, 100, 100, 100]);

      let location = await Location.getCurrentPositionAsync({});
      
      // Emit SOS alert to the Node.js backend
      if (socket) {
        socket.emit('sos-alert', {
          userId: 'user_123',
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

  // Dummy trusted contacts for the Instagram-style top row
  const trustedContacts = [
    { id: 1, name: 'Mom', image: 'https://ui-avatars.com/api/?name=Mom&background=random' },
    { id: 2, name: 'Dad', image: 'https://ui-avatars.com/api/?name=Dad&background=random' },
    { id: 3, name: 'Brother', image: 'https://ui-avatars.com/api/?name=Brother&background=random' },
    { id: 4, name: 'Police', image: 'https://ui-avatars.com/api/?name=Police&background=random' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.logoText}>Raksha</Text>
      </View>

      {/* Instagram-style "Stories" Row (Trusted Contacts) */}
      <View style={styles.storiesContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesScroll}>
          {/* Add New Contact Button */}
          <View style={styles.storyWrapper}>
            <View style={[styles.storyRing, styles.addStoryRing]}>
              <View style={styles.addIconContainer}>
                <Text style={styles.addIcon}>+</Text>
              </View>
            </View>
            <Text style={styles.storyName}>Add Contact</Text>
          </View>

          {/* Trusted Contacts */}
          {trustedContacts.map(contact => (
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
          {/* Pulsing Background Rings */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // Instagram Dark Mode Black
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
    fontStyle: 'italic', // Stylized like Instagram logo
  },
  storiesContainer: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#262626', // Dark gray border
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
    borderColor: '#ff0050', // Safety Red/Pink gradient style
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  addStoryRing: {
    borderColor: '#262626', // Dimmed out for the add button
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
  }
});
