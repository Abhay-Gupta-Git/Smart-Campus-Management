const express = require("express");
const attendanceController = require("../controllers/attendanceController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.get("/", attendanceController.listAttendance);
router.post(
  "/",
  authorizeRoles("admin", "faculty"),
  attendanceController.markAttendance,
);

module.exports = router;
