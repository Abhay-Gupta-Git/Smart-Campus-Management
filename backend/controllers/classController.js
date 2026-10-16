const mongoose = require("mongoose");
const CampusClass = require("../models/CampusClass");
const Room = require("../models/Room");
const User = require("../models/User");

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
    details.courseName?.trim() &&
    details.courseCode?.trim() &&
    details.section?.trim() &&
    details.faculty &&
    details.room &&
    validDays.includes(details.day) &&
    isValidTime(details.startTime) &&
    isValidTime(details.endTime) &&
    details.startTime < details.endTime,
  );
}

async function validateAssignments(details) {
  const faculty = await User.findOne({ _id: details.faculty, role: "faculty" });
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

function classPopulation(query) {
  return query
    .populate("faculty", "name email department")
    .populate("room", "name building capacity type")
    .populate("enrolledStudents", "name email studentId department");
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

    const classes = await classPopulation(
      CampusClass.find(filter).sort({ day: 1, startTime: 1 }),
    );

    return res.json(classes);
  } catch (error) {
    console.error("List classes failed:", error.message);
    return res.status(500).json({ message: "Failed to load classes" });
  }
}

async function createClass(req, res) {
  try {
    if (!hasValidClassDetails(req.body)) {
      return res.status(400).json({ message: "Provide valid class details" });
    }

    const assignments = await validateAssignments(req.body);

    if (assignments.error) {
      return res.status(400).json({ message: assignments.error });
    }

    const conflict = await findScheduleConflict(req.body);

    if (conflict) {
      return res.status(409).json({
        message: "The faculty member or room already has a class at that time",
      });
    }

    const campusClass = await CampusClass.create({
      ...req.body,
      courseCode: req.body.courseCode.trim().toUpperCase(),
      enrolledStudents: assignments.enrolledStudents,
    });

    const populatedClass = await classPopulation(
      CampusClass.findById(campusClass._id),
    );

    return res.status(201).json(populatedClass);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000
        ? "That course code and section already exists"
        : error.message;

    return res.status(status).json({ message });
  }
}

async function updateClass(req, res) {
  try {
    if (!hasValidClassDetails(req.body)) {
      return res.status(400).json({ message: "Provide valid class details" });
    }

    const assignments = await validateAssignments(req.body);

    if (assignments.error) {
      return res.status(400).json({ message: assignments.error });
    }

    const conflict = await findScheduleConflict(req.body, req.params.id);

    if (conflict) {
      return res.status(409).json({
        message: "The faculty member or room already has a class at that time",
      });
    }

    const campusClass = await CampusClass.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        courseCode: req.body.courseCode.trim().toUpperCase(),
        enrolledStudents: assignments.enrolledStudents,
      },
      { new: true, runValidators: true },
    );

    if (!campusClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    return res.json(
      await classPopulation(CampusClass.findById(campusClass._id)),
    );
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000
        ? "That course code and section already exists"
        : error.message;

    return res.status(status).json({ message });
  }
}

async function deleteClass(req, res) {
  try {
    const campusClass = await CampusClass.findByIdAndDelete(req.params.id);

    if (!campusClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    return res.json({ message: "Class deleted" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

module.exports = { listClasses, createClass, updateClass, deleteClass };
