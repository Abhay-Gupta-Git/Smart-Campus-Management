const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  complaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", default: null },
  entityType: { type: String, enum: ["booking", "room", "class", "complaint", "attendance", "notice", "account"], default: null },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  targetPage: { type: String, enum: ["Room bookings", "Classrooms", "Classes", "Attendance", "Complaints", "Notices", "Students", "Faculty", "Technicians", "Activity history"], default: null },
  dedupeKey: { type: String, maxlength: 200, select: false },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true, name: "dedupeKey_1" });

module.exports = mongoose.model("Notification", notificationSchema);
