import { Stack } from 'expo-router';
import { View, Text, ScrollView, SafeAreaView, Alert } from 'react-native';

// CLAUDE'S RECOMMENDATION: Catch fatal JS errors before React even mounts
if (global.ErrorUtils) {
  const defaultErrorHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      Alert.alert(
        'FATAL JS ERROR (Pre-React)',
        `${error.name}: ${error.message}\n\n${error.stack}`,
        [{ text: 'OK' }]
      );
    }
    defaultErrorHandler(error, isFatal);
  });
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'red' }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 10 }}>FATAL JS CRASH</Text>
        <Text style={{ fontSize: 16, color: 'white', marginBottom: 20 }}>{error.message}</Text>
        <Text style={{ fontSize: 12, color: '#ffcccc' }}>{error.stack}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
