const { Pool } = require('pg'); 
const pool = new Pool({ connectionString: 'postgresql://postgres.vyuczkilyivbnevkrtnj:Rajrohit123%23@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres', ssl: { rejectUnauthorized: false } }); 
pool.query("DELETE FROM patrol_officers WHERE phone_number = '1234567890'").then(r => console.log('DELETED DUMMY ROW', r.rowCount)).catch(console.error).finally(() => pool.end());
