import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Standard PostgreSQL pool for geospatial incident tracking using PostGIS
const poolConfig: any = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Required for Supabase/Render
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      port: parseInt(process.env.DB_PORT || '5432', 10),
    };

export const pool = new Pool(poolConfig);

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
        district VARCHAR(100), -- Populated asynchronously via reverse-geocoding
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

    // Core Incidents Schema with Legal Hold
    await client.query(`
      CREATE TABLE IF NOT EXISTS civilian_profiles (
        phone_number VARCHAR(20) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        age INTEGER,
        current_address TEXT,
        workplace_details TEXT,
        photo_base64 TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id VARCHAR(255) PRIMARY KEY,
        device_uuid VARCHAR(255) NOT NULL,
        district VARCHAR(255),
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        legal_hold_state VARCHAR(50) DEFAULT 'NONE',
        legal_hold_expires_at TIMESTAMP
      );
    `);

    // Enable PostGIS for spatial routing
    await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // Patrol Officers Schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patrol_officers (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(50) UNIQUE NOT NULL,
        badge_number VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, VERIFIED, REJECTED, REVOKED
        phone_verified BOOLEAN DEFAULT FALSE,
        is_on_duty BOOLEAN DEFAULT FALSE,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Admin Audit Logs for verification transparency
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id SERIAL PRIMARY KEY,
        admin_id VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        target_officer_id INT REFERENCES patrol_officers(id),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Dispatch Log for Audit & Legal Hold retention
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_log (
        id SERIAL PRIMARY KEY,
        officer_id INT REFERENCES patrol_officers(id),
        incident_id VARCHAR(255) REFERENCES incidents(id),
        notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        arrived_at TIMESTAMP
      );
    `);
    
    // Automatic Migrations
    try {
      await pool.query(`ALTER TABLE patrol_officers RENAME COLUMN email TO phone_number;`);
      await pool.query(`ALTER TABLE patrol_officers RENAME COLUMN email_verified TO phone_verified;`);
    } catch (e) {
      // Ignore
    }

    try {
      await pool.query(`ALTER TABLE patrol_officers ADD COLUMN location geography(Point, 4326);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS patrol_location_gist ON patrol_officers USING GIST (location);`);
    } catch (e) {
      // Ignore if already exists
    }

    console.log('PostgreSQL Database tables verified successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    client.release();
  }
};
