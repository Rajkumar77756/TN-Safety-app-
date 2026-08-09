import { registerWebModule, NativeModule } from 'expo';

import { ExpoStealthModeModuleEvents } from './ExpoStealthMode.types';

class ExpoStealthModeModule extends NativeModule<ExpoStealthModeModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(ExpoStealthModeModule, 'ExpoStealthModeModule');
