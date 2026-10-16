const Attendance = require("../models/Attendance");
const CampusClass = require("../models/CampusClass");
const User = require("../models/User");

async function listAttendance(req, res) {
  try {
    const filter = {};

    if (req.query.date) {
      filter.date = req.query.date;
    }

    if (req.user.role === "student") {
      filter.student = req.user.id;
    }

    if (req.user.role === "faculty") {
      const assignedClasses = await CampusClass.find({ faculty: req.user.id })
        .select("_id")
        .lean();
      filter.campusClass = { $in: assignedClasses.map((item) => item._id) };
    }

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId department")
      .populate("campusClass", "courseName courseCode section")
      .sort("-date");

    return res.json(records);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load attendance" });
  }
}

async function markAttendance(req, res) {
  try {
    const { student: studentId, campusClass: classId, date, status } = req.body;

    if (
      !classId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
      !["present", "absent", "late"].includes(status)
    ) {
      return res
        .status(400)
        .json({ message: "Provide valid attendance details" });
    }

    const campusClass = await CampusClass.findById(classId);

    if (!campusClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    if (
      req.user.role === "faculty" &&
      campusClass.faculty.toString() !== req.user.id
    ) {
      return res.status(403).json({
        message: "You can only mark attendance for your assigned classes",
      });
    }

    const student = await User.exists({ _id: studentId, role: "student" });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const studentIsEnrolled = campusClass.enrolledStudents.some(
      (enrolledStudentId) => enrolledStudentId.toString() === studentId,
    );

    if (!studentIsEnrolled) {
      return res
        .status(403)
        .json({ message: "Student is not enrolled in this class" });
    }

    const record = await Attendance.findOneAndUpdate(
      { campusClass: classId, student: studentId, date },
      { status, markedBy: req.user.id },
      { upsert: true, new: true, runValidators: true },
    );

    return res.json(record);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

module.exports = { listAttendance, markAttendance };
