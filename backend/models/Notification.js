const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  complaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", default: null },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
