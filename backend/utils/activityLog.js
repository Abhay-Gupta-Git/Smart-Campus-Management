const ActivityLog = require("../models/ActivityLog");

async function recordActivity({ actor, action, entityType, entityId, summary }) {
  try {
    await ActivityLog.create({ actor, action, entityType, entityId, summary });
  } catch (error) {
    // Activity capture must not make a successful core operation appear to fail.
    console.error("Activity log write failed:", error.name || "Error");
  }
}

module.exports = recordActivity;
