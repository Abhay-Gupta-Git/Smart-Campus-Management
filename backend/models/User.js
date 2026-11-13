const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true ,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["student", "faculty", "technician", "admin"],
      default: "student",
    },
    studentId: {
      type: String,
      default: null,
      maxlength: 64,
    },
    department: {
      type: String,
      default: null,
      maxlength: 120,
    },
    phone: {
      type: String,
      default: "",
      maxlength: 30,
    },
    tokenVersion: { type: Number, default: 0, select: false, min: 0 },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, name: 1 });

module.exports = mongoose.model("User", userSchema);
