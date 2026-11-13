const CampusClass = require("../models/CampusClass");
const User = require("../models/User");
const { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { isValidEmail, hasOnlyFields } = require("../utils/validation");

async function listFaculty(req, res) {
  try {
    const faculty = await User.find({ role: "faculty" })
      .select("name email role department phone createdAt")
      .sort("name").lean();

    return res.json(faculty);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load faculty" });
  }
}

async function createFaculty(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["name", "email", "password", "department", "phone"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { name, email, password, department, phone } = body;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || !isValidEmail(email) || !isAcceptablePassword(password)) {
      return res.status(400).json({
        message: `Provide a valid name, email, and password (${MIN_PASSWORD_LENGTH}+ characters, maximum 72 UTF-8 bytes).`,
      });
    }
    if ((department !== undefined && (typeof department !== "string" || department.length > 120)) || (phone !== undefined && (typeof phone !== "string" || phone.length > 30))) return res.status(400).json({ message: "Faculty profile fields are invalid." });

    const faculty = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: await hashPassword(password),
      department: department?.trim() || null,
      phone: phone?.trim() || "",
      role: "faculty",
    });
    const safeFaculty = faculty.toObject();
    delete safeFaculty.password;

    return res.status(201).json(safeFaculty);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000 ? "Email already registered" : error.message;

    return res.status(status).json({ message });
  }
}

async function updateFaculty(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["name", "email", "department", "phone", "password"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { name, email, department, phone, password } = body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return res.status(400).json({ message: "Name is invalid." });
      updates.name = name.trim();
    }
    if (email !== undefined) {
      if (!isValidEmail(email)) return res.status(400).json({ message: "Email is invalid." });
      updates.email = email.trim().toLowerCase();
    }
    if (department !== undefined && (typeof department !== "string" || department.length > 120)) return res.status(400).json({ message: "Department is invalid." });
    if (phone !== undefined && (typeof phone !== "string" || phone.length > 30)) return res.status(400).json({ message: "Phone is invalid." });
    if (department !== undefined) updates.department = department;
    if (phone !== undefined) updates.phone = phone;

    if (password !== undefined) {
      if (!isAcceptablePassword(password)) {
        return res.status(400).json({
          message: `Password must be ${MIN_PASSWORD_LENGTH}+ characters and no more than 72 UTF-8 bytes.`,
        });
      }

      updates.password = await hashPassword(password);
    }

    const faculty = await User.findOneAndUpdate(
      { _id: req.params.id, role: "faculty" },
      updates,
      { new: true, runValidators: true },
    ).select("-password");

    if (!faculty) {
      return res.status(404).json({ message: "Faculty member not found" });
    }

    return res.json(faculty);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000 ? "Email already registered" : error.message;

    return res.status(status).json({ message });
  }
}

async function deleteFaculty(req, res) {
  try {
    const assignedClass = await CampusClass.exists({ faculty: req.params.id });

    if (assignedClass) {
      return res.status(409).json({
        message: "Reassign this faculty member's classes before removing them",
      });
    }

    const faculty = await User.findOneAndDelete({
      _id: req.params.id,
      role: "faculty",
    });

    if (!faculty) {
      return res.status(404).json({ message: "Faculty member not found" });
    }

    return res.json({ message: "Faculty member removed" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

module.exports = { listFaculty, createFaculty, updateFaculty, deleteFaculty };
