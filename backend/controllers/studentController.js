const mongoose = require("mongoose");
const User = require("../models/User");
const { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { isValidEmail, hasOnlyFields } = require("../utils/validation");
const CampusClass = require("../models/CampusClass");
const Attendance = require("../models/Attendance");
const Booking = require("../models/Booking");
const Complaint = require("../models/Complaint");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const Notice = require("../models/Notice");
const Room = require("../models/Room");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");
const { runTransaction } = require("../utils/transactions");
const recordActivity = require("../utils/activityLog");

async function listStudents(req, res) {
  try {
    let studentFilter = { role: "student" };
    if (req.user.role === "faculty") {
      const enrolledIds = await CampusClass.distinct("enrolledStudents", { faculty: req.user.id });
      studentFilter._id = { $in: enrolledIds };
    }
    const selectFields = req.user.role === "admin"
      ? "name email role studentId department createdAt"
      : "name studentId department";
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    const allowedSorts = req.user.role === "admin"
      ? ["name", "email", "studentId", "department", "createdAt"]
      : ["name", "studentId", "department"];
    const sort = readSort(req, res, allowedSorts, "name");
    if (sort === false) return;
    if (search) {
      const terms = ["name", "studentId", "department"];
      if (req.user.role === "admin") terms.push("email");
      studentFilter.$or = terms.map((field) => ({ [field]: { $regex: escapeRegex(search), $options: "i" } }));
    }
    const students = await executeListQuery({ query: User.find(studentFilter).select(selectFields).sort(sort).lean(), Model: User, filter: studentFilter, pagination, res });

    return res.json(students);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load students" });
  }
}

async function createStudent(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["name", "email", "password", "studentId", "department", "phone"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { name, email, password, studentId, department, phone } = body;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || !isValidEmail(email) || !isAcceptablePassword(password)) {
      return res.status(400).json({
        message: `Provide a valid name, email, and password (${MIN_PASSWORD_LENGTH}+ characters, maximum 72 UTF-8 bytes).`,
      });
    }
    if ((studentId !== undefined && (typeof studentId !== "string" || studentId.length > 64)) || (department !== undefined && (typeof department !== "string" || department.length > 120)) || (phone !== undefined && (typeof phone !== "string" || phone.length > 30))) return res.status(400).json({ message: "Student profile fields are invalid." });

    const student = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: await hashPassword(password),
      studentId: studentId?.trim() || null,
      department: department?.trim() || null,
      phone: phone?.trim() || "",
      role: "student",
    });
    const safeStudent = student.toObject();
    delete safeStudent.password;

    await recordActivity({ actor: req.user.id, action: "Student account created", entityType: "account", entityId: student._id, summary: "Created a student account." });

    return res.status(201).json(safeStudent);
  } catch (error) {
    return respondError(res, error, "Student creation", "Unable to create student account.");
  }
}

async function updateStudent(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["name", "email", "studentId", "department", "phone", "password"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { name, email, studentId, department, phone, password } = body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return res.status(400).json({ message: "Name is invalid." });
      updates.name = name.trim();
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) return res.status(400).json({ message: "Email is invalid." });
      updates.email = email.trim().toLowerCase();
    }

    if (studentId !== undefined) {
      if (typeof studentId !== "string" || studentId.length > 64) return res.status(400).json({ message: "Student ID is invalid." });
      updates.studentId = studentId.trim();
    }

    if (department !== undefined) {
      if (typeof department !== "string" || department.length > 120) return res.status(400).json({ message: "Department is invalid." });
      updates.department = department.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== "string" || phone.length > 30) return res.status(400).json({ message: "Phone is invalid." });
      updates.phone = phone.trim();
    }

    if (password !== undefined) {
      if (!isAcceptablePassword(password)) {
        return res.status(400).json({
          message: `Password must be ${MIN_PASSWORD_LENGTH}+ characters and no more than 72 UTF-8 bytes.`,
        });
      }

      updates.password = await hashPassword(password);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ message: "Provide at least one field to update." });

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: "student" },
      { $set: updates, ...(password !== undefined ? { $inc: { tokenVersion: 1 } } : {}) },
      { new: true, runValidators: true },
    ).select("-password");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    await recordActivity({ actor: req.user.id, action: "Student account updated", entityType: "account", entityId: student._id, summary: "Updated a student account profile." });

    return res.json(student);
  } catch (error) {
    return respondError(res, error, "Student update", "Unable to update student account.");
  }
}

async function deleteStudent(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
    const result = await runTransaction(async (session) => {
      const student = await User.findOneAndUpdate(
        { _id: req.params.id, role: "student" },
        { $inc: { referenceVersion: 1 } },
        { new: true, session },
      ).select("name");
      if (!student) return { status: 404, message: "Student not found" };

      const references = {
        enrollments: await CampusClass.countDocuments({ enrolledStudents: student._id }).session(session),
        facultyAssignments: await CampusClass.countDocuments({ faculty: student._id }).session(session),
        attendance: await Attendance.countDocuments({ $or: [{ student: student._id }, { markedBy: student._id }] }).session(session),
        bookings: await Booking.countDocuments({ bookedBy: student._id }).session(session),
        complaints: await Complaint.countDocuments({ $or: [
          { submittedBy: student._id }, { assignedTo: student._id }, { verifiedBy: student._id }, { "history.actor": student._id },
        ] }).session(session),
        notifications: await Notification.countDocuments({ recipient: student._id }).session(session),
        activityHistory: await ActivityLog.countDocuments({ actor: student._id }).session(session),
        notices: await Notice.countDocuments({ author: student._id }).session(session),
        inspections: await Room.countDocuments({ $or: [
          { "equipment.inspectedBy": student._id }, { "inspectionHistory.equipment.inspectedBy": student._id },
        ] }).session(session),
      };
      if (Object.values(references).some(Boolean)) {
        return { status: 409, message: "Student cannot be deleted while campus records reference this account. Preserve the account history or remove references through their owning workflows.", references };
      }

      await User.deleteOne({ _id: student._id, role: "student" }, { session });
      return { status: 200 };
    });

    if (result.status !== 200) return res.status(result.status).json({ message: result.message, ...(result.references ? { references: result.references } : {}) });

    await recordActivity({ actor: req.user.id, action: "Student account deleted", entityType: "account", entityId: req.params.id, summary: "Removed a student account." });

    return res.json({ message: "Student removed" });
  } catch (error) {
    return respondError(res, error, "Student deletion", "Unable to remove student account.");
  }
}

module.exports = {
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
};
