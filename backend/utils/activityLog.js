const ActivityLog = require("../models/ActivityLog");

async function recordActivity({ actor, action, entityType, entityId, summary }) {
  try {
    await ActivityLog.create({ actor, action, entityType, entityId, summary });
  } catch (error) {
    console.error("Activity log write failed:", JSON.stringify({
      event: "activity_log_write_failed",
      action,
      entityType,
      entityId: entityId?.toString(),
      error: error.name || "Error",
      code: error.code || "unknown",
    }));
  }
}

module.exports = recordActivity;
