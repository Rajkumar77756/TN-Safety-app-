import { Platform, PermissionsAndroid } from 'react-native';

// CRITICAL: Do NOT import native BLE modules at the top level.
// Top-level imports force the JS engine to evaluate the native module binding
// during bundle load. If the native module crashes during registration
// (e.g., the registerReceiver SecurityException), the entire JS bundle
// fails to load — no ErrorBoundary, no ErrorUtils, nothing catches it.
// Instead, we use lazy dynamic requires that only execute when BLE is actually needed.

let _BleManager: any = null;
let _BLEAdvertiser: any = null;
let _bleManagerInstance: any = null;

function getBleManager() {
  if (!_BleManager) {
    try {
      _BleManager = require('react-native-ble-plx').BleManager;
    } catch (e) {
      console.error('[BLE] Failed to load react-native-ble-plx:', e);
      return null;
    }
  }
  if (!_bleManagerInstance) {
    try {
      _bleManagerInstance = new _BleManager();
    } catch (e) {
      console.error('[BLE] Failed to create BleManager instance:', e);
      return null;
    }
  }
  return _bleManagerInstance;
}

function getBLEAdvertiser() {
  if (!_BLEAdvertiser) {
    try {
      _BLEAdvertiser = require('react-native-ble-advertiser').default;
    } catch (e) {
      console.error('[BLE] Failed to load react-native-ble-advertiser:', e);
      return null;
    }
  }
  return _BLEAdvertiser;
}

// Unique 128-bit UUID for the Thunai SOS Service
export const THUNAI_SOS_SERVICE_UUID = 'A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D';

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

/**
 * TIGHT BINARY ENCODER
 * Packs critical emergency data into exactly 16 bytes for BLE Advertising
 */
function encodeSosPayload(userId: string, lat: number, lng: number): number[] {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  
  // 0-3: Latitude (Float32)
  view.setFloat32(0, lat, true); // Little endian
  
  // 4-7: Longitude (Float32)
  view.setFloat32(4, lng, true);
  
  // 8-11: Timestamp (UInt32) seconds since epoch
  view.setUint32(8, Math.floor(Date.now() / 1000), true);
  
  // 12-15: User ID Hash (UInt32) - extract numbers from 'user_1234'
  const idHash = parseInt(userId.replace(/\D/g, ''), 10) || 0;
  view.setUint32(12, idHash, true);
  
  return Array.from(new Uint8Array(buf));
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

    const advertiser = getBLEAdvertiser();
    if (!advertiser) {
      console.warn('[BLE] BLE Advertiser module not available on this device.');
      return;
    }

    console.log('[BLE] Starting Offline SOS Broadcast...');
    
    const packedBytes = encodeSosPayload(payload.userId, payload.lat, payload.lng);
    
    advertiser.setCompanyId(0xFFFF);
    
    if (Platform.OS === 'android') {
      await advertiser.broadcast(THUNAI_SOS_SERVICE_UUID, packedBytes, {
        includeDeviceName: false,
        includeTxPowerLevel: true,
      });
      console.log('[BLE] Android Broadcast Active');
    } else {
      console.warn('BLE Broadcasting on iOS requires custom CoreBluetooth implementation in bare React Native.');
    }
  } catch (err) {
    console.error('[BLE] Failed to start broadcast', err);
  }
};

export const stopOfflineSosBroadcast = async () => {
  try {
    const advertiser = getBLEAdvertiser();
    if (advertiser) {
      await advertiser.stopBroadcast();
      console.log('[BLE] Stopped Broadcast');
    }
  } catch (err) {
    console.error('[BLE] Failed to stop broadcast', err);
  }
};

/**
 * START BLE SCANNER (RELAY MODE)
 */
export const startBackgroundRelayScanner = (serverUrl: string) => {
  try {
    console.log('[BLE] Starting Background Relay Scanner...');
    
    const manager = getBleManager();
    if (!manager) {
      console.warn('[BLE] BLE Scanner module not available on this device.');
      return;
    }
    
    manager.startDeviceScan([THUNAI_SOS_SERVICE_UUID], { allowDuplicates: false }, async (error: any, device: any) => {
      if (error) {
        console.error('[BLE] Scan error', error);
        return;
      }

      if (device) {
        console.log(`[BLE] Detected SOS Signal from Device ID: ${device.id}`);
        
        if (manager) {
          manager.stopDeviceScan();
        }
        
        try {
          await fetch(`${serverUrl}/api/mesh/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              relayDeviceId: 'anonymous_relay_node',
              encryptedPayload: 'MOCKED_ENCRYPTED_PAYLOAD_FROM_BLE_MAC_' + device.id
            })
          });
          console.log('[BLE] Successfully relayed SOS packet to Cloud Backend!');
        } catch (err) {
          console.error('[BLE] Failed to relay packet. Internet might be down.', err);
        }
        
        setTimeout(() => startBackgroundRelayScanner(serverUrl), 10000);
      }
    });
  } catch (err) {
    console.error('[BLE] Native Module Crash: Failed to start relay scanner', err);
  }
};
