import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ExpoStealthMode from '../../modules/expo-stealth-mode/src/ExpoStealthModeModule';

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
    try {
      ExpoStealthMode.openAccessibilitySettings();
    } catch (e) {
      Alert.alert('Error', 'Could not open accessibility settings. Ensure the native module is compiled.');
    }
  };

  const handleOpenOverlay = () => {
    try {
      ExpoStealthMode.openOverlaySettings();
    } catch (e) {
      Alert.alert('Error', 'Could not open overlay settings.');
    }
  };

  const toggleStealthMode = () => {
    try {
      ExpoStealthMode.setStealthModeActive(true);
      alert('Stealth Mode Activated! If someone holds the power button, the fake shutdown screen will appear.');
    } catch (e) {
      Alert.alert('Error', 'Stealth Mode requires native Kotlin background services. Make sure you are running the compiled APK.');
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
