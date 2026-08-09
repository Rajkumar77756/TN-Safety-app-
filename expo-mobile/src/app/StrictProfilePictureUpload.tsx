import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export default function StrictProfilePictureUpload() {
  const [imageUri, setImageUri] = useState<string | null>(null);

  const pickImage = async () => {
    // We strictly use the camera to prevent them from uploading heavily filtered gallery photos
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'We need access to your camera to take a secure profile picture.');
      return;
    }

    Alert.alert(
      'Strict Upload Rules',
      'Please take a clear photo of your face right now.\n\n• No filters or editing\n• Good lighting\n• Face clearly visible\n\nThis photo is strictly used by emergency responders to identify you in the event of an SOS.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Open Camera', 
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              allowsEditing: true, // Allow them to crop their face
              aspect: [1, 1],
              quality: 0.8,
            });

            if (!result.canceled) {
              setImageUri(result.assets[0].uri);
              // In production: upload this URI to Supabase immediately and link to their profile
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Emergency Identification Profile</Text>
      
      <View style={styles.warningBox}>
        <Text style={styles.warningText}>
          ⚠️ CRITICAL: Your profile picture is strictly for emergency identification. It is securely stored in our database and will ONLY be shared with authorities if you trigger an SOS.
        </Text>
        <Text style={styles.warningTextBold}>
          DO NOT use filters, Snapchat lenses, or group photos.
        </Text>
      </View>

      <View style={styles.imageContainer}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No Photo Set</Text>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.button} onPress={pickImage}>
        <Text style={styles.buttonText}>{imageUri ? 'Retake Photo' : 'Take Secure Photo'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#fff', borderRadius: 10, margin: 10 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#000' },
  warningBox: { backgroundColor: '#FFEBEE', padding: 15, borderRadius: 8, marginBottom: 20 },
  warningText: { color: '#B71C1C', fontSize: 14, marginBottom: 10 },
  warningTextBold: { color: '#B71C1C', fontSize: 14, fontWeight: 'bold' },
  imageContainer: { alignItems: 'center', marginBottom: 20 },
  image: { width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: '#4CAF50' },
  placeholder: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#EEEEEE', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#BDBDBD', borderStyle: 'dashed' },
  placeholderText: { color: '#9E9E9E', fontWeight: 'bold' },
  button: { backgroundColor: '#1976D2', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
