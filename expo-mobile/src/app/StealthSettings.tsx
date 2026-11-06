import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ExpoStealthMode from '../../modules/expo-stealth-mode/src/ExpoStealthModeModule';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { SERVER_URL } from './index';
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

  const handleDeleteAccount = () => {
    Alert.alert(
      "Danger Zone", 
      "Are you sure you want to permanently delete your account, trusted contacts, and emergency data? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete My Data", 
          style: "destructive",
          onPress: async () => {
            try {
              const phone = await SecureStore.getItemAsync('user_phone');
              if (!phone) {
                alert("No active account found.");
                return;
              }

              // Generate HMAC Signature to securely authenticate the deletion request
              // For a real prod app, use a secret key stored remotely or via secure hardware enclave.
              const secretKey = 'thunai_secure_hmac_secret_2026';
              const timestamp = Date.now().toString();
              const payload = `${phone}:${timestamp}`;
              
              const signature = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                `${payload}:${secretKey}`
              );

              const response = await fetch(`${SERVER_URL}/api/user/data`, {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Thunai-Signature': signature,
                  'X-Thunai-Timestamp': timestamp
                },
                body: JSON.stringify({ phone })
              });

              if (response.ok) {
                await SecureStore.deleteItemAsync('user_phone');
                await SecureStore.deleteItemAsync('trusted_contacts');
                await SecureStore.deleteItemAsync('dpdp_consent');
                Alert.alert("Account Deleted", "All your data has been successfully wiped from our servers.");
              } else {
                const data = await response.json();
                Alert.alert("Deletion Failed", data.error || "Please try again later.");
              }
            } catch (err) {
              Alert.alert("Network Error", "Could not reach the server to delete your data.");
            }
          }
        }
      ]
    );
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

      <View style={styles.divider} />

      <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleDeleteAccount}>
        <Text style={styles.buttonText}>Delete My Account & Data</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#111', borderRadius: 10, margin: 10 },
  title: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  button: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginBottom: 10 },
  activateButton: { backgroundColor: '#E53935', marginTop: 20 },
  deleteButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#E53935', marginTop: 10 },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 20 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: 'bold' }
});
