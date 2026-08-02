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
io.use((socket, next) => {
  // We allow unauthenticated devices to connect (they only emit sos-alert)
  // But dispatchers MUST provide a token to join rooms
  const token = socket.handshake.auth?.token;
  
  if (token) {
    if (!process.env.JWT_SECRET) return next(new Error('Server misconfiguration: missing JWT_SECRET'));
    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.dispatcherId = decoded.dispatcherId;
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
    
    // 1. CRITICAL PATH: Broadcast directly to the dashboard immediately (Zero Latency)
    const broadcastPayload = { 
      deviceUuid: payload.userId, 
      incidentId: incidentId, 
      lat: payload.latitude, 
      lng: payload.longitude,
      trustStatus: 'ACTIVE',
      district: null // Set to null initially
    };
    
    // SECURITY CONSTRAINT: incident_location_updated is one-way
    io.to(incidentId).emit('incident_location_updated', broadcastPayload);
    
    // 2. FIRE-AND-FORGET: Async Reverse-Geocoding
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

    try {
      // Update DB to mark as cancelled by user
      await pool.query(`
        UPDATE incidents 
        SET status = 'CANCELLED_BY_USER', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [incidentId]);

      // Immediately notify the dashboard
      io.to(incidentId).emit('incident_status_changed', { 
        incidentId, 
        status: 'CANCELLED_BY_USER', 
        notes: 'Alarm disarmed securely from the device.' 
      });
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
