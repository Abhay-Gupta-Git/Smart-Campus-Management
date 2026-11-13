const mongoose = require("mongoose");
const Notification = require("../models/Notification");

async function createNotifications({ recipients, title, message, entityType, entityId, targetPage, eventId }) {
  if (typeof eventId !== "string" || !eventId.trim()) {
    console.error("Notification write skipped:", JSON.stringify({ event: "notification_event_key_missing", entityType, entityId: entityId?.toString() }));
    return;
  }
  const ids = [...new Set((recipients || []).filter(Boolean).map((id) => id.toString()))]
    .filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return;

  const records = ids.map((recipient) => ({
    recipient,
    title,
    message,
    entityType,
    entityId,
    targetPage,
    complaint: entityType === "complaint" ? entityId : null,
    dedupeKey: `${eventId}:${recipient}`.slice(0, 200),
  }));

  try {
    await Notification.insertMany(records, { ordered: false });
  } catch (error) {
    const writeErrors = error.writeErrors || error.result?.getWriteErrors?.() || [];
    const codes = writeErrors.map((item) => item.code || item.err?.code);
    const nonDuplicateFailure = codes.some((code) => code !== 11000) || (!codes.length && error.code !== 11000);
    if (nonDuplicateFailure) {
      console.error("Notification write failed:", JSON.stringify({
        event: "notification_write_failed",
        entityType,
        entityId: entityId?.toString(),
        recipientCount: ids.length,
        error: error.name || "Error",
        code: error.code || "unknown",
      }));
    }
  }
}

module.exports = { createNotifications };
