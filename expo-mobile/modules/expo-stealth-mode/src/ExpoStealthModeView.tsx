import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoStealthModeViewProps } from './ExpoStealthMode.types';

const NativeView: React.ComponentType<ExpoStealthModeViewProps> =
  requireNativeView('ExpoStealthMode');

export default function ExpoStealthModeView(props: ExpoStealthModeViewProps) {
  return <NativeView {...props} />;
}
