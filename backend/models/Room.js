const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    building: { type: String, required: true },
    capacity: { type: Number, default: 30 },
    type: { type: String, default: "Classroom" },
    facilities: [String],
    available: { type: Boolean, default: true },
  },
  { timestamps: true } ,
);

module.exports = mongoose.model("Room", roomSchema);
