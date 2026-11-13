const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    campusClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampusClass",
      default: null ,
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
  { timestamps: true, autoIndex: false },
);

attendanceSchema.index(
  { campusClass: 1, student: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { campusClass: { $type: "objectId" } },
    name: "uniq_attendance_class_student_date",
  },
);
attendanceSchema.index({ student: 1, date: -1 });
attendanceSchema.index({ campusClass: 1, date: -1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
