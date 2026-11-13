const mongoose = require("mongoose");

const complaintHistorySchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 100 },
  note: { type: String, trim: true, maxlength: 2000, default: "" },
  fromStatus: { type: String },
  toStatus: { type: String },
  evidence: [{ type: String, maxlength: 1000 }],
  createdAt: { type: Date, default: Date.now },
});

const complaintSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, default: "General" },
    status: {
      type: String,
      enum: ["Open", "In progress", "Pending Verification", "Resolved", "Closed"],
      default: "Open" ,
    },
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null },
    equipment: { type: String, enum: ["Fan", "AC", "Projector", "Light", null], default: null },
    priority: { type: String, enum: ["Low", "Normal", "High", "Urgent"], default: "Normal", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolutionDetails: { type: String, trim: true, maxlength: 3000, default: "" },
    resolutionEvidence: [{ type: String, maxlength: 1000 }],
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    verificationNote: { type: String, trim: true, maxlength: 2000, default: "" },
    history: { type: [complaintHistorySchema], default: [] },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

complaintSchema.index({ createdAt: -1 });
complaintSchema.index({ submittedBy: 1, createdAt: -1 });
complaintSchema.index({ room: 1, status: 1, createdAt: -1 });
complaintSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
complaintSchema.index({ verifiedBy: 1 });
complaintSchema.index({ "history.actor": 1 });

module.exports = mongoose.model("Complaint", complaintSchema);
