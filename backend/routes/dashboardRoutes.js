const express = require("express");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Notice = require("../models/Notice");
const Complaint = require("../models/Complaint");
const CampusClass = require("../models/CampusClass");
const ActivityLog = require("../models/ActivityLog");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { getAnalytics } = require("../controllers/analyticsController");
const { getRoomForecast } = require("../controllers/roomForecastController");

const router = express.Router();

router.get("/analytics", protect, authorizeRoles("admin"), getAnalytics);
router.get("/analytics/room-forecast", protect, authorizeRoles("admin"), getRoomForecast);

function getNoticeFilter(role) {
  return {
    $or: [{ audience: "all" }, { audience: role }],
  };
}

async function getStudentDashboard(req, res) {
  const [campusClass, attendance, notices] = await Promise.all([
    CampusClass.find({ enrolledStudents: req.user.id })
      .populate("faculty", "name")
      .populate("room", "name building equipment maintenanceHold")
      .sort({ day: 1, startTime: 1 }),
    Attendance.find({ student: req.user.id })
      .populate("campusClass", "courseName courseCode")
      .sort({ date: -1 })
      .limit(30),
    Notice.find(getNoticeFilter("student")).sort({ createdAt: -1 }).limit(5),
  ]);

  const presentCount = attendance.filter(
    (record) => record.status === "present" || record.status === "late",
  ).length;

  return res.json({
    role: "student",
    profile: req.user,
    classes: campusClass,
    attendance,
    attendanceSummary: {
      present: presentCount,
      total: attendance.length,
      percentage: attendance.length
        ? Math.round((presentCount / attendance.length) * 100)
        : 0,
    },
    notices,
  });
}

async function getFacultyDashboard(req, res) {
  const today = new Date().toISOString().slice(0, 10);
  const [campusClasses, bookings, notices] = await Promise.all([
    CampusClass.find({ faculty: req.user.id })
      .populate("room", "name building equipment maintenanceHold")
      .populate("enrolledStudents", "name studentId")
      .sort({ day: 1, startTime: 1 }),
    Booking.find({ bookedBy: req.user.id, date: today })
      .populate("room", "name building equipment maintenanceHold")
      .sort("startTime"),
    Notice.find(getNoticeFilter("faculty")).sort({ createdAt: -1 }).limit(5),
  ]);
  const classIds = campusClasses.map((campusClass) => campusClass._id);
  const attendanceToday = await Attendance.countDocuments({
    campusClass: { $in: classIds },
    date: today,
  });

  return res.json({
    role: "faculty",
    profile: req.user,
    classes: campusClasses,
    attendanceToday,
    bookings,
    notices,
  });
}

async function getAdminDashboard(req, res) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const [
    students,
    faculty,
    technicians,
    rooms,
    buildings,
    bookings,
    bookingStatus,
    notices,
    openComplaints,
    maintenanceRooms,
    maintenanceAlerts,
    classes,
    recentNotices,
    recentActivity,
    buildingSummaries,
    attendanceRows,
  ] = await Promise.all([
    User.countDocuments({ role: "student" }),
    User.countDocuments({ role: "faculty" }),
    User.countDocuments({ role: "technician" }),
    Room.countDocuments(),
    Room.distinct("building").then((items) => items.length),
    Booking.countDocuments(),
    Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Notice.countDocuments(),
    Complaint.countDocuments({ status: { $nin: ["Resolved", "Closed"] } }),
    Room.countDocuments({ $or: [{ maintenanceHold: true }, { available: false }] }),
    Complaint.find({ room: { $ne: null }, status: { $nin: ["Closed"] } })
      .populate("room", "name building")
      .populate("assignedTo", "name")
      .sort({ priority: -1, createdAt: -1 }).limit(8).lean(),
    CampusClass.countDocuments(),
    Notice.find().populate("author", "name").sort({ createdAt: -1 }).limit(5),
    ActivityLog.find().populate("actor", "name role").sort({ createdAt: -1 }).limit(8).lean(),
    Room.aggregate([
      {
        $addFields: {
          equipmentFault: {
            $gt: [
              { $size: { $filter: { input: { $ifNull: ["$equipment", []] }, as: "item", cond: { $ne: ["$$item.status", "Working"] } } } },
              0,
            ],
          },
        },
      },
      { $group: {
        _id: "$building", rooms: { $sum: 1 },
        operationalRooms: { $sum: { $cond: [{ $and: [{ $eq: ["$maintenanceHold", false] }, { $eq: ["$available", true] }, { $eq: ["$equipmentFault", false] }] }, 1, 0] } },
        maintenanceRooms: { $sum: { $cond: [{ $or: [{ $eq: ["$maintenanceHold", true] }, { $eq: ["$available", false] }, { $eq: ["$equipmentFault", true] }] }, 1, 0] } },
      } }, { $sort: { _id: 1 } },
    ]),
    Attendance.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const attendanceSummary = attendanceRows.reduce((summary, row) => {
    summary.total += row.count;
    if (Object.hasOwn(summary, row._id)) summary[row._id] = row.count;
    return summary;
  }, { total: 0, present: 0, absent: 0, late: 0 });
  attendanceSummary.percentage = attendanceSummary.total
    ? Math.round(((attendanceSummary.present + attendanceSummary.late) / attendanceSummary.total) * 100)
    : 0;

  return res.json({
    role: "admin",
    profile: req.user,
    students,
    faculty,
    technicians,
    rooms,
    buildings,
    bookings,
    bookingStatus: Object.fromEntries(bookingStatus.map((row) => [row._id, row.count])),
    notices,
    classes,
    openComplaints,
    maintenanceRooms,
    maintenanceAlerts,
    buildingSummaries,
    attendanceSummary,
    recentActivity,
    recentNotices,
  });
}

async function getTechnicianDashboard(req, res) {
  const filter = { assignedTo: req.user.id, room: { $ne: null } };
  const [assignedMaintenance, pendingVerification, activeIssues, completedRepairs] = await Promise.all([
    Complaint.countDocuments(filter),
    Complaint.countDocuments({ ...filter, status: "Pending Verification" }),
    Complaint.countDocuments({ ...filter, status: { $in: ["Open", "In progress"] } }),
    Complaint.countDocuments({ ...filter, status: "Closed" }),
  ]);
  return res.json({ role: "technician", profile: req.user, assignedMaintenance, pendingVerification, activeIssues, completedRepairs });
}

router.get("/", protect, async (req, res) => {
  try {
    if (req.user.role === "student") {
      return await getStudentDashboard(req, res);
    }

    if (req.user.role === "faculty") {
      return await getFacultyDashboard(req, res);
    }

    if (req.user.role === "technician") {
      return await getTechnicianDashboard(req, res);
    }

    return await getAdminDashboard(req, res);
  } catch (error) {
    console.error("Dashboard request failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load dashboard" });
  }
});

module.exports = router;
