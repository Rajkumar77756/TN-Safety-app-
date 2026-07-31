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

    // Devices table (UUID instead of IMEI)
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        uuid UUID PRIMARY KEY,
        auth_key VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Incidents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY,
        device_uuid UUID REFERENCES devices(uuid) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        legal_hold BOOLEAN DEFAULT false, -- Used to block DPDP deletion for open law enforcement cases
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
