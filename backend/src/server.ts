import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
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
app.use(express.json());

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
    const result = await pool.query(`SELECT id, email, badge_number, status, last_active FROM patrol_officers ORDER BY id DESC`);
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

// --- PATROL OFFICER API (Signup / Login) ---
app.post('/api/patrol/login', async (req, res) => {
  const { phoneNumber, badgeNumber } = req.body;
  
  if (!phoneNumber || !badgeNumber) {
    return res.status(403).json({ error: 'Phone number and badge number are required' });
  }

  try {
    // Upsert the officer into the DB
    let result = await pool.query(`SELECT id, status FROM patrol_officers WHERE phone_number = $1`, [phoneNumber]);
    let officerId;
    let status;

    if (result.rows.length === 0) {
      // New signup
      const insert = await pool.query(`
        INSERT INTO patrol_officers (phone_number, badge_number, phone_verified, status)
        VALUES ($1, $2, TRUE, 'PENDING') -- Simulated OTP success
        RETURNING id, status
      `, [phoneNumber, badgeNumber]);
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
    
    // 1. Instantly notify the dashboard (Zero Latency)
    const broadcastPayload = { 
      deviceUuid: payload.userId, 
      incidentId: incidentId, 
      lat: payload.latitude, 
      lng: payload.longitude,
      timestamp: payload.timestamp || new Date().toISOString(),
      trustStatus: 'ACTIVE',
      district: null // Set to null initially
    };
    io.to(incidentId).emit('incident_location_updated', broadcastPayload);

    // 2. Dispatch to Patrol Officers (PostGIS spatial query)
    try {
      const nearestOfficers = await pool.query(`
        SELECT id, email, badge_number 
        FROM patrol_officers 
        WHERE status = 'VERIFIED' AND is_on_duty = TRUE
        AND lat IS NOT NULL AND lng IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
          5000 -- 5km radius in meters
        )
      `, [payload.longitude, payload.latitude]);

      // Emit strictly minimized payload to nearby officers
      nearestOfficers.rows.forEach(officer => {
        io.to(`patrol_${officer.id}`).emit('dispatch_patrol', {
          incidentId: incidentId,
          lat: payload.latitude,
          lng: payload.longitude
        });
        console.log(`Dispatched SOS to Officer Badge: ${officer.badge_number}`);
      });
    } catch (e) {
      console.error('Failed to dispatch to patrol officers via PostGIS:', e);
    }

    // 3. FIRE-AND-FORGET: Async Reverse-Geocoding
    (async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${payload.latitude}&lon=${payload.longitude}`, {
          headers: { 'User-Agent': 'Raksha-Safety-App/1.0 (pilot demo)' }
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
  });
});

const PORT = process.env.PORT || 4001;
httpServer.listen(PORT, async () => {
  console.log(`Backend server listening on port ${PORT}`);
  // DB init bypassed for local tunnel testing
  // await initDb();
});
