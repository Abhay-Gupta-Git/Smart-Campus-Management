const mongoose = require("mongoose");
const CampusClass = require("../models/CampusClass");
const Room = require("../models/Room");
const User = require("../models/User");
const recordActivity = require("../utils/activityLog");
const { createNotifications } = require("../utils/notifications");
const { hasOnlyFields } = require("../utils/validation");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");
const { runTransaction, lockRoomReference, lockStudentReferences, lockUserReference } = require("../utils/transactions");
const Attendance = require("../models/Attendance");
const { roomMaintenanceBlock, approvedBookingConflictForClass } = require("../utils/scheduleAvailability");

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

function normalizeCapacity(value, fallback = CampusClass.schema.path("maxEnrollment").getDefault()) {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
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

async function validateAssignments(details, session) {
  const faculty = await User.findOne({ _id: details.faculty, role: "faculty" }).select("_id").session(session).lean();
  const room = await Room.findById(details.room).session(session);
  const enrolledStudents = [...new Set(details.enrolledStudents || [])];
  const maxEnrollment = Number(details.maxEnrollment);

  if (!Number.isInteger(maxEnrollment) || maxEnrollment < 1 || maxEnrollment > 10000) {
    return { error: "Class capacity must be an integer between 1 and 10,000" };
  }

  if (!faculty) {
    return { error: "Select an existing faculty account" };
  }

  if (!room) {
    return { error: "Select an existing room" };
  }
  const roomBlock = await roomMaintenanceBlock(room, session);
  if (roomBlock) return { error: roomBlock, status: 409 };

  const bookingConflict = await approvedBookingConflictForClass({
    roomId: room._id,
    day: details.day,
    startTime: details.startTime,
    endTime: details.endTime,
    session,
  });
  if (bookingConflict.conflict) return {
    error: bookingConflict.invalidSchedule
      ? "An approved booking in this room has invalid schedule data; correct it before scheduling a class."
      : "This class overlaps an approved room booking.",
    status: 409,
  };

  if (
    enrolledStudents.some((studentId) => !mongoose.isValidObjectId(studentId))
  ) {
    return { error: "One or more student selections are invalid" };
  }

  const validStudentCount = await User.countDocuments({
    _id: { $in: enrolledStudents },
    role: "student",
  }).session(session);

  if (validStudentCount !== enrolledStudents.length) {
    return { error: "All enrolled users must be student accounts" };
  }

  if (
    enrolledStudents.length > maxEnrollment
  ) {
    return { error: "Enrollment exceeds the class capacity" };
  }

  return { enrolledStudents, maxEnrollment };
}

async function findScheduleConflict(details, excludedId, session) {
  const filter = {
    $or: [{ room: details.room }, { faculty: details.faculty }],
  };

  if (excludedId) {
    filter._id = { $ne: excludedId };
  }

  const schedules = await CampusClass.find(filter)
    .select("courseName courseCode section day startTime endTime")
    .session(session)
    .lean();
  for (const schedule of schedules) {
    if (!validDays.includes(schedule.day)) return { invalidSchedule: true };
    if (schedule.day !== details.day) continue;
    if (!isValidTime(schedule.startTime) || !isValidTime(schedule.endTime) || schedule.startTime >= schedule.endTime) return { invalidSchedule: true };
    if (schedule.startTime < details.endTime && schedule.endTime > details.startTime) return { invalidSchedule: false };
  }
  return null;
}

async function findStudentScheduleConflict(details, studentIds, excludedId, session) {
  if (!studentIds.length) return null;
  const filter = { enrolledStudents: { $in: studentIds } };
  if (excludedId) filter._id = { $ne: excludedId };
  const scheduledClasses = await CampusClass.find(filter)
    .select("courseName courseCode section day startTime endTime enrolledStudents")
    .session(session)
    .lean();
  const studentSet = new Set(studentIds.map(String));

  for (const scheduledClass of scheduledClasses) {
    const sharesStudent = (scheduledClass.enrolledStudents || []).some((id) => studentSet.has(String(id)));
    if (!sharesStudent) continue;
    if (!validDays.includes(scheduledClass.day) || !isValidTime(scheduledClass.startTime) || !isValidTime(scheduledClass.endTime) || scheduledClass.startTime >= scheduledClass.endTime) {
      return { invalidSchedule: true, scheduledClass };
    }
    if (scheduledClass.day !== details.day) continue;
    if (scheduledClass.startTime < details.endTime && scheduledClass.endTime > details.startTime) {
      return { invalidSchedule: false, scheduledClass };
    }
  }
  return null;
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
    if (req.query.recordId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.recordId)) return res.status(400).json({ message: "Record filter is invalid." });
      filter._id = req.query.recordId;
    }

    if (req.user.role === "faculty") {
      filter.faculty = req.user.id;
    }

    if (req.user.role === "student") {
      filter.enrolledStudents = req.user.id;
    }

    if (req.query.day !== undefined) {
      if (!validDays.includes(req.query.day)) return res.status(400).json({ message: "Class day filter is invalid." });
      filter.day = req.query.day;
    }
    const search = readSearch(req, res);
    if (search === false) return;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const searchParts = ["courseName", "courseCode", "section"].map((field) => ({ [field]: regex }));
      const lookups = [Room.find({ $or: [{ name: regex }, { building: regex }] }).distinct("_id")];
      if (req.user.role === "admin") lookups.push(User.find({ role: "faculty", name: regex }).distinct("_id"));
      const [roomIds, facultyIds = []] = await Promise.all(lookups);
      if (facultyIds.length) searchParts.push({ faculty: { $in: facultyIds } });
      if (roomIds.length) searchParts.push({ room: { $in: roomIds } });
      filter.$and = [...(filter.$and || []), { $or: searchParts }];
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const sort = readSort(req, res, ["courseName", "courseCode", "section", "day", "startTime", "endTime", "createdAt"], "day");
    if (sort === false) return;
    if (req.query.includeStudents !== undefined && !["true", "false"].includes(req.query.includeStudents)) return res.status(400).json({ message: "includeStudents must be true or false." });
    const includeStudents = req.query.includeStudents !== "false";
    const query = CampusClass.find(filter).sort(sort);
    const classes = await executeListQuery({ query: includeStudents ? classPopulation(query, req.user.role === "admin") : query.populate("faculty", "name department").populate("room", "name building capacity type equipment maintenanceHold"), Model: CampusClass, filter, pagination, res });

    return res.json(classes);
  } catch (error) {
    console.error("List classes failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load classes" });
  }
}

async function listClassStudents(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid class ID." });
    const campusClass = await CampusClass.findOne({
      _id: req.params.id,
      ...(req.user.role === "faculty" ? { faculty: req.user.id } : {}),
    }).select("enrolledStudents").lean();
    if (!campusClass) return res.status(404).json({ message: "Assigned class not found." });

    const filter = { _id: { $in: campusClass.enrolledStudents || [] }, role: "student" };
    const search = readSearch(req, res);
    if (search === false) return;
    if (search) filter.$or = ["name", "studentId", "department"].map((field) => ({
      [field]: { $regex: escapeRegex(search), $options: "i" },
    }));
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const sort = readSort(req, res, ["name", "studentId", "department"], "name");
    if (sort === false) return;
    const students = await executeListQuery({
      query: User.find(filter).select("name studentId department").sort(sort).lean(),
      Model: User,
      filter,
      pagination,
      res,
    });
    return res.json(students);
  } catch (error) {
    console.error("List class roster failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load the class roster." });
  }
}

async function createClass(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, classFields)) return res.status(400).json({ message: "Request contains unsupported fields." });
    const maxEnrollment = normalizeCapacity(body.maxEnrollment);
    if (!hasValidClassDetails(body) || (body.enrolledStudents !== undefined && (!Array.isArray(body.enrolledStudents) || body.enrolledStudents.length > 1000)) ||
      !Number.isInteger(maxEnrollment) || maxEnrollment < 1 || maxEnrollment > 10000) {
      return res.status(400).json({ message: "Provide valid class details" });
    }

    const result = await runTransaction(async (session) => {
      const enrolledStudents = [...new Set(body.enrolledStudents || [])];
      if (enrolledStudents.some((studentId) => !mongoose.isValidObjectId(studentId))) {
        return { status: 400, message: "One or more student selections are invalid" };
      }
      if (!await lockUserReference(User, body.faculty, "faculty", session)) {
        return { status: 400, message: "Select an existing faculty account" };
      }
      if (!await lockStudentReferences(User, enrolledStudents, session)) {
        return { status: 400, message: "All enrolled users must be student accounts" };
      }
      if (!await lockRoomReference(Room, body.room, session)) return { status: 400, message: "Select an existing room" };

      const assignments = await validateAssignments({ ...body, maxEnrollment }, session);
      if (assignments.error) return { status: assignments.status || 400, message: assignments.error };
      const scheduleConflict = await findScheduleConflict(body, null, session);
      if (scheduleConflict) {
        return { status: 409, message: scheduleConflict.invalidSchedule
          ? "An existing room or faculty schedule is invalid; correct it before scheduling another class."
          : "The faculty member or room already has a class at that time." };
      }
      const studentConflict = await findStudentScheduleConflict(body, assignments.enrolledStudents, null, session);
      if (studentConflict) return { status: 409, message: studentConflict.invalidSchedule
        ? "An enrolled student's existing class has invalid schedule data. Correct that schedule before enrolling the student."
        : "One or more enrolled students already have a class at an overlapping time." };

      const [campusClass] = await CampusClass.create([{
        courseName: body.courseName.trim(),
        courseCode: body.courseCode.trim().toUpperCase(),
        section: body.section.trim(),
        faculty: body.faculty,
        room: body.room,
        day: body.day,
        startTime: body.startTime,
        endTime: body.endTime,
        maxEnrollment: assignments.maxEnrollment,
        enrolledStudents: assignments.enrolledStudents,
      }], { session });
      return { status: 201, campusClass };
    });

    if (result.status !== 201) return res.status(result.status).json({ message: result.message });
    const campusClass = result.campusClass;

    const populatedClass = await classPopulation(
      CampusClass.findById(campusClass._id),
      true,
    );
    const assignedRoom = await Room.findById(campusClass.room).select("name building").lean();
    await recordActivity({ actor: req.user.id, action: "Classroom allocation created", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} assigned to ${assignedRoom?.name || "a room"}${assignedRoom?.building ? ` in ${assignedRoom.building}` : ""} on ${campusClass.day}.` });
    await createNotifications({
      recipients: [campusClass.faculty, ...campusClass.enrolledStudents],
      title: "Class scheduled",
      message: `${campusClass.courseName} (${campusClass.courseCode}) is scheduled for ${campusClass.day}, ${campusClass.startTime}–${campusClass.endTime}.`,
      entityType: "class",
      entityId: campusClass._id,
      targetPage: "Classes",
      eventId: `class:${campusClass._id}:created:${campusClass.createdAt.getTime()}`,
    });

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

    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid class ID." });
    const result = await runTransaction(async (session) => {
      const campusClass = await CampusClass.findById(req.params.id).session(session);
      if (!campusClass) return { status: 404, message: "Class not found" };
      const enrolledStudents = [...new Set(body.enrolledStudents === undefined ? campusClass.enrolledStudents : body.enrolledStudents)];
      if (enrolledStudents.some((studentId) => !mongoose.isValidObjectId(studentId))) {
        return { status: 400, message: "One or more student selections are invalid" };
      }
      const maxEnrollment = normalizeCapacity(body.maxEnrollment, campusClass.maxEnrollment ?? CampusClass.schema.path("maxEnrollment").getDefault());
      if (!Number.isInteger(maxEnrollment) || maxEnrollment < 1 || maxEnrollment > 10000) return { status: 400, message: "Class capacity must be an integer between 1 and 10,000" };
      if (!await lockUserReference(User, body.faculty, "faculty", session)) {
        return { status: 400, message: "Select an existing faculty account" };
      }
      if (!await lockStudentReferences(User, enrolledStudents, session)) {
        return { status: 400, message: "All enrolled users must be student accounts" };
      }
      if (!await lockRoomReference(Room, body.room, session)) return { status: 400, message: "Select an existing room" };

      const assignments = await validateAssignments({ ...body, maxEnrollment, enrolledStudents }, session);
      if (assignments.error) return { status: assignments.status || 400, message: assignments.error };
      const scheduleConflict = await findScheduleConflict(body, req.params.id, session);
      if (scheduleConflict) {
        return { status: 409, message: scheduleConflict.invalidSchedule
          ? "An existing room or faculty schedule is invalid; correct it before scheduling another class."
          : "The faculty member or room already has a class at that time." };
      }
      const studentConflict = await findStudentScheduleConflict(body, assignments.enrolledStudents, req.params.id, session);
      if (studentConflict) return { status: 409, message: studentConflict.invalidSchedule
        ? "An enrolled student's existing class has invalid schedule data. Correct that schedule before enrolling the student."
        : "One or more enrolled students already have a class at an overlapping time." };

      const oldRoomId = campusClass.room;
      const previousRecipients = [campusClass.faculty, ...campusClass.enrolledStudents];
      Object.assign(campusClass, {
        courseName: body.courseName.trim(),
        courseCode: body.courseCode.trim().toUpperCase(),
        section: body.section.trim(),
        faculty: body.faculty,
        room: body.room,
        day: body.day,
        startTime: body.startTime,
        endTime: body.endTime,
        maxEnrollment: assignments.maxEnrollment,
        enrolledStudents: assignments.enrolledStudents,
      });
      await campusClass.save({ session });
      return { status: 200, campusClass, oldRoomId, previousRecipients };
    });

    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    const { campusClass, oldRoomId, previousRecipients } = result;

    const [oldRoom, newRoom] = await Promise.all([
      oldRoomId ? Room.findById(oldRoomId).select("name building").lean() : null,
      Room.findById(campusClass.room).select("name building").lean(),
    ]);
    await recordActivity({ actor: req.user.id, action: "Classroom allocation updated", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} room allocation changed from ${oldRoom?.name || "unassigned"} to ${newRoom?.name || "a room"}.` });
    await createNotifications({
      recipients: [...previousRecipients, campusClass.faculty, ...campusClass.enrolledStudents],
      title: "Class schedule updated",
      message: `${campusClass.courseName} (${campusClass.courseCode}) is now scheduled for ${campusClass.day}, ${campusClass.startTime}–${campusClass.endTime}.`,
      entityType: "class",
      entityId: campusClass._id,
      targetPage: "Classes",
      eventId: `class:${campusClass._id}:updated:${campusClass.updatedAt.getTime()}`,
    });

    return res.json(
      await classPopulation(CampusClass.findById(campusClass._id), true),
    );
  } catch (error) {
    return respondError(res, error, "Class update", "Unable to update class.");
  }
}

async function deleteClass(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid class ID." });
    const result = await runTransaction(async (session) => {
      const campusClass = await CampusClass.findById(req.params.id).session(session);
      if (!campusClass) return { status: 404, message: "Class not found" };
      const lock = await CampusClass.updateOne(
        { _id: campusClass._id },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
      if (!lock.matchedCount) return { status: 404, message: "Class not found" };
      if (await Attendance.exists({ campusClass: campusClass._id }).session(session)) {
        return { status: 409, message: "Class cannot be deleted because attendance records reference it. Preserve the class history or remove attendance through an authorized retention process." };
      }
      await CampusClass.deleteOne({ _id: campusClass._id }, { session });
      return { status: 200, campusClass };
    });

    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    const { campusClass } = result;

    const removedRoom = await Room.findById(campusClass.room).select("name building").lean();
    await recordActivity({ actor: req.user.id, action: "Classroom allocation removed", entityType: "class", entityId: campusClass._id, summary: `${campusClass.courseName} allocation in ${removedRoom?.name || "a room"} was removed.` });
    await createNotifications({
      recipients: [campusClass.faculty, ...campusClass.enrolledStudents],
      title: "Class removed from schedule",
      message: `${campusClass.courseName} (${campusClass.courseCode}) was removed from the class schedule.`,
      entityType: "class",
      entityId: null,
      targetPage: "Classes",
      eventId: `class:${campusClass._id}:deleted:${campusClass.updatedAt.getTime()}`,
    });

    return res.json({ message: "Class deleted" });
  } catch (error) {
    return respondError(res, error, "Class deletion", "Unable to remove class.");
  }
}

module.exports = { listClasses, listClassStudents, createClass, updateClass, deleteClass };
