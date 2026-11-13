const express = require("express");
const mongoose = require("mongoose");
const ActivityLog = require("../models/ActivityLog");
const Attendance = require("../models/Attendance");
const Booking = require("../models/Booking");
const CampusClass = require("../models/CampusClass");
const Complaint = require("../models/Complaint");
const Notice = require("../models/Notice");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  try {
    let filter = {};
    if (req.query.recordId !== undefined && !mongoose.isValidObjectId(req.query.recordId)) {
      return res.status(400).json({ message: "Record filter is invalid." });
    }
    if (req.query.recordId !== undefined) filter.entityId = req.query.recordId;
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
      const [bookings, classes, complaints, notices] = await Promise.all([
        Booking.find({ bookedBy: userId }).select("_id room").lean(),
        CampusClass.find(classFilter).select("_id room").lean(),
        Complaint.find(complaintFilter).select("_id room").lean(),
        Notice.find({ $or: [{ audience: "all" }, { audience: req.user.role }] }).select("_id").lean(),
      ]);
      const attendance = req.user.role === "student"
        ? await Attendance.find({ student: userId }).select("_id").lean()
        : req.user.role === "faculty" && classes.length
          ? await Attendance.find({ campusClass: { $in: classes.map((item) => item._id) } }).select("_id").lean()
          : [];

      const branches = [{ actor: userId }, { entityType: "account", entityId: userId }];
      if (bookings.length) branches.push({ entityType: "booking", entityId: { $in: bookings.map((item) => item._id) } });
      if (classes.length) branches.push({ entityType: "class", entityId: { $in: classes.map((item) => item._id) } });
      if (complaints.length) branches.push({ entityType: "complaint", entityId: { $in: complaints.map((item) => item._id) } });
      if (attendance.length) branches.push({ entityType: "attendance", entityId: { $in: attendance.map((item) => item._id) } });
      if (notices.length) branches.push({ entityType: "notice", entityId: { $in: notices.map((item) => item._id) } });
      const relatedRoomIds = [...new Set([...bookings, ...classes, ...complaints].map((item) => item.room?.toString()).filter(Boolean))];
      if (relatedRoomIds.length) branches.push({ entityType: "room", entityId: { $in: relatedRoomIds } });
      filter = { $and: [{ $or: branches }, ...(req.query.recordId !== undefined ? [{ entityId: req.query.recordId }] : [])] };
    } else if (req.query.recordId !== undefined) {
      filter = { entityId: req.query.recordId };
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const actorIds = await User.find({ name: regex }).distinct("_id");
      const searchFilter = { $or: [
        { action: regex }, { summary: regex }, { entityType: regex },
        ...(actorIds.length ? [{ actor: { $in: actorIds } }] : []),
      ] };
      filter = Object.keys(filter).length ? { $and: [filter, searchFilter] } : searchFilter;
    }
    const sort = readSort(req, res, ["createdAt", "action", "entityType"], "createdAt", "desc");
    if (sort === false) return;
    const query = ActivityLog.find(filter)
      .populate("actor", "name role")
      .sort(sort)
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
