import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, NativeModules, Alert } from 'react-native';

const { ExpoStealthMode } = NativeModules;

export default function StealthSettings() {
  const [isActive, setIsActive] = useState(false);

  // Note: in a real app you'd poll or use AppState to check if they granted it
  const checkPermission = async () => {
    if (ExpoStealthMode) {
      const isEnabled = await ExpoStealthMode.isAccessibilityServiceEnabled();
      setIsActive(isEnabled);
    }
  };

  const handleOpenAccessibility = () => {
    if (ExpoStealthMode) {
      ExpoStealthMode.openAccessibilitySettings();
    } else {
      Alert.alert('Emulator Mode', 'This button opens native Android accessibility settings. Since you are using Expo Go on the emulator without compiling the native Kotlin code, this native setting cannot be opened here.');
    }
  };

  const handleOpenOverlay = () => {
    if (ExpoStealthMode) {
      ExpoStealthMode.openOverlaySettings();
    } else {
      Alert.alert('Emulator Mode', 'This button opens native Android overlay settings. Since you are using Expo Go on the emulator, this native setting cannot be opened here.');
    }
  };

  const toggleStealthMode = () => {
    if (ExpoStealthMode) {
      ExpoStealthMode.setStealthModeActive(true);
      alert('Stealth Mode Activated! If someone holds the power button, the fake shutdown screen will appear.');
    } else {
      Alert.alert('Emulator Mode', 'Stealth Mode requires native Kotlin background services, which cannot run inside the Expo Go app. The UI works, but the native background task is disabled in this mode.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Protection Settings</Text>
      
      <TouchableOpacity style={styles.button} onPress={handleOpenAccessibility}>
        <Text style={styles.buttonText}>1. Grant Accessibility Permission</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleOpenOverlay}>
        <Text style={styles.buttonText}>2. Grant Display Over Other Apps</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.activateButton]} onPress={toggleStealthMode}>
        <Text style={styles.buttonText}>3. Enable Fake Shutdown</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#111', borderRadius: 10, margin: 10 },
  title: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  button: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginBottom: 10 },
  activateButton: { backgroundColor: '#E53935', marginTop: 20 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: 'bold' }
});
