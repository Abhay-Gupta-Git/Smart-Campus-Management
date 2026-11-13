const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, trim: true, maxlength: 120 },
  entityType: { type: String, required: true, enum: ["booking", "room", "class", "complaint"] },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  summary: { type: String, required: true, trim: true, maxlength: 300 },
}, { timestamps: true });

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
