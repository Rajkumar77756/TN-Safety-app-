import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../models/db';
import crypto from 'crypto';

const router = Router();

// Device Registration
router.post('/register', async (req, res) => {
  try {
    const deviceUuid = uuidv4();
    const authKey = crypto.randomBytes(32).toString('hex');

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO devices (uuid, auth_key) VALUES ($1, $2)`,
        [deviceUuid, authKey]
      );
      res.json({ uuid: deviceUuid, key: authKey });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error in /register:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// DPDP Act: Consent Withdrawal & Data Deletion
// Must truly cascade delete and purge all records, not soft-delete
router.delete('/data', async (req, res) => {
  const { uuid, signature } = req.body;
  // TODO: Verify HMAC signature using the stored authKey before allowing deletion

  const client = await pool.connect();
  try {
    // Check for open law enforcement holds first
    const holdCheck = await client.query(
      `SELECT COUNT(*) FROM incidents WHERE device_uuid = $1 AND legal_hold = true`,
      [uuid]
    );
    
    if (parseInt(holdCheck.rows[0].count, 10) > 0) {
      return res.status(403).json({ 
        error: 'Deletion deferred: Account has active incidents under legal hold for law enforcement.' 
      });
    }

    // A single DELETE on the devices table will CASCADE delete incidents, 
    // locations, and false_alarms due to the FOREIGN KEY ... ON DELETE CASCADE constraints.
    // If you had S3 signed-URLs or media pointers, you would query them here and delete 
    // from the S3 bucket before wiping the DB record.
    
    const result = await client.query(
      `DELETE FROM devices WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found or already deleted' });
    }

    res.json({ message: 'Data permanently deleted per DPDP requirements.' });
  } catch (err) {
    console.error('Error deleting data:', err);
    res.status(500).json({ error: 'Deletion failed' });
  } finally {
    client.release();
  }
});

export default router;
