import * as React from 'react';

import { ExpoStealthModeViewProps } from './ExpoStealthMode.types';

export default function ExpoStealthModeView(props: ExpoStealthModeViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
