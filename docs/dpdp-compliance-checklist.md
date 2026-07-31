# DPDP Act Compliance Checklist

- [x] **Plain-language notice:** Clear breakdown of what, why, and retention period.
- [x] **Itemized Consent:** Permissions are asked contextually, not bundled.
- [x] **Purpose Limitation:** Data is only used for SOS routing and abuse prevention. No IMEI collection.
- [x] **Withdrawal & Deletion Flow:** "Delete My Data" triggers a backend API (`DELETE /api/auth/data`) that cascade-deletes all records (devices, incidents, locations) permanently.
- [x] **Breach Notification Duty:** (Operational) Backend logs require monitoring for the 72-hour reporting duty.
