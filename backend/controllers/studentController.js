const User = require("../models/User");
const { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { isValidEmail, hasOnlyFields } = require("../utils/validation");
const CampusClass = require("../models/CampusClass");
const { readPagination, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");

async function listStudents(req, res) {
  try {
    let studentFilter = { role: "student" };
    if (req.user.role === "faculty") {
      const assignedClasses = await CampusClass.find({ faculty: req.user.id }).select("enrolledStudents").lean();
      const enrolledIds = [...new Set(assignedClasses.flatMap((item) => item.enrolledStudents.map(String)))];
      studentFilter._id = { $in: enrolledIds };
    }
    const selectFields = req.user.role === "admin"
      ? "name email role studentId department createdAt"
      : "name studentId department";
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const students = await executeListQuery({ query: User.find(studentFilter).select(selectFields).sort("name").lean(), Model: User, filter: studentFilter, pagination, res });

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

    return res.json(student);
  } catch (error) {
    return respondError(res, error, "Student update", "Unable to update student account.");
  }
}

async function deleteStudent(req, res) {
  try {
    const student = await User.findOneAndDelete({
      _id: req.params.id,
      role: "student",
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

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
