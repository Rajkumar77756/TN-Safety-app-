import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Standard PostgreSQL pool for geospatial incident tracking using PostGIS
export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres', // Changed to 'postgres' default for local Docker testing
  password: process.env.DB_PASSWORD || 'password',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Initialize tables if they don't exist
export const initDb = async () => {
  const client = await pool.connect();
  try {
    // Requires PostGIS extension installed in the DB
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // Dispatchers table (Auth)
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatchers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Device Identity (Highly sensitive, always deletable on request)
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_identity (
        uuid UUID PRIMARY KEY,
        phone_number VARCHAR(50),
        trusted_contacts JSONB,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Device Operational (Pseudonymous, subject to legal holds)
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_operational (
        uuid UUID PRIMARY KEY REFERENCES device_identity(uuid) ON DELETE CASCADE,
        auth_key_hash VARCHAR(255) NOT NULL,
        false_alarm_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'ACTIVE'
      );
    `);

    // Incidents table (with State Machine)
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_uuid UUID REFERENCES device_operational(uuid) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        legal_hold_state VARCHAR(50) DEFAULT 'NONE', -- NONE, AUTO_HELD, DISPATCHER_HELD, RELEASED
        legal_hold_expires_at TIMESTAMP,
        legal_hold_set_by UUID REFERENCES dispatchers(id),
        legal_hold_set_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Location Tracking table (PostGIS geometry)
    await client.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
        geom GEOMETRY(Point, 4326),
        battery_pct INTEGER,
        tier VARCHAR(20), -- 'ONLINE', 'SMS', 'MESH'
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Deletion Requests Audit Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS deletion_requests (
        id SERIAL PRIMARY KEY,
        device_uuid UUID NOT NULL,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        outcome VARCHAR(50) NOT NULL, -- FULL, PARTIAL_IDENTITY_ONLY, BLOCKED
        held_incident_ids JSONB,
        notified_at TIMESTAMP
      );
    `);

    // False Alarms table for abuse prevention
    await client.query(`
      CREATE TABLE IF NOT EXISTS false_alarms (
        id SERIAL PRIMARY KEY,
        device_uuid UUID REFERENCES devices(uuid) ON DELETE CASCADE,
        incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Database schemas initialized successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    client.release();
  }
};
