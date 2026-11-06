const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : { user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost', database: process.env.DB_NAME || 'postgres', password: process.env.DB_PASSWORD || 'password', port: parseInt(process.env.DB_PORT || '5432', 10) });

async function alter() {
  try {
    await pool.query('ALTER TABLE patrol_officers ADD COLUMN name VARCHAR(100) DEFAULT \'Unknown\'');
    await pool.query('ALTER TABLE patrol_officers ADD COLUMN station_name VARCHAR(255) DEFAULT \'Unknown\'');
    await pool.query('ALTER TABLE patrol_officers ADD COLUMN pincode VARCHAR(20) DEFAULT \'000000\'');
    console.log('Columns added successfully');
  } catch (e) {
    console.error('Alter failed', e.message);
  } finally {
    process.exit(0);
  }
}

alter();
