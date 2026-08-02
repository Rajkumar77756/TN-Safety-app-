import { Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'REPLACE_ME_WITH_YOUR_SENTRY_DSN',
  tracesSampleRate: 1.0,
});

function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default Sentry.wrap(RootLayout);
