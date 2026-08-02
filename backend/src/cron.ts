import cron from 'node-cron';
import { pool } from './models/db';

// Background Job: Hourly Sweep of Expired Legal Holds
// This returns unacknowledged incidents back to regular DPDP deletability
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Starting hourly sweep of expired legal holds...');
  
  try {
    const result = await pool.query(`
      UPDATE incidents 
      SET legal_hold_state = 'RELEASED' 
      WHERE legal_hold_state = 'AUTO_HELD' 
        AND legal_hold_expires_at <= NOW()
      RETURNING id;
    `);

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[CRON] Swept ${result.rowCount} expired incidents to RELEASED state.`);
    } else {
      console.log(`[CRON] No expired holds found.`);
    }
  } catch (e) {
    console.error('[CRON] Failed to sweep expired holds:', e);
  }
});

console.log('Background cron jobs registered.');
