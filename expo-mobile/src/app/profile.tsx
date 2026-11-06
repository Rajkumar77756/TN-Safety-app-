import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { SERVER_URL } from './index'; // Reuse the SERVER_URL from index.tsx

export default function ProfileScreen() {
  const router = useRouter();
  
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const storedPhone = await SecureStore.getItemAsync('user_phone');
      const storedName = await SecureStore.getItemAsync('user_name');
      const storedAge = await SecureStore.getItemAsync('user_age');
      const storedAddress = await SecureStore.getItemAsync('user_address');
      const storedWorkplace = await SecureStore.getItemAsync('user_workplace');
      const storedPhoto = await SecureStore.getItemAsync('user_photo_base64');

      if (storedPhone) setPhone(storedPhone);
      if (storedName) setName(storedName);
      if (storedAge) setAge(storedAge);
      if (storedAddress) setAddress(storedAddress);
      if (storedWorkplace) setWorkplace(storedWorkplace);
      if (storedPhoto) setPhotoBase64(storedPhoto);
    } catch (e) {
      console.error('Failed to load profile locally', e);
    }
    setIsLoading(false);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Sorry, we need camera roll permissions to upload a photo.');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3, // Compress heavily for base64 storage
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setPhotoBase64(base64Image);
    }
  };

  const saveProfile = async () => {
    if (!phone || !name) {
      Alert.alert('Required Fields', 'Phone number and Full Name are strictly required to use the peer-to-peer SOS network.');
      return;
    }

    const cleanPhone = phone.trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      Alert.alert(
        'Invalid Phone Number',
        'Phone number must contain only numbers (10 to 15 digits). Letters and words are not accepted.'
      );
      return;
    }

    let parsedAge: number | null = null;
    if (age && age.trim()) {
      const numAge = Number(age.trim());
      if (!Number.isInteger(numAge) || numAge < 1 || numAge > 120) {
        Alert.alert(
          'Invalid Age',
          'Age must be a valid number between 1 and 120. Letters and words are not accepted.'
        );
        return;
      }
      parsedAge = numAge;
    }

    setIsSaving(true);
    try {
      // 1. Save locally FIRST so data never vanishes
      await SecureStore.setItemAsync('user_phone', cleanPhone);
      await SecureStore.setItemAsync('user_name', name.trim());
      if (parsedAge !== null) {
        await SecureStore.setItemAsync('user_age', String(parsedAge));
      }
      if (address.trim()) {
        await SecureStore.setItemAsync('user_address', address.trim());
      }
      if (workplace.trim()) {
        await SecureStore.setItemAsync('user_workplace', workplace.trim());
      }
      if (photoBase64) {
        await SecureStore.setItemAsync('user_photo_base64', photoBase64);
      }
      await SecureStore.setItemAsync('user_profile_completed', 'true');

      // 2. Sync to backend silently (don't throw error to user if server is sleeping)
      fetch(`${SERVER_URL}/api/civilian/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: cleanPhone,
          name: name.trim(),
          age: parsedAge,
          currentAddress: address.trim(),
          workplaceDetails: workplace.trim(),
          photoBase64: photoBase64
        })
      }).catch(err => console.log('Backend sync delayed:', err));

      Alert.alert('Success', 'Profile identity securely saved.');
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to save profile. Make sure you have an internet connection.');
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ff4d4f" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Identity Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.disclaimer}>
        This information is strictly used for emergency dispatch. It allows your trusted contacts to see who you are and where you are during an SOS.
      </Text>

      <View style={styles.photoContainer}>
        <TouchableOpacity onPress={pickImage} style={styles.photoButton}>
          {photoBase64 ? (
            <Image source={{ uri: photoBase64 }} style={styles.profileImage} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="camera" size={40} color="#666" />
              <Text style={styles.photoText}>Add Photo</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Phone Number (Required, Numbers Only)</Text>
        <TextInput 
          style={styles.input} 
          placeholder="e.g. 9952775428"
          placeholderTextColor="#666"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={text => setPhone(text.replace(/[^0-9+]/g, ''))}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Full Name (Required)</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Your Full Name"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Age (Numbers Only)</Text>
        <TextInput 
          style={styles.input} 
          placeholder="e.g. 24"
          placeholderTextColor="#666"
          keyboardType="numeric"
          maxLength={3}
          value={age}
          onChangeText={text => setAge(text.replace(/[^0-9]/g, ''))}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Current Address</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="Your full residential address..."
          placeholderTextColor="#666"
          multiline
          numberOfLines={3}
          value={address}
          onChangeText={setAddress}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>School / College / Workplace Details</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="Where do you commute daily?"
          placeholderTextColor="#666"
          multiline
          numberOfLines={3}
          value={workplace}
          onChangeText={setWorkplace}
        />
      </View>

      <TouchableOpacity 
        style={styles.saveButton} 
        onPress={saveProfile}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.saveButtonText}>SECURE & SAVE IDENTITY</Text>
        )}
      </TouchableOpacity>
      
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 40,
    marginBottom: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  backButton: {
    padding: 5,
  },
  disclaimer: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 20,
  },
  photoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  photoButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholder: {
    alignItems: 'center',
  },
  photoText: {
    color: '#666',
    marginTop: 5,
    fontSize: 12,
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    padding: 15,
    fontSize: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#00ff00',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 1,
  }
});
