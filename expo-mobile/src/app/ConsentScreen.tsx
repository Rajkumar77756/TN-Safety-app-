import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

const { width } = Dimensions.get('window');

export default function ConsentScreen() {
  const router = useRouter();
  const [isChecked, setIsChecked] = useState(false);

  const handleAccept = async () => {
    if (!isChecked) {
      alert("You must agree to the data collection policy to use this emergency app.");
      return;
    }
    
    // Log the digital signature and timestamp of consent
    const consentLog = {
      timestamp: new Date().toISOString(),
      agreed: true,
      version: '1.0'
    };
    
    await SecureStore.setItemAsync('dpdp_consent', JSON.stringify(consentLog));
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Data Privacy & Consent</Text>
      
      <ScrollView style={styles.scrollView}>
        <Text style={styles.content}>
          To provide emergency SOS services, Thunai requires access to your location and Bluetooth.
          {'\n\n'}
          **Data Protection Policy (DPDP Compliance):**
          {'\n\n'}
          1. **Data Minimization:** We only collect your location and phone number when you explicitly trigger an SOS.
          2. **Data Retention:** All emergency location data is automatically purged from our servers 48 hours after an SOS is resolved (Legal Hold).
          3. **Right to be Forgotten:** You may permanently delete your account and all associated data at any time from the Settings menu.
          4. **Zero-Knowledge Encryption:** Your trusted contacts are stored locally on your device and are never harvested for marketing.
          5. **Offline Mesh:** By using the offline mesh, your device will temporarily cache and relay encrypted distress signals from nearby users in danger.
          {'\n\n'}
          Your safety is our priority. Your data is never sold.
        </Text>

        <TouchableOpacity 
          style={styles.checkboxContainer} 
          onPress={() => setIsChecked(!isChecked)}
        >
          <View style={[styles.checkbox, isChecked && styles.checkboxChecked]} />
          <Text style={styles.checkboxLabel}>
            I have read and agree to the Data Privacy Policy and consent to location sharing during emergencies.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity 
        style={[styles.button, !isChecked && styles.buttonDisabled]} 
        onPress={handleAccept}
        disabled={!isChecked}
      >
        <Text style={styles.buttonText}>Accept & Continue</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    marginTop: 20,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 15,
    padding: 20,
  },
  content: {
    color: '#rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    lineHeight: 24,
  },
  checkboxContainer: {
    flexDirection: 'row',
    marginTop: 30,
    marginBottom: 20,
    alignItems: 'center',
    paddingRight: 20,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#ff4444',
    borderRadius: 6,
    marginRight: 15,
  },
  checkboxChecked: {
    backgroundColor: '#ff4444',
  },
  checkboxLabel: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
  button: {
    backgroundColor: '#ff4444',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#333',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
