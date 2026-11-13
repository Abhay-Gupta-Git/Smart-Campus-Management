const mongoose = require("mongoose");

const equipmentSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ["Fan", "AC", "Projector", "Light"] },
  status: { type: String, required: true, enum: ["Working", "Not Working", "Needs Maintenance"] },
  note: { type: String, trim: true, maxlength: 500, default: "" },
  inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", select: false },
  inspectedAt: { type: Date },
}, { _id: false });

const inspectionHistorySchema = new mongoose.Schema({
  equipment: { type: [equipmentSchema], default: [] },
  recordedAt: { type: Date, default: Date.now },
}, { _id: false });

const roomSchema = new mongoose.Schema(
  {
    // `name` remains the stored room number because classes and bookings
    // already reference it as `room.name`.
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 30 },
    building: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    floor: { type: Number, required: true, min: 0, max: 200, default: 0 },
    capacity: { type: Number, required: true, min: 1, max: 10000, default: 30 },
    type: { type: String, required: true, trim: true, enum: ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"], default: "Classroom" },
    facilities: [String],
    equipment: { type: [equipmentSchema], default: [] },
    maintenanceHold: { type: Boolean, default: false },
    inspectionHistory: { type: [inspectionHistorySchema], default: [], select: false },
    available: { type: Boolean, default: true },
    scheduleVersion: { type: Number, default: 0, select: false },
    referenceVersion: { type: Number, default: 0, select: false },
    buildingKey: { type: String, select: false },
    roomNumberKey: { type: String, select: false },
  },
  { timestamps: true },
);

roomSchema.virtual("operationalStatus").get(function getOperationalStatus() {
  const requiredEquipment = ["Fan", "AC", "Projector", "Light"];
  const byType = new Map((this.equipment || []).map((item) => [item.type, item]));
  if (this.maintenanceHold) return "Maintenance required";
  if (requiredEquipment.some((type) => !byType.has(type))) return "Not inspected";
  if (requiredEquipment.some((type) => byType.get(type).status !== "Working")) return "Maintenance required";
  return "Operational";
});
roomSchema.set("toJSON", { virtuals: true });
roomSchema.set("toObject", { virtuals: true });

roomSchema.index(
  { buildingKey: 1, roomNumberKey: 1 },
  {
    unique: true,
    partialFilterExpression: { buildingKey: { $type: "string" }, roomNumberKey: { $type: "string" } },
  },
);

roomSchema.pre("validate", function normalizeRoomKeys(next) {
  if (this.building) this.building = this.building.trim();
  if (this.name) this.name = this.name.trim();
  this.set("buildingKey", this.building?.toLocaleLowerCase());
  this.set("roomNumberKey", this.name?.toLocaleLowerCase());
  next();
});

module.exports = mongoose.model("Room", roomSchema);
