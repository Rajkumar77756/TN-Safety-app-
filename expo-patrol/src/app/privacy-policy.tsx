import React from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
          <Text style={{ fontSize: 24, color: theme.text, fontWeight: 'bold' }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Privacy Policy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: theme.text }]}>Privacy Policy for Thunai Patrol</Text>
        <Text style={[styles.date, { color: theme.textSecondary }]}>Last updated: {new Date().toLocaleDateString()}</Text>
        
        <Text style={[styles.sectionTitle, { color: theme.text }]}>1. Information We Collect</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          We collect location data and patrol routes to coordinate emergency response.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>2. How We Use Your Information</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Your location is used to dispatch you to emergencies efficiently. This data is strictly for internal dispatch use.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>3. Data Storage and Security</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          We implement robust security measures to protect law enforcement and dispatch data.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>4. Location Tracking</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Continuous background location tracking is necessary while you are on duty.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>5. Contact Us</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Contact control room administration for any policy clarifications.
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
