import express from 'express';
import crypto from 'crypto';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import authRouter from './auth';
import { initDb, pool } from './models/db';
import { checkDeviceStatus } from './abuse-prevention';
import './cron'; // Start the cron sweep job

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // In production, restrict this to your dashboard domain
  }
});

// Enable CORS for standard HTTP endpoints (like /api/dispatcher/login)
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Setup Audio Uploads Directory
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Serve static uploads
app.use('/uploads', express.static(uploadDir));

// Routes
app.use('/api/auth', authRouter);

// Basic healthcheck
app.get('/health', (req, res) => res.send('OK'));

// Dispatcher Login Rate Limiting (Brute force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: 'Too many login attempts. Please try again later.' }
});

// --- MULTI-SESSION SOCKET TRACKING ---
const activePatrolSockets = new Map<number, Set<any>>();

// --- DISPATCHER AUTHENTICATION ---
app.post('/api/dispatcher/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  
  if (!process.env.JWT_SECRET) {
    console.error('CRITICAL: JWT_SECRET environment variable is missing!');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    let dispatcher;
    let isValid = false;

    // Hardcoded CM Pilot Account (Allows demo to run even if PostgreSQL is offline)
    if (username === 'admin' && password === 'admin123') {
      dispatcher = { id: 'pilot-officer-1' };
      isValid = true;
    } else {
      const result = await pool.query(`SELECT id, password_hash FROM dispatchers WHERE username = $1`, [username]);
      if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
      dispatcher = result.rows[0];
      isValid = await bcrypt.compare(password, dispatcher.password_hash);
    }
    
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    // Issue a short-lived token containing the verified server-side role
    const token = jwt.sign(
      { dispatcherId: dispatcher.id, role: 'DISPATCHER' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '8h' }
    );

    res.json({ token });
  } catch (e) {
    console.error('Login error:', e);
    // Silent fail for local testing without DB
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- DPDP COMPLIANT DELETION API ---

// --- ADMIN VERIFICATION API ---
// Middleware to require ADMIN role
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN' && decoded.role !== 'DISPATCHER') return res.status(403).json({ error: 'Admin role required' }); // In pilot demo, allowing DISPATCHER to act as admin
    (req as any).adminId = decoded.dispatcherId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/api/admin/officers', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, phone_number as email, badge_number, status, last_active, phone_number FROM patrol_officers ORDER BY id DESC`);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/admin/officers/verify', requireAdmin, async (req, res) => {
  const { officerId } = req.body;
  const adminId = (req as any).adminId;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Flip status to VERIFIED
      await client.query(`UPDATE patrol_officers SET status = 'VERIFIED' WHERE id = $1`, [officerId]);
      
      // 2. Log to immutable audit trail
      await client.query(`
        INSERT INTO admin_audit_logs (admin_id, action, target_officer_id) 
        VALUES ($1, 'VERIFY_OFFICER', $2)
      `, [adminId, officerId]);

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Verification error:', e);
    res.status(500).json({ error: 'Failed to verify officer' });
  }
});
app.post('/api/admin/officers/revoke', requireAdmin, async (req, res) => {
  const { officerId, reason } = req.body;
  const adminId = (req as any).adminId;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(`UPDATE patrol_officers SET status = 'REVOKED' WHERE id = $1`, [officerId]);
      
      await client.query(`
        INSERT INTO admin_audit_logs (admin_id, action, target_officer_id) 
        VALUES ($1, $2, $3)
      `, [adminId, `REVOKE_OFFICER: ${reason || 'No reason provided'}`, officerId]);

      await client.query('COMMIT');
      
      // Real-time Revocation: Disconnect all active sessions for this officer
      const officerSockets = activePatrolSockets.get(officerId);
      if (officerSockets) {
        for (const sock of officerSockets) {
          try { sock.disconnect(true); } catch (err) {}
        }
        activePatrolSockets.delete(officerId);
      }

      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to revoke officer' });
  }
});

app.post('/api/dispatch/incident/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  try {
    await pool.query(`UPDATE incidents SET status = $1, legal_hold_state = 'RELEASED' WHERE id = $2`, [status, id]);
    
    // Broadcast the resolution to the dashboard and patrol officers
    io.emit('incident_location_updated', {
      incidentId: id,
      status: status,
      notes: notes,
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- HISTORICAL INCIDENTS API ---
app.get('/api/admin/incidents/history', requireAdmin, async (req, res) => {
  const dateStr = req.query.date as string; // e.g. '2026-08-08'
  if (!dateStr) return res.status(400).json({ error: 'Date is required' });

  try {
    const query = `
      SELECT 
        i.id as "incidentId",
        i.device_uuid as "deviceUuid",
        i.status,
        i.district,
        i.created_at as timestamp,
        c.name, c.phone_number, c.age, c.current_address, c.photo_base64,
        (SELECT ST_Y(geom) FROM locations l2 WHERE l2.incident_id = i.id ORDER BY recorded_at DESC LIMIT 1) as lat,
        (SELECT ST_X(geom) FROM locations l2 WHERE l2.incident_id = i.id ORDER BY recorded_at DESC LIMIT 1) as lng
      FROM incidents i
      LEFT JOIN device_identity di ON i.device_uuid = di.uuid
      LEFT JOIN civilian_profiles c ON di.phone_number = c.phone_number
      WHERE DATE(i.created_at) = $1
      ORDER BY i.created_at DESC
    `;
    const result = await pool.query(query, [dateStr]);
    
    const incidentsMap: Record<string, any> = {};
    result.rows.forEach(row => {
       incidentsMap[row.incidentId] = {
         incidentId: row.incidentId,
         deviceUuid: row.deviceUuid,
         status: row.status,
         district: row.district,
         timestamp: new Date(row.timestamp).getTime(),
         lat: row.lat || 11.1271, 
         lng: row.lng || 78.6569,
         senderProfile: row.name ? {
            phone_number: row.phone_number,
            name: row.name,
            age: row.age,
            current_address: row.current_address,
            photo_base64: row.photo_base64
         } : null
       };
    });

    res.json({ incidents: incidentsMap });
  } catch(e) {
    console.error('History fetch error:', e);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// --- AUDIO EVIDENCE API ---
app.post('/api/stealth/upload', upload.single('audioFile'), (req, res) => {
  console.log(`[AUDIO] Received stealth recording: ${req.file?.filename}`);
  res.json({ success: true, file: req.file?.filename });
});

app.get('/api/admin/incidents/:id/audio', requireAdmin, (req, res) => {
  // For the pilot demo, return all audio files as we aren't strict matching incident IDs yet
  try {
    const files = fs.readdirSync(uploadDir);
    const m4aFiles = files.filter(f => f.endsWith('.m4a')).sort().reverse();
    const urls = m4aFiles.map(f => `/uploads/${f}`);
    res.json({ audioFiles: urls });
  } catch (e) {
    res.json({ audioFiles: [] });
  }
});

// --- CIVILIAN PROFILE API ---
app.post('/api/civilian/profile', async (req, res) => {
  const { phoneNumber, name, age, currentAddress, workplaceDetails, photoBase64 } = req.body;
  
  if (!phoneNumber || !name) {
    return res.status(400).json({ error: 'Phone number and name are required' });
  }

  try {
    await pool.query(`
      INSERT INTO civilian_profiles (phone_number, name, age, current_address, workplace_details, photo_base64, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (phone_number) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        current_address = EXCLUDED.current_address,
        workplace_details = EXCLUDED.workplace_details,
        photo_base64 = EXCLUDED.photo_base64,
        updated_at = CURRENT_TIMESTAMP
    `, [phoneNumber, name, age || null, currentAddress || null, workplaceDetails || null, photoBase64 || null]);
    
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to save civilian profile', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/civilian/profile/:phone', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM civilian_profiles WHERE phone_number = $1', [req.params.phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- MESH NETWORK RELAY DECODER & API ---
const BLE_SECRET_KEY = Buffer.from('thunai_securekey', 'utf8'); // 16 bytes
const BLE_IV = Buffer.from('thunai_secure_iv', 'utf8'); // 16 bytes

function decodeMeshPayload(encryptedPayloadBase64: string): { lat: number, lng: number, timestamp: string, userId: string } | null {
  try {
    const rawBuf = Buffer.from(encryptedPayloadBase64, 'base64');
    if (rawBuf.length < 16) return null;

    let buf = rawBuf;
    // Attempt AES-128-CBC decryption first
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', BLE_SECRET_KEY, BLE_IV);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(rawBuf), decipher.final()]);
      const testLat = decrypted.readFloatLE(0);
      const testLng = decrypted.readFloatLE(4);
      if (!isNaN(testLat) && testLat >= -90 && testLat <= 90 && !isNaN(testLng) && testLng >= -180 && testLng <= 180) {
        buf = decrypted;
      }
    } catch (e) {
      // Fallback to checking rawBuf directly
    }

    const lat = buf.readFloatLE(0);
    const lng = buf.readFloatLE(4);
    const timestampSecs = buf.readUInt32LE(8);
    const userIdHash = buf.readUInt32LE(12);

    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      console.warn(`[MESH RELAY] Invalid coordinates: lat=${lat}, lng=${lng}`);
      return null;
    }

    const userId = 'victim_' + (userIdHash || 'unknown');
    const timestamp = timestampSecs > 1500000000 ? new Date(timestampSecs * 1000).toISOString() : new Date().toISOString();

    return { lat, lng, timestamp, userId };
  } catch (err) {
    console.error('[MESH RELAY] Decode error:', err);
    return null;
  }
}

async function dispatchToPatrolOfficers(incidentId: string, lat: number, lng: number, timestamp: string, senderProfile: any) {
  try {
    // 1. PostGIS spatial query: find verified on-duty officers within 10km
    let nearestOfficers = await pool.query(`
      SELECT id, phone_number, badge_number 
      FROM patrol_officers 
      WHERE status = 'VERIFIED' AND is_on_duty = TRUE
      AND location IS NOT NULL
      AND ST_DWithin(
        location, 
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
        10000 -- 10km radius
      )
    `, [lng, lat]);

    // 2. Testing fallback: if no officers within 10km, alert all on-duty verified officers
    if (nearestOfficers.rows.length === 0) {
      nearestOfficers = await pool.query(`
        SELECT id, phone_number, badge_number 
        FROM patrol_officers 
        WHERE status = 'VERIFIED' AND is_on_duty = TRUE
      `);
    }

    for (const officer of nearestOfficers.rows) {
      io.to(`patrol_${officer.id}`).emit('dispatch_patrol', {
        incidentId,
        lat,
        lng,
        timestamp: timestamp || new Date().toISOString(),
        senderProfile: senderProfile || { name: 'Emergency SOS Victim', phone_number: 'Confidential' }
      });
      
      try {
        await pool.query(`
          INSERT INTO dispatch_log (officer_id, incident_id)
          VALUES ($1, $2)
        `, [officer.id, incidentId]);
      } catch (logErr) {}

      console.log(`[PATROL DISPATCH] Dispatched incident ${incidentId} to Officer Badge: ${officer.badge_number}`);
    }
  } catch (e) {
    console.error('[PATROL DISPATCH] Failed to dispatch to patrol officers:', e);
  }
}

app.post('/api/mesh/relay', async (req, res) => {
  const { relayDeviceId, encryptedPayload } = req.body;
  
  if (!encryptedPayload) return res.status(400).json({ error: 'Missing encrypted payload' });

  try {
    const decoded = decodeMeshPayload(encryptedPayload);
    if (!decoded) {
      return res.status(400).json({ error: 'Invalid or corrupted mesh payload' });
    }

    const { lat, lng, timestamp, userId } = decoded;
    console.log(`[MESH RELAY via HTTP] Anonymous Relay ${relayDeviceId} bounced offline SOS!`);
    console.log(`[MESH RELAY] Decoded Victim: ${userId}, Lat: ${lat}, Lng: ${lng}, Time: ${timestamp}`);

    const incidentId = 'GLOBAL_TEST_INCIDENT';

    // 1. Instantly Broadcast to Police Dashboard (Zero Latency)
    const broadcastPayload = { 
      deviceUuid: userId, 
      incidentId: incidentId, 
      lat: lat, 
      lng: lng,
      timestamp: timestamp,
      trustStatus: 'ACTIVE',
      district: null,
      senderProfile: null,
      meshRelay: true,
      relayDeviceId: relayDeviceId
    };
    
    // Broadcast to room and globally via both events
    io.to(incidentId).emit('incident_location_updated', broadcastPayload);
    io.emit('incident_location_updated', broadcastPayload);
    io.emit('new_incident', broadcastPayload);

    // 2. Dispatch to nearby patrol officers on the mobile patrol app!
    dispatchToPatrolOfficers(incidentId, lat, lng, timestamp, { name: 'Offline BLE SOS Victim', phone_number: 'Mesh Bounced' });

    // 3. Safe DB insert (fire-and-forget, won't block the alert)
    try {
      await pool.query(`
        INSERT INTO incidents (id, device_uuid, legal_hold_state, legal_hold_expires_at)
        VALUES ($1, $2, 'AUTO_HELD', NOW() + INTERVAL '48 hours')
        ON CONFLICT (id) DO NOTHING
      `, [incidentId, userId]);
    } catch (dbErr) {
      console.warn('[MESH RELAY] DB insert skipped (pilot demo schema):', dbErr);
    }

    res.json({ success: true, message: 'Mesh Relay Processed' });
  } catch (e) {
    console.error('[MESH RELAY] Failed to process HTTP relay:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- PATROL OFFICER API (Signup / Login) ---
app.post('/api/patrol/login', async (req, res) => {
  const { phoneNumber, badgeNumber, name, stationName, pincode } = req.body;
  
  if (!phoneNumber || !badgeNumber) {
    return res.status(403).json({ error: 'Phone number and badge number are required' });
  }

  try {
    // Upsert the officer into the DB
    let result = await pool.query(`SELECT id, status FROM patrol_officers WHERE phone_number = $1`, [phoneNumber]);
    let officerId;
    let status;

    if (result.rows.length === 0) {
      if (!name || !stationName || !pincode) {
         return res.status(400).json({ error: 'Name, Station, and Pincode are required for new registration' });
      }
      // New signup
      const insert = await pool.query(`
        INSERT INTO patrol_officers (phone_number, badge_number, name, station_name, pincode, phone_verified, status)
        VALUES ($1, $2, $3, $4, $5, TRUE, 'PENDING') -- Simulated OTP success
        RETURNING id, status
      `, [phoneNumber, badgeNumber, name, stationName, pincode]);
      officerId = insert.rows[0].id;
      status = insert.rows[0].status;
    } else {
      officerId = result.rows[0].id;
      status = result.rows[0].status;
    }

    // Issue JWT
    const token = jwt.sign(
      { patrolId: officerId, role: 'PATROL' }, 
      process.env.JWT_SECRET as string, 
      { expiresIn: '24h' }
    );

    res.json({ token, status, officerId });
  } catch (e) {
    console.error('Patrol login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/patrol/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    if (decoded.role !== 'PATROL') return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query('SELECT name, badge_number, station_name, pincode, photo_base64, emergency_contact, status FROM patrol_officers WHERE id = $1', [decoded.patrolId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Officer not found' });
    res.json(result.rows[0]);
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

app.post('/api/patrol/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    if (decoded.role !== 'PATROL') return res.status(403).json({ error: 'Forbidden' });
    const { photoBase64, emergencyContact } = req.body;
    await pool.query('UPDATE patrol_officers SET photo_base64 = $1, emergency_contact = $2 WHERE id = $3', [photoBase64, emergencyContact, decoded.patrolId]);
    res.json({ success: true });
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

app.delete('/api/user/data', async (req, res) => {
  const signature = req.headers['x-thunai-signature'] as string;
  const timestamp = req.headers['x-thunai-timestamp'] as string;
  const { phone } = req.body;

  if (!signature || !timestamp || !phone) {
    return res.status(400).json({ error: 'Missing required HMAC signature headers or payload' });
  }

  // Prevent replay attacks (must be within 5 minutes)
  const now = Date.now();
  if (Math.abs(now - parseInt(timestamp)) > 5 * 60 * 1000) {
    return res.status(403).json({ error: 'Signature expired (replay protection)' });
  }

  const secretKey = 'thunai_secure_hmac_secret_2026';
  const payload = `${phone}:${timestamp}`;
  
  const expectedSignature = crypto
    .createHash('sha256')
    .update(`${payload}:${secretKey}`)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(403).json({ error: 'Invalid HMAC Signature. Unauthorized deletion request.' });
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`DELETE FROM civilian_profiles WHERE phone_number = $1 RETURNING phone_number`, [phone]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'User not found or already deleted' });
      }
      res.json({ message: 'Data permanently deleted per DPDP requirements. HMAC Verified.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error deleting user data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/device/:uuid', async (req, res) => {
  const { uuid } = req.params;
  let outcome = 'BLOCKED';
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Unconditionally delete identity data (Always deletable on request)
      await client.query(`DELETE FROM device_identity WHERE uuid = $1`, [uuid]);
      outcome = 'PARTIAL_IDENTITY_ONLY';

      // 2. Check for active legal holds on operational data
      const holdCheck = await client.query(`
        SELECT id FROM incidents 
        WHERE device_uuid = $1 AND legal_hold_state IN ('AUTO_HELD', 'DISPATCHER_HELD')
      `, [uuid]);

      const heldIncidents = holdCheck.rows.map(row => row.id);

      // 3. Cascade delete operational data ONLY if no active holds exist
      if (heldIncidents.length === 0) {
        await client.query(`DELETE FROM device_operational WHERE uuid = $1`, [uuid]);
        outcome = 'FULL';
      }

      // 4. Log the outcome to the audit table (Mandatory for DPDP compliance)
      await client.query(`
        INSERT INTO deletion_requests (device_uuid, outcome, held_incident_ids, notified_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `, [uuid, outcome, JSON.stringify(heldIncidents)]);

      await client.query('COMMIT');
      res.json({ message: 'Deletion request processed', outcome });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Deletion error:', e);
    res.status(500).json({ error: 'Failed to process deletion request' });
  }
});

// --- SOCKET.IO AUTHENTICATION MIDDLEWARE ---
// NEVER trust a client-asserted role. Validate via JWT.
io.use(async (socket, next) => {
  // We allow unauthenticated devices to connect (they only emit sos-alert)
  // But dispatchers and patrol MUST provide a token to join rooms
  const token = socket.handshake.auth?.token;
  const civilianPhone = socket.handshake.auth?.civilianPhone;
  
  if (civilianPhone) {
    socket.data.role = 'CIVILIAN';
    socket.data.phone = civilianPhone;
    socket.join(`civilian_${civilianPhone}`);
  }
  
  if (token) {
    if (!process.env.JWT_SECRET) return next(new Error('Server misconfiguration: missing JWT_SECRET'));
    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.role === 'PATROL') {
        // Enforce strict server-side Verification Check
        const result = await pool.query(`SELECT status FROM patrol_officers WHERE id = $1`, [decoded.patrolId]);
        if (result.rows.length === 0 || result.rows[0].status !== 'VERIFIED') {
          return next(new Error("unauthorized_patrol"));
        }
        socket.data.patrolId = decoded.patrolId;
      } else {
        socket.data.dispatcherId = decoded.dispatcherId;
      }
      
      socket.data.role = decoded.role; // Securely set by server
    } catch {
      return next(new Error("unauthorized")); // Tampered/Expired token
    }
  }
  
  next();
});


// --- SOCKET.IO REAL-TIME TRACKING ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Track Multi-session Active Patrol Sockets and join dispatch room
  if (socket.data.role === 'PATROL' && socket.data.patrolId) {
    const pId = socket.data.patrolId;
    socket.join(`patrol_${pId}`);
    if (!activePatrolSockets.has(pId)) {
      activePatrolSockets.set(pId, new Set());
    }
    activePatrolSockets.get(pId)!.add(socket);
    console.log(`[PATROL] Officer ${pId} joined dispatch channel patrol_${pId}`);
  }

  // Handle Patrol Location Pings (Overwrite-in-place + Geography update)
  socket.on('patrol_location_update', async (payload) => {
    if (socket.data.role !== 'PATROL' || !socket.data.patrolId) return;
    try {
      await pool.query(`
        UPDATE patrol_officers 
        SET lat = $1, lng = $2, 
            location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            is_on_duty = TRUE,
            last_active = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [payload.lat, payload.lng, socket.data.patrolId]);
    } catch (e) {
      console.error('Failed to update patrol location', e);
    }
  });

  // Handle Dispatch Claim (The Dibs System)
  socket.on('patrol_accept_dispatch', async (payload) => {
    if (socket.data.role !== 'PATROL' || !socket.data.patrolId) return;
    
    try {
      const officerCheck = await pool.query('SELECT name, badge_number FROM patrol_officers WHERE id = $1', [socket.data.patrolId]);
      if (officerCheck.rows.length === 0) return;
      const officer = officerCheck.rows[0];

      // Broadcast to Master Control Room Dashboard
      io.emit('incident_status_changed', {
        incidentId: payload.incidentId,
        status: 'ACTIVE',
        notes: `CLAIMED BY: Officer ${officer.name} (Badge: ${officer.badge_number})`
      });

      // Broadcast to all OTHER officers so their UNCLAIMED screen updates
      io.emit('dispatch_claimed_by_officer', {
        incidentId: payload.incidentId,
        officerName: officer.name,
        badgeNumber: officer.badge_number,
        claimerId: socket.data.patrolId
      });
      
      console.log(`[DISPATCH CLAIM] Officer ${officer.name} claimed incident ${payload.incidentId}`);
    } catch (e) {
      console.error('Failed to process dispatch claim', e);
    }
  });

  // Dispatcher joins incident room to listen
  socket.on('join_incident', async (payload) => {
    const { incidentId } = payload;
    
    // SECURITY CONSTRAINT: Only verified dispatchers can join location streams
    if (socket.data.role !== 'DISPATCHER') {
      console.warn(`Unauthorized join attempt by ${socket.id}`);
      return; // Silently reject
    }

    socket.join(incidentId);
    console.log(`Dispatcher ${socket.data.dispatcherId} joined incident ${incidentId}`);

    // STATE MACHINE: Transition from AUTO_HELD to DISPATCHER_HELD
    try {
      await pool.query(`
        UPDATE incidents 
        SET legal_hold_state = 'DISPATCHER_HELD', 
            legal_hold_expires_at = NULL, 
            legal_hold_set_by = $1, 
            legal_hold_set_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND legal_hold_state = 'AUTO_HELD'
      `, [socket.data.dispatcherId, incidentId]);
      console.log(`Converted incident ${incidentId} to DISPATCHER_HELD`);
    } catch (e) {
      console.error('Failed to convert hold state (DB might be offline during testing)', e);
    }
  });

  // Handle SOS Alert from Mobile App
  socket.on('sos-alert', async (payload) => {
    console.log('SOS ALERT RECEIVED FROM PHONE:', payload);
    const incidentId = 'GLOBAL_TEST_INCIDENT';
    
    // STATE MACHINE: Default to AUTO_HELD with 48h expiry
    try {
      await pool.query(`
        INSERT INTO incidents (id, device_uuid, legal_hold_state, legal_hold_expires_at)
        VALUES ($1, $2, 'AUTO_HELD', NOW() + INTERVAL '48 hours')
        ON CONFLICT (id) DO NOTHING
      `, [incidentId, payload.userId]);
    } catch (e) {
      console.error('Failed to insert AUTO_HELD state (DB might be offline during testing)', e);
    }
    
    // Fetch the sender's civilian profile to send to dashboard and trusted contacts
    let senderProfile = null;
    if (payload.senderPhone) {
      try {
        const profileResult = await pool.query('SELECT * FROM civilian_profiles WHERE phone_number = $1', [payload.senderPhone]);
        if (profileResult.rows.length > 0) {
          senderProfile = profileResult.rows[0];
        }
      } catch (e) {
        console.error('Failed to fetch civilian profile for dashboard broadcast', e);
      }
    }

    // 1. Instantly notify the dashboard (Zero Latency)
    const broadcastPayload = { 
      deviceUuid: payload.userId, 
      incidentId: incidentId, 
      lat: payload.latitude, 
      lng: payload.longitude,
      timestamp: payload.timestamp || new Date().toISOString(),
      trustStatus: 'ACTIVE',
      district: null, // Set to null initially
      senderProfile: senderProfile // Attach the civilian profile for the web dashboard!
    };
    io.to(incidentId).emit('incident_location_updated', broadcastPayload);

    // 2. Dispatch to Patrol Officers (PostGIS spatial query + testing fallback)
    await dispatchToPatrolOfficers(
      incidentId, 
      payload.latitude, 
      payload.longitude, 
      payload.timestamp || new Date().toISOString(), 
      senderProfile
    );

    // 2.5. Dispatch to Civilian Trusted Contacts (Peer-to-Peer Routing)
    try {
      if (payload.trustedContacts && Array.isArray(payload.trustedContacts)) {
        const civilianPayload = {
          incidentId: incidentId,
          lat: payload.latitude,
          lng: payload.longitude,
          timestamp: payload.timestamp || new Date().toISOString(),
          senderProfile: senderProfile
        };

        for (const phone of payload.trustedContacts) {
          // Emit to the specific civilian socket room
          io.to(`civilian_${phone}`).emit('trusted_sos_alert', civilianPayload);
          console.log(`Routed SOS to Trusted Civilian Contact: ${phone}`);
        }
      }
    } catch (e) {
      console.error('Failed to dispatch to trusted civilian contacts:', e);
    }

    // 3. FIRE-AND-FORGET: Async Reverse-Geocoding
    (async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${payload.latitude}&lon=${payload.longitude}`, {
          headers: { 'User-Agent': 'Thunai-Safety-App/1.0 (pilot demo)' }
        });
        const data: any = await response.json();
        
        // Normalize district name (e.g. "Chennai District" -> "Chennai")
        let districtName = data.address?.state_district || data.address?.city_district || "Unknown";
        districtName = districtName.replace(/district/i, '').trim();
        
        // Save to DB
        try {
          await pool.query(`UPDATE incidents SET district = $1 WHERE id = $2`, [districtName, incidentId]);
        } catch (e) {
          console.error('DB unavailable to save district');
        }

        // Broadcast district update
        io.to(incidentId).emit('incident_district_resolved', { incidentId, district: districtName });
      } catch (e) {
        console.error('Reverse Geocoding failed (Non-blocking):', e);
        io.to(incidentId).emit('incident_district_resolved', { incidentId, district: "Unknown" });
      }
    })();
  });

  // Handle Mesh Relay from Bystander Phones (Offline SOS forwarding via BLE)
  socket.on('mesh-relay', async (payload) => {
    console.log('[MESH RELAY via Socket] Received relay from bystander:', payload?.relayDeviceId);
    
    const { relayDeviceId, encryptedPayload, relayTimestamp } = payload || {};
    if (!encryptedPayload) return;

    try {
      const decoded = decodeMeshPayload(encryptedPayload);
      if (!decoded) {
        console.error('[MESH RELAY via Socket] Dropped invalid or corrupted mesh payload');
        return;
      }

      const { lat, lng, timestamp, userId } = decoded;
      console.log(`[MESH RELAY via Socket] Decoded: Victim=${userId}, Lat=${lat}, Lng=${lng}, Time=${timestamp}`);

      const incidentId = 'GLOBAL_TEST_INCIDENT';

      // 1. Blast the relayed SOS to the Police Dashboard instantly (Zero Latency)
      const broadcastPayload = { 
        deviceUuid: userId, 
        incidentId: incidentId, 
        lat: lat, 
        lng: lng,
        timestamp: timestamp,
        trustStatus: 'ACTIVE',
        district: null,
        senderProfile: null,
        meshRelay: true,
        relayDeviceId: relayDeviceId
      };
      
      io.to(incidentId).emit('incident_location_updated', broadcastPayload);
      io.emit('incident_location_updated', broadcastPayload);
      io.emit('new_incident', broadcastPayload);
      console.log(`[MESH RELAY] SOS broadcasted to Police Dashboard via incident_location_updated & new_incident!`);

      // 2. Dispatch to nearby patrol officers on the mobile patrol app!
      dispatchToPatrolOfficers(incidentId, lat, lng, timestamp, { name: 'Offline BLE SOS Victim', phone_number: 'Mesh Bounced' });

      // 3. Safe DB insert
      try {
        await pool.query(`
          INSERT INTO incidents (id, device_uuid, legal_hold_state, legal_hold_expires_at)
          VALUES ($1, $2, 'AUTO_HELD', NOW() + INTERVAL '48 hours')
          ON CONFLICT (id) DO NOTHING
        `, [incidentId, userId]);
      } catch (dbErr) {
        console.warn('[MESH RELAY] DB insert skipped (pilot demo schema):', dbErr);
      }
    } catch (e) {
      console.error('[MESH RELAY] Failed to process relay via socket:', e);
    }
  });

  // Handle Secure Disarm / Cancel from Mobile App
  socket.on('cancel-sos', async (payload) => {
    console.log('SOS CANCELLED BY PHONE:', payload);
    const incidentId = 'GLOBAL_TEST_INCIDENT'; // For pilot demo, we use the global ID

    // 1. Instantly notify the dashboard (Zero Latency)
    io.to(incidentId).emit('incident_status_changed', { 
      incidentId, 
      status: 'CANCELLED_BY_USER', 
      notes: 'Alarm disarmed securely from the device.' 
    });

    // 2. Fire-and-forget DB update
    try {
      await pool.query(`
        UPDATE incidents 
        SET status = 'CANCELLED_BY_USER', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [incidentId]);
    } catch (e) {
      console.error('Failed to cancel incident in DB:', e);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Remove from active map tracking
    if (socket.data.role === 'PATROL' && socket.data.patrolId) {
      const pSet = activePatrolSockets.get(socket.data.patrolId);
      if (pSet) {
        pSet.delete(socket);
        if (pSet.size === 0) activePatrolSockets.delete(socket.data.patrolId);
      }
    }
  });
});

const PORT = process.env.PORT || 4001;
httpServer.listen(PORT, async () => {
  console.log(`Backend server listening on port ${PORT}`);
  // DB init re-enabled to run schema migrations automatically
  try {
    await initDb();
  } catch (e) {
    console.error('Failed to init DB schemas:', e);
  }
});
