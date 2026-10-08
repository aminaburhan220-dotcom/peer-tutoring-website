const db = require('../database/db');

const insertLog = db.prepare('INSERT INTO activity_logs (type, description) VALUES (?,?)');

// Records a system event for the admin "Activity Logs" page. Best-effort:
// logging should never be the reason a real user action fails, so any error
// here is swallowed after being printed to the server console.
async function logActivity(type, description) {
  try {
    await insertLog.run(type, description);
  } catch (err) {
    console.error('Failed to record activity log:', err.message);
  }
}

module.exports = { logActivity };
