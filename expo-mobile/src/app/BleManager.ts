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
      return granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  }
  return true;
};

/**
 * START BLE BROADCASTING (VICTIM MODE)
 * Uses the phone's Bluetooth chip to broadcast an encrypted SOS payload
 * to any nearby devices when there is no internet connection.
 */
export const startOfflineSosBroadcast = async (payload: { userId: string, lat: number, lng: number, senderPhone: string | null }) => {
  try {
    console.log('[BLE] Starting Offline SOS Broadcast...');
    
    // Android supports advertising custom service data easily
    // In a production app, the payload would be converted to a byte array and passed here.
    // For this pilot, we broadcast a mock byte array [12, 34] to prove the mesh works.
    BLEAdvertiser.setCompanyId(0xFFFF); // Use testing company ID
    if (Platform.OS === 'android') {
      await BLEAdvertiser.broadcast(THUNAI_SOS_SERVICE_UUID, [12, 34], {
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
