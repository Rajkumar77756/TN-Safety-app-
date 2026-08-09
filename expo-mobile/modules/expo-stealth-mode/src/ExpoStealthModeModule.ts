import { NativeModule, requireNativeModule } from 'expo';

import { ExpoStealthModeModuleEvents } from './ExpoStealthMode.types';

declare class ExpoStealthModeModule extends NativeModule<ExpoStealthModeModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

let moduleInstance: any = null;
try {
  moduleInstance = requireNativeModule<ExpoStealthModeModule>('ExpoStealthMode');
} catch (e) {
  console.warn("Native module 'ExpoStealthMode' not found. Using mock for Expo Go compatibility.");
  moduleInstance = {
    PI: 3.14,
    hello: () => "Mock Hello",
    setValueAsync: async () => {}
  };
}

export default moduleInstance;
