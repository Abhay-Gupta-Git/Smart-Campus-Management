const express = require("express");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Notice = require("../models/Notice");
const Complaint = require("../models/Complaint");
const CampusClass = require("../models/CampusClass");
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
  const [
    students,
    faculty,
    rooms,
    bookings,
    notices,
    openComplaints,
    classes,
    recentNotices,
  ] = await Promise.all([
    User.countDocuments({ role: "student" }),
    User.countDocuments({ role: "faculty" }),
    Room.countDocuments(),
    Booking.countDocuments(),
    Notice.countDocuments(),
    Complaint.countDocuments({ status: { $nin: ["Resolved", "Closed"] } }),
    CampusClass.countDocuments(),
    Notice.find().populate("author", "name").sort({ createdAt: -1 }).limit(5),
  ]);

  return res.json({
    role: "admin",
    profile: req.user,
    students,
    faculty,
    rooms,
    bookings,
    notices,
    classes,
    openComplaints,
    recentNotices,
  });
}

async function getTechnicianDashboard(req, res) {
  const filter = { assignedTo: req.user.id, room: { $ne: null } };
  const [assignedMaintenance, pendingVerification, activeIssues] = await Promise.all([
    Complaint.countDocuments(filter),
    Complaint.countDocuments({ ...filter, status: "Pending Verification" }),
    Complaint.countDocuments({ ...filter, status: { $in: ["Open", "In progress"] } }),
  ]);
  return res.json({ role: "technician", profile: req.user, assignedMaintenance, pendingVerification, activeIssues });
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
    console.error("Dashboard request failed:", error.message);
    return res.status(500).json({ message: "Failed to load dashboard" });
  }
});

module.exports = router;
