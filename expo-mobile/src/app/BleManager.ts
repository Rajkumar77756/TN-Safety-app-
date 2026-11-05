import { Platform, PermissionsAndroid } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { Buffer } from 'buffer';

let ExpoStealthMode: any = null;
try {
  ExpoStealthMode = requireNativeModule('ExpoStealthMode');
} catch (e) {
  console.error('Failed to load ExpoStealthMode native module', e);
}

// Unique 16-bit UUID (0xFD69 mapped to 128-bit base) for the Thunai SOS Service
export const THUNAI_SOS_SERVICE_UUID = '0000FD69-0000-1000-8000-00805F9B34FB';

export const requestBluetoothPermissions = async () => {
  if (Platform.OS === 'android') {
    if ((Platform.Version as number) >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      
      const scanGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      const advertiseGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE] === PermissionsAndroid.RESULTS.GRANTED;
      
      return scanGranted && advertiseGranted;
    } else {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  }
  return true;
};

import CryptoJS from 'crypto-js';

const BLE_SECRET_KEY = CryptoJS.enc.Utf8.parse('thunai_securekey'); // 16-byte key
const BLE_IV = CryptoJS.enc.Utf8.parse('thunai_secure_iv'); // 16-byte IV

/**
 * TIGHT BINARY ENCODER
 * Packs critical emergency data into exactly 16 bytes for BLE Advertising,
 * then encrypts it using AES to prevent stalkers from tracking plaintext IDs.
 */
function encodeSosPayload(userId: string, lat: number, lng: number): string {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  
  view.setFloat32(0, lat, true); // Little endian
  view.setFloat32(4, lng, true);
  view.setUint32(8, Math.floor(Date.now() / 1000), true);
  
  const idHash = parseInt(userId.replace(/\D/g, ''), 10) || 0;
  view.setUint32(12, idHash, true);
  
  // Encrypt with AES
  const wordArray = CryptoJS.lib.WordArray.create(buf as any);
  const encrypted = CryptoJS.AES.encrypt(wordArray, BLE_SECRET_KEY, {
    iv: BLE_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.NoPadding
  });
  
  // encrypted.toString() returns Base64 format
  return encrypted.toString();
}

/**
 * START BLE BROADCASTING (VICTIM MODE)
 */
export const startOfflineSosBroadcast = async (payload: { userId: string, lat: number, lng: number, senderPhone: string | null }) => {
  try {
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      console.warn('[BLE] Advertise permission denied. Cannot broadcast offline SOS.');
      return;
    }

    if (!ExpoStealthMode) {
      console.warn('[BLE] Native module not available.');
      return;
    }

    console.log('[BLE] Starting NATIVE Kotlin Offline SOS Broadcast...');
    const base64Payload = encodeSosPayload(payload.userId, payload.lat, payload.lng);
    
    if (Platform.OS === 'android') {
      ExpoStealthMode.broadcastSosPayload(base64Payload);
      console.log('[BLE] Native Android Foreground Broadcast Active');
    }
  } catch (err) {
    console.error('[BLE] Failed to start native broadcast', err);
  }
};

export const stopOfflineSosBroadcast = async () => {
  try {
    if (ExpoStealthMode) {
      ExpoStealthMode.stopMeshService();
      console.log('[BLE] Stopped Native Broadcast');
    }
  } catch (err) {
    console.error('[BLE] Failed to stop native broadcast', err);
  }
};

/**
 * START BLE SCANNER (RELAY MODE)
 */
export const startBackgroundRelayScanner = (serverUrl: string) => {
  try {
    console.log('[BLE] Starting NATIVE Kotlin Background Relay Scanner...');
    if (ExpoStealthMode && Platform.OS === 'android') {
      ExpoStealthMode.startMeshService();
    }
  } catch (err) {
    console.error('[BLE] Failed to start native relay scanner', err);
  }
};

export const requestBatteryExemption = () => {
    if (ExpoStealthMode && Platform.OS === 'android') {
        ExpoStealthMode.requestBatteryExemption();
    }
}
