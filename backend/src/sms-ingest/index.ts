import { Router } from 'express';
import { pool } from '../models/db';
// In a real app you'd import the initialized socket.io instance here or pass it in
// to broadcast the salvaged payload. For this scaffold, we simulate the broadcast.

const router = Router();

// In-memory cache for partial multipart SMS messages
// Key: msgId (from the UDH or a generated hash of the sender + timestamp)
const partialSmsCache: Record<string, {
  parts: (string | null)[];
  totalParts: number;
  timer: NodeJS.Timeout;
}> = {};

router.post('/', async (req, res) => {
  // Example payload from Twilio or a GSM gateway: 
  // { from: '+919999999999', text: 'SOS:auth1234:12.123', partIndex: 1, totalParts: 2, msgId: '1234' }
  const { from, text, partIndex, totalParts, msgId } = req.body;

  if (totalParts === 1) {
    // Process full single SMS immediately
    await processCompletePayload(text);
    return res.status(200).send('Processed');
  }

  // Handle multipart SMS
  if (!partialSmsCache[msgId]) {
    partialSmsCache[msgId] = {
      parts: new Array(totalParts).fill(null),
      totalParts,
      timer: setTimeout(async () => {
        // 60-second timeout fired. Salvage whatever arrived.
        console.warn(`Timeout waiting for SMS parts for msgId ${msgId}. Salvaging partial data.`);
        const salvagedText = partialSmsCache[msgId].parts.join(''); // Join whatever we have
        await processCompletePayload(salvagedText, true); // true = isPartial
        delete partialSmsCache[msgId];
      }, 60000)
    };
  }

  // Store the received part (partIndex is 1-based)
  partialSmsCache[msgId].parts[partIndex - 1] = text;

  // Check if all parts have arrived
  if (!partialSmsCache[msgId].parts.includes(null)) {
    clearTimeout(partialSmsCache[msgId].timer);
    const completeText = partialSmsCache[msgId].parts.join('');
    await processCompletePayload(completeText, false);
    delete partialSmsCache[msgId];
  }

  res.status(200).send('Acknowledged part');
});

async function processCompletePayload(payloadString: string, isPartial: boolean = false) {
  // Try to parse as much as possible. 
  // Example compact payload: "SOS:auth1234:12.12345:77.12345:85:167890123"
  const parts = payloadString.split(':');
  
  if (parts.length >= 4) {
    // We at least have auth, lat, and lng. This is the minimum viable salvage.
    const authKey = parts[1];
    const lat = parseFloat(parts[2]);
    const lng = parseFloat(parts[3]);
    const battery = parts.length > 4 ? parseInt(parts[4]) : null; // May be missing if partial
    
    console.log(`Successfully salvaged payload. Lat: ${lat}, Lng: ${lng}, Battery: ${battery}`);
    
    // TODO: Verify HMAC, insert into PostGIS, broadcast to Socket.io
  } else {
    console.error('Payload too fragmented to salvage useful location data.');
  }
}

export default router;
