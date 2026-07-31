import { pool } from '../models/db';

const FALSE_ALARM_THRESHOLD = 3; // Number of false alarms before requiring human review
const COOLDOWN_HOURS = 24;

export const recordFalseAlarm = async (deviceUuid: string, incidentId: string) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO false_alarms (device_uuid, incident_id) VALUES ($1, $2)`,
      [deviceUuid, incidentId]
    );

    // Check if we reached the threshold
    const result = await client.query(
      `SELECT COUNT(*) FROM false_alarms 
       WHERE device_uuid = $1 
       AND recorded_at >= NOW() - INTERVAL '${COOLDOWN_HOURS} hours'`,
      [deviceUuid]
    );

    const count = parseInt(result.rows[0].count, 10);
    if (count >= FALSE_ALARM_THRESHOLD) {
      // Flag device for human review instead of permanent silent blacklisting
      await client.query(
        `UPDATE devices SET status = 'NEEDS_REVIEW' WHERE uuid = $1`,
        [deviceUuid]
      );
      console.warn(`Device ${deviceUuid} flagged for human review due to multiple false alarms.`);
      return { status: 'needs_review', count };
    }

    return { status: 'active', count };
  } catch (error) {
    console.error('Error recording false alarm:', error);
    throw error;
  } finally {
    client.release();
  }
};

export const checkDeviceStatus = async (deviceUuid: string) => {
  const result = await pool.query(`SELECT status FROM devices WHERE uuid = $1`, [deviceUuid]);
  if (result.rows.length === 0) return 'UNKNOWN';
  return result.rows[0].status; // e.g. 'ACTIVE', 'NEEDS_REVIEW', 'BLACKLISTED'
};
