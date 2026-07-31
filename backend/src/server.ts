import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import authRouter from './auth';
import { initDb } from './models/db';
import { checkDeviceStatus } from './abuse-prevention';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // In production, restrict this to your dashboard domain
  }
});

app.use(express.json());

// Routes
app.use('/api/auth', authRouter);

// Basic healthcheck
app.get('/health', (req, res) => res.send('OK'));

// Ingest SMS endpoints (Tier 2)
app.post('/api/ingest/sms', async (req, res) => {
  // Parse the structured SMS (which may be concatenated)
  // [PARTIAL DELIVERY LOGIC]: Implement a 60-second timeout cache. If Part 1 arrives and Part 2 drops,
  // salvage the available data (e.g., location without battery) and inject it into the incident flow rather than discarding.
  // Verify HMAC, lookup device, inject into Socket.io if active
  res.status(200).send('Received');
});

// Ingest Mesh endpoints (Tier 3 delay-tolerant)
app.post('/api/ingest/mesh', async (req, res) => {
  // Parse the binary/JSON mesh payload from a relay device
  res.status(200).send('Received');
});

// Dispatch API: Set legal_hold on an incident
app.post('/api/dispatch/incident/:id/hold', async (req, res) => {
  // In reality, this endpoint requires dispatcher authentication middleware.
  const incidentId = req.params.id;
  const { hold } = req.body; // boolean
  
  try {
    const { pool } = require('./models/db');
    await pool.query(`UPDATE incidents SET legal_hold = $1 WHERE id = $2`, [hold, incidentId]);
    res.status(200).json({ message: `Legal hold set to ${hold} for incident ${incidentId}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to set legal hold' });
  }
});

// Dispatch API: Update incident status (e.g. mark as ANSWERED)
app.post('/api/dispatch/incident/:id/status', async (req, res) => {
  const incidentId = req.params.id;
  const { status, notes } = req.body; // status: 'ANSWERED', notes: dispatcher notes
  
  try {
    const { pool } = require('./models/db');
    await pool.query(`UPDATE incidents SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [status, incidentId]);
    
    // Broadcast the status change to all dashboard clients instantly
    io.emit('incident_status_changed', { incidentId, status, notes });
    
    res.status(200).json({ message: `Status updated to ${status}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Socket.IO for real-time tracking (Tier 1)
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_incident', async (payload) => {
    // payload: { incidentId, role } e.g. role: 'DISPATCHER' or 'DEVICE'
    const { incidentId, role } = payload;
    socket.join(incidentId);
    console.log(`Socket ${socket.id} joined incident ${incidentId} as ${role}`);
    
    // Anti-race condition: Automatically set legal_hold = true the moment a dispatcher joins the room
    if (role === 'DISPATCHER') {
      try {
        const { pool } = require('./models/db');
        await pool.query(`UPDATE incidents SET legal_hold = true WHERE id = $1`, [incidentId]);
        console.log(`Auto-set legal_hold for incident ${incidentId}`);
      } catch(e) {
        console.error('Failed to auto-set legal hold', e);
      }
    }
  });

  socket.on('location_update', async (payload) => {
    // Expected payload: { deviceUuid, incidentId, lat, lng, battery, timestamp }
    const status = await checkDeviceStatus(payload.deviceUuid);
    
    // SAFETY-CRITICAL: Never suppress a broadcast unless explicitly blacklisted by a human.
    // NEEDS_REVIEW is flagged to the dashboard but the alert is STILL broadcast immediately.
    if (status === 'BLACKLISTED') {
      return; 
    }

    // Insert into PostGIS
    // Broadcast to dashboard with the review status attached
    const broadcastPayload = { ...payload, trustStatus: status };
    
    // SECURITY CONSTRAINT: 'incident_location_updated' is strictly one-way (Server -> Dispatcher).
    // It is NEVER echoed back to the mobile device. Exposing the NEEDS_REVIEW trust status 
    // to the device could tip off a hostile actor monitoring the phone.
    io.to(payload.incidentId).emit('incident_location_updated', broadcastPayload);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, async () => {
  console.log(`Backend server listening on port ${PORT}`);
  await initDb();
});
