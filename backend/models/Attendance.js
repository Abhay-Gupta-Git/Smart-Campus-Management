const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    campusClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampusClass",
      default: null,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: { type: String, required: true },
    status: {
      type: String,
      enum: ["present", "absent", "late"],
      required: true,
    },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Attendance", attendanceSchema);
