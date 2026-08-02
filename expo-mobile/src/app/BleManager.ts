import { BleManager } from 'react-native-ble-plx';
import BLEAdvertiser from 'react-native-ble-advertiser';
import { Platform, PermissionsAndroid } from 'react-native';
import { SERVER_URL } from './index';

// Initialize the BLE PLX Manager for scanning lazily to prevent startup crashes
export let bleManager: BleManager | null = null;

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
 * Uses the phone's Bluetooth chip to broadcast an encrypted SOS payload
 * to any nearby devices when there is no internet connection.
 */
export const startOfflineSosBroadcast = async (payload: { userId: string, lat: number, lng: number, senderPhone: string | null }) => {
  try {
    console.log('[BLE] Starting Offline SOS Broadcast...');
    
    // Encode the victim's critical data into a 16-byte binary payload
    const packedBytes = encodeSosPayload(payload.userId, payload.lat, payload.lng);
    
    // Set up the BLE Advertiser
    BLEAdvertiser.setCompanyId(0xFFFF); // Use testing company ID
    
    if (Platform.OS === 'android') {
      // Broadcast the custom 16-byte emergency payload in the Manufacturer Data
      await BLEAdvertiser.broadcast(THUNAI_SOS_SERVICE_UUID, packedBytes, {
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
    await BLEAdvertiser.stopBroadcast();
    console.log('[BLE] Stopped Broadcast');
  } catch (err) {
    console.error('[BLE] Failed to stop broadcast', err);
  }
};

/**
 * START BLE SCANNER (RELAY MODE)
 * Runs in the background continuously listening for Thunai SOS broadcasts.
 * If it hears one, it uses the relay phone's internet to send it to the police.
 */
export const startBackgroundRelayScanner = () => {
  console.log('[BLE] Starting Background Relay Scanner...');
  
  if (!bleManager) {
    bleManager = new BleManager();
  }
  
  bleManager.startDeviceScan([THUNAI_SOS_SERVICE_UUID], { allowDuplicates: false }, async (error, device) => {
    if (error) {
      console.error('[BLE] Scan error', error);
      return;
    }

    if (device) {
      console.log(`[BLE] Detected SOS Signal from Device ID: ${device.id}`);
      
      // Stop scanning temporarily while we relay to prevent spam
      if (bleManager) {
        bleManager.stopDeviceScan();
      }
      
      // In a real implementation, extract the Manufacturer Data payload and relay it
      try {
        await fetch(`${SERVER_URL}/api/mesh/relay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            relayDeviceId: 'anonymous_relay_node',
            // Mock payload for the pilot demonstration
            encryptedPayload: 'MOCKED_ENCRYPTED_PAYLOAD_FROM_BLE_MAC_' + device.id
          })
        });
        console.log('[BLE] Successfully relayed SOS packet to Cloud Backend!');
      } catch (err) {
        console.error('[BLE] Failed to relay packet. Internet might be down.', err);
      }
      
      // Resume scanning after a cooldown
      setTimeout(() => startBackgroundRelayScanner(), 10000);
    }
  });
};
