const mongoose = require("mongoose");
const CampusClass = require("../models/CampusClass");
const Room = require("../models/Room");
const User = require("../models/User");
const recordActivity = require("../utils/activityLog");
const { hasOnlyFields } = require("../utils/validation");
const { readPagination, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");

const classFields = ["courseName", "courseCode", "section", "faculty", "room", "day", "startTime", "endTime", "maxEnrollment", "enrolledStudents"];

const validDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function isValidTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function hasValidClassDetails(details) {
  return Boolean(
    details &&
    typeof details.courseName === "string" && details.courseName.trim().length > 0 && details.courseName.trim().length <= 160 &&
    typeof details.courseCode === "string" && details.courseCode.trim().length > 0 && details.courseCode.trim().length <= 32 &&
    typeof details.section === "string" && details.section.trim().length > 0 && details.section.trim().length <= 32 &&
    mongoose.isValidObjectId(details.faculty) &&
    mongoose.isValidObjectId(details.room) &&
    validDays.includes(details.day) &&
    isValidTime(details.startTime) &&
    isValidTime(details.endTime) &&
    details.startTime < details.endTime,
  );
}

async function validateAssignments(details) {
  const faculty = await User.findOne({ _id: details.faculty, role: "faculty" }).select("_id").lean();
  const room = await Room.exists({ _id: details.room });
  const enrolledStudents = [...new Set(details.enrolledStudents || [])];

  if (!faculty) {
    return { error: "Select an existing faculty account" };
  }

  if (!room) {
    return { error: "Select an existing room" };
  }

  if (
    enrolledStudents.some((studentId) => !mongoose.isValidObjectId(studentId))
  ) {
    return { error: "One or more student selections are invalid" };
  }

  const validStudentCount = await User.countDocuments({
    _id: { $in: enrolledStudents },
    role: "student",
  });

  if (validStudentCount !== enrolledStudents.length) {
    return { error: "All enrolled users must be student accounts" };
  }

  if (
    details.maxEnrollment !== undefined &&
    enrolledStudents.length > Number(details.maxEnrollment)
  ) {
    return { error: "Enrollment exceeds the class capacity" };
  }

  return { enrolledStudents };
}

async function findScheduleConflict(details, excludedId) {
  const filter = {
    day: details.day,
    startTime: { $lt: details.endTime },
    endTime: { $gt: details.startTime },
    $or: [{ room: details.room }, { faculty: details.faculty }],
  };

  if (excludedId) {
    filter._id = { $ne: excludedId };
  }

  return CampusClass.findOne(filter);
}

function classPopulation(query, includePrivateFields = false) {
  return query
    .populate("faculty", includePrivateFields ? "name email department" : "name department")
    .populate("room", "name building capacity type equipment maintenanceHold")
    .populate("enrolledStudents", includePrivateFields ? "name email studentId department" : "name studentId department");
}

async function listClasses(req, res) {
  try {
    const filter = {};

    if (req.user.role === "faculty") {
      filter.faculty = req.user.id;
    }

    if (req.user.role === "student") {
      filter.enrolledStudents = req.user.id;
    }

    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const classes = await executeListQuery({ query: classPopulation(CampusClass.find(filter).sort({ day: 1, startTime: 1 }), req.user.role === "admin"), Model: CampusClass, filter, pagination, res });

    return res.json(classes);
  } catch (error) {
    console.error("List classes failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load classes" });
  }
}

async function createClass(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, classFields)) return res.status(400).json({ message: "Request contains unsupported fields." });
    if (!hasValidClassDetails(body) || (body.enrolledStudents !== undefined && (!Array.isArray(body.enrolledStudents) || body.enrolledStudents.length > 1000)) ||
      (body.maxEnrollment !== undefined && (!Number.isInteger(Number(body.maxEnrollment)) || Number(body.maxEnrollment) < 1 || Number(body.maxEnrollment) > 10000))) {
      return res.status(400).json({ message: "Provide valid class details" });
    }

    const assignments = await validateAssignments(body);

    if (assignments.error) {
      return res.status(400).json({ message: assignments.error });
    }

    const conflict = await findScheduleConflict(body);

    if (conflict) {
      return res.status(409).json({
        message: "The faculty member or room already has a class at that time",
      });
    }

    const campusClass = await CampusClass.create({
      courseName: body.courseName.trim(),
      courseCode: body.courseCode.trim().toUpperCase(),
      section: body.section.trim(),
      faculty: body.faculty,
      room: body.room,
      day: body.day,
      startTime: body.startTime,
      endTime: body.endTime,
      maxEnrollment: body.maxEnrollment,
      enrolledStudents: assignments.enrolledStudents,
    });

    const populatedClass = await classPopulation(
      CampusClass.findById(campusClass._id),
      true,
    );
    const assignedRoom = await Room.findById(campusClass.room).select("name building").lean();
    await recordActivity({ actor: req.user.id, action: "Classroom allocation created", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} assigned to ${assignedRoom?.name || "a room"}${assignedRoom?.building ? ` in ${assignedRoom.building}` : ""} on ${campusClass.day}.` });

    return res.status(201).json(populatedClass);
  } catch (error) {
    return respondError(res, error, "Class creation", "Unable to create class.");
  }
}

async function updateClass(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, classFields)) return res.status(400).json({ message: "Request contains unsupported fields." });
    if (!hasValidClassDetails(body) || (body.enrolledStudents !== undefined && (!Array.isArray(body.enrolledStudents) || body.enrolledStudents.length > 1000)) ||
      (body.maxEnrollment !== undefined && (!Number.isInteger(Number(body.maxEnrollment)) || Number(body.maxEnrollment) < 1 || Number(body.maxEnrollment) > 10000))) {
      return res.status(400).json({ message: "Provide valid class details" });
    }

    const assignments = await validateAssignments(body);

    if (assignments.error) {
      return res.status(400).json({ message: assignments.error });
    }

    const conflict = await findScheduleConflict(body, req.params.id);

    if (conflict) {
      return res.status(409).json({
        message: "The faculty member or room already has a class at that time",
      });
    }

    const existingClass = await CampusClass.findById(req.params.id).select("room courseName");
    const campusClass = await CampusClass.findByIdAndUpdate(
      req.params.id,
      {
        courseName: body.courseName.trim(),
        courseCode: body.courseCode.trim().toUpperCase(),
        section: body.section.trim(),
        faculty: body.faculty,
        room: body.room,
        day: body.day,
        startTime: body.startTime,
        endTime: body.endTime,
        maxEnrollment: body.maxEnrollment,
        enrolledStudents: assignments.enrolledStudents,
      },
      { new: true, runValidators: true },
    );

    if (!campusClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const [oldRoom, newRoom] = await Promise.all([
      existingClass?.room ? Room.findById(existingClass.room).select("name building").lean() : null,
      Room.findById(campusClass.room).select("name building").lean(),
    ]);
    await recordActivity({ actor: req.user.id, action: "Classroom allocation updated", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} room allocation changed from ${oldRoom?.name || "unassigned"} to ${newRoom?.name || "a room"}.` });

    return res.json(
      await classPopulation(CampusClass.findById(campusClass._id), true),
    );
  } catch (error) {
    return respondError(res, error, "Class update", "Unable to update class.");
  }
}

async function deleteClass(req, res) {
  try {
    const campusClass = await CampusClass.findByIdAndDelete(req.params.id);

    if (!campusClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const removedRoom = await Room.findById(campusClass.room).select("name building").lean();
    await recordActivity({ actor: req.user.id, action: "Classroom allocation removed", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} allocation in ${removedRoom?.name || "a room"} was removed.` });

    return res.json({ message: "Class deleted" });
  } catch (error) {
    return respondError(res, error, "Class deletion", "Unable to remove class.");
  }
}

module.exports = { listClasses, createClass, updateClass, deleteClass };
