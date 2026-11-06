import React from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Privacy Policy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: theme.text }]}>Privacy Policy for Thunai</Text>
        <Text style={[styles.date, { color: theme.textSecondary }]}>Last updated: {new Date().toLocaleDateString()}</Text>
        
        <Text style={[styles.sectionTitle, { color: theme.text }]}>1. Information We Collect</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          We collect your location data, phone number, name, and profile picture to provide emergency services. During an SOS alert, your real-time location is shared with your trusted contacts and the control room.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>2. How We Use Your Information</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Your information is used strictly to ensure your safety and provide rapid response during emergencies. We do not sell your personal data to third parties.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>3. Data Storage and Security</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          We implement robust security measures to protect your data. Your data is stored securely and accessed only when necessary for emergency dispatch.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>4. Location Tracking</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Continuous location tracking is only activated when you explicitly trigger an SOS alert. You can revoke location permissions at any time through your device settings, but this will limit the functionality of the app.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>5. Contact Us</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          If you have any questions or concerns about this Privacy Policy, please contact our support team.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  date: {
    fontSize: 14,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
});
