const Attendance = require("../models/Attendance");
const CampusClass = require("../models/CampusClass");
const User = require("../models/User");
const mongoose = require("mongoose");
const { hasOnlyFields, isValidDateString } = require("../utils/validation");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");
const { runTransaction } = require("../utils/transactions");
const recordActivity = require("../utils/activityLog");

async function listAttendance(req, res) {
  try {
    const filter = {};
    let visibleClassIds = null;
    if (req.query.recordId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.recordId)) return res.status(400).json({ message: "Record filter is invalid." });
      filter._id = req.query.recordId;
    }

    if (req.query.date) {
      if (!isValidDateString(req.query.date)) return res.status(400).json({ message: "Date filter must be a valid YYYY-MM-DD date." });
      filter.date = req.query.date;
    }
    if (req.query.status !== undefined) {
      if (!["present", "absent", "late"].includes(req.query.status)) return res.status(400).json({ message: "Attendance status filter is invalid." });
      filter.status = req.query.status;
    }

    if (req.user.role === "student") {
      filter.student = req.user.id;
    }

    if (req.user.role === "faculty") {
      visibleClassIds = await CampusClass.distinct("_id", { faculty: req.user.id });
      filter.campusClass = { $in: visibleClassIds };
    }

    const search = readSearch(req, res);
    if (search === false) return;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const searchParts = [{ date: regex }, { status: regex }];
      const studentFilter = { name: regex, role: "student" };
      if (req.user.role === "student") studentFilter._id = req.user.id;
      if (req.user.role === "faculty") {
        const enrolledIds = await CampusClass.distinct("enrolledStudents", { _id: { $in: visibleClassIds } });
        studentFilter._id = { $in: enrolledIds };
      }
      const studentIds = await User.find(studentFilter).distinct("_id");
      const classFilter = req.user.role === "faculty" ? { _id: { $in: visibleClassIds } } : {};
      const classIds = await CampusClass.find({ ...classFilter, $or: [{ courseName: regex }, { courseCode: regex }, { section: regex }] }).distinct("_id");
      if (studentIds.length) searchParts.push({ student: { $in: studentIds } });
      if (classIds.length) searchParts.push({ campusClass: { $in: classIds } });
      filter.$and = [...(filter.$and || []), { $or: searchParts }];
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const sort = readSort(req, res, ["date", "status", "createdAt"], "date", "desc");
    if (sort === false) return;
    const records = await executeListQuery({ query: Attendance.find(filter)
      .populate("student", "name studentId department")
      .populate("campusClass", "courseName courseCode section")
      .sort(sort)
      .lean(), Model: Attendance, filter, pagination, res });

    return res.json(records);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load attendance" });
  }
}

async function markAttendance(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["student", "campusClass", "date", "status"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { student: studentId, campusClass: classId, date, status } = body;

    if (
      !mongoose.isValidObjectId(classId) ||
      !mongoose.isValidObjectId(studentId) ||
      !isValidDateString(date) ||
      !["present", "absent", "late"].includes(status)
    ) {
      return res
        .status(400)
        .json({ message: "Provide valid attendance details" });
    }

    const result = await runTransaction(async (session) => {
      const studentLock = await User.updateOne(
        { _id: studentId, role: "student" },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
      if (!studentLock.matchedCount) return { status: 404, message: "Student not found" };

      const classLock = await CampusClass.updateOne(
        { _id: classId },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
      if (!classLock.matchedCount) return { status: 404, message: "Class not found" };
      const campusClass = await CampusClass.findById(classId).session(session);
      if (!campusClass) return { status: 404, message: "Class not found" };

      if (req.user.role === "faculty" && campusClass.faculty.toString() !== req.user.id) {
        return { status: 403, message: "You can only mark attendance for your assigned classes" };
      }
      if (!campusClass.enrolledStudents.some((id) => id.toString() === studentId)) {
        return { status: 403, message: "Student is not enrolled in this class" };
      }

      const record = await Attendance.findOneAndUpdate(
        { campusClass: classId, student: studentId, date },
        { $set: { status, markedBy: req.user.id } },
        { upsert: true, new: true, runValidators: true, session, setDefaultsOnInsert: true },
      );
      return { status: 200, record };
    });

    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    await recordActivity({ actor: req.user.id, action: "Attendance recorded", entityType: "attendance", entityId: result.record._id, summary: `Attendance recorded for ${date} as ${status}.` });
    return res.json(result.record);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "An attendance record already exists for this student, class, and date. Refresh and retry." });
    return respondError(res, error, "Attendance update", "Unable to save attendance.");
  }
}

module.exports = { listAttendance, markAttendance };
