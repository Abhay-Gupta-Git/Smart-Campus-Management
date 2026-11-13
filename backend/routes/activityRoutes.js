const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const Booking = require("../models/Booking");
const CampusClass = require("../models/CampusClass");
const Complaint = require("../models/Complaint");
const { protect } = require("../middleware/authMiddleware");
const { readPagination, executeListQuery } = require("../utils/pagination");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  try {
    let filter = {};
    if (req.user.role !== "admin") {
      const userId = req.user.id;
      const classFilter = req.user.role === "faculty"
        ? { faculty: userId }
        : req.user.role === "student"
          ? { enrolledStudents: userId }
          : { _id: { $exists: false } };
      const complaintFilter = req.user.role === "technician"
        ? { assignedTo: userId }
        : req.user.role === "faculty"
          ? { $or: [{ submittedBy: userId }, { room: { $ne: null }, status: "Pending Verification" }] }
          : { submittedBy: userId };
      const [bookings, classes, complaints] = await Promise.all([
        Booking.find({ bookedBy: userId }).select("_id room").lean(),
        CampusClass.find(classFilter).select("_id room").lean(),
        Complaint.find(complaintFilter).select("_id room").lean(),
      ]);

      const branches = [{ actor: userId }];
      if (bookings.length) branches.push({ entityType: "booking", entityId: { $in: bookings.map((item) => item._id) } });
      if (classes.length) branches.push({ entityType: "class", entityId: { $in: classes.map((item) => item._id) } });
      if (complaints.length) branches.push({ entityType: "complaint", entityId: { $in: complaints.map((item) => item._id) } });
      const relatedRoomIds = [...new Set([...bookings, ...classes, ...complaints].map((item) => item.room?.toString()).filter(Boolean))];
      if (relatedRoomIds.length) branches.push({ entityType: "room", entityId: { $in: relatedRoomIds } });
      filter = { $or: branches };
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const query = ActivityLog.find(filter)
      .populate("actor", "name role")
      .sort({ createdAt: -1 })
      .lean();
    if (!pagination) query.limit(200);
    const activities = await executeListQuery({ query, Model: ActivityLog, filter, pagination, res });
    return res.json(activities);
  } catch (error) {
    console.error("Activity history request failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load activity history." });
  }
});

module.exports = router;
