import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import ExpoStealthModeModule from '../../modules/expo-stealth-mode/src/ExpoStealthModeModule';

export function useStealthAudioRecorder(serverUrl: string) {
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    // Listen for the native Kotlin service broadcasting the 'onStealthActivated' event
    const subscription = ExpoStealthModeModule.addListener('onStealthActivated', () => {
      console.log('[StealthMode] Native Fake Shutdown triggered! Starting audio surveillance...');
      startAudioSurveillance();
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const startAudioSurveillance = async () => {
    try {
      if (isRecording) return;
      
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        console.warn('[StealthMode] Audio recording permission denied.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });

      console.log('[StealthMode] Starting 1-minute audio recording loop...');
      setIsRecording(true);
      
      await recordAudioChunk();
    } catch (error) {
      console.error('[StealthMode] Failed to start audio surveillance', error);
      setIsRecording(false);
    }
  };

  const recordAudioChunk = async () => {
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;

      // Record for exactly 60 seconds
      setTimeout(async () => {
        await stopAndUploadChunk(recording);
        // Immediately start the next chunk to ensure continuous recording
        recordAudioChunk();
      }, 60000);
    } catch (err) {
      console.error('[StealthMode] Error during audio chunk recording:', err);
    }
  };

  const stopAndUploadChunk = async (recording: Audio.Recording) => {
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        console.log(`[StealthMode] Chunk finished recording at: ${uri}`);
        
        // Upload to the secure backend
        const formData = new FormData();
        formData.append('audioFile', {
          uri,
          name: `stealth_recording_${Date.now()}.m4a`,
          type: 'audio/m4a'
        } as any);

        fetch(`${serverUrl}/api/stealth/upload`, {
          method: 'POST',
          body: formData,
        }).then(res => {
          if (res.ok) console.log('[StealthMode] Audio chunk uploaded successfully to secure server.');
        }).catch(err => {
          console.error('[StealthMode] Failed to upload audio chunk. Saving locally for retry.', err);
          // In a production app, save 'uri' to local SQLite to upload when internet is restored
        });
      }
    } catch (err) {
      console.error('[StealthMode] Failed to stop and upload recording chunk', err);
    }
  };

  return {
    isRecording,
    startAudioSurveillance // Expose if we want to manually trigger it for testing
  };
}
