const { Pool } = require('pg'); 
const pool = new Pool({ user: 'postgres', host: 'localhost', database: 'postgres', password: 'password', port: 5432 }); 
(async () => { 
  try { 
    const r = await pool.query('SELECT id, status FROM patrol_officers WHERE phone_number = $1', ['1234567890']); 
    console.log('SELECT OK:', r.rows); 
  } catch (e) { 
    console.error('SELECT ERR:', e.message); 
  } 
  try { 
    const r2 = await pool.query('INSERT INTO patrol_officers (phone_number, badge_number, phone_verified, status) VALUES ($1, $2, TRUE, $3) RETURNING id, status', ['1234567890', 'G7Y792', 'PENDING']); 
    console.log('INSERT OK:', r2.rows); 
  } catch (e) { 
    console.error('INSERT ERR:', e.message); 
  } finally { 
    pool.end(); 
  } 
})();
