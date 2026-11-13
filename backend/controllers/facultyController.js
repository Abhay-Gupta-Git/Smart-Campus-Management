const mongoose = require("mongoose");
const CampusClass = require("../models/CampusClass");
const User = require("../models/User");
const { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { isValidEmail, hasOnlyFields } = require("../utils/validation");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");
const { runTransaction, lockUserReference } = require("../utils/transactions");
const recordActivity = require("../utils/activityLog");

async function listFaculty(req, res) {
  try {
    const filter = { role: "faculty" };
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    const sort = readSort(req, res, ["name", "email", "department", "createdAt"], "name");
    if (sort === false) return;
    if (search) filter.$or = ["name", "email", "department"].map((field) => ({
      [field]: { $regex: escapeRegex(search), $options: "i" },
    }));
    const faculty = await executeListQuery({ query: User.find(filter)
      .select("name email role department phone createdAt")
      .sort(sort).lean(), Model: User, filter, pagination, res });

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

    await recordActivity({ actor: req.user.id, action: "Faculty account created", entityType: "account", entityId: faculty._id, summary: "Created a faculty account." });

    return res.status(201).json(safeFaculty);
  } catch (error) {
    return respondError(res, error, "Faculty creation", "Unable to create faculty account.");
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
    if (!Object.keys(updates).length) return res.status(400).json({ message: "Provide at least one field to update." });

    const faculty = await User.findOneAndUpdate(
      { _id: req.params.id, role: "faculty" },
      { $set: updates, ...(password !== undefined ? { $inc: { tokenVersion: 1 } } : {}) },
      { new: true, runValidators: true },
    ).select("-password");

    if (!faculty) {
      return res.status(404).json({ message: "Faculty member not found" });
    }

    await recordActivity({ actor: req.user.id, action: "Faculty account updated", entityType: "account", entityId: faculty._id, summary: "Updated a faculty account profile." });

    return res.json(faculty);
  } catch (error) {
    return respondError(res, error, "Faculty update", "Unable to update faculty account.");
  }
}

async function deleteFaculty(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid faculty ID." });
    const result = await runTransaction(async (session) => {
      if (!await lockUserReference(User, req.params.id, "faculty", session)) {
        return { status: 404, message: "Faculty member not found" };
      }
      const assignedClass = await CampusClass.exists({ faculty: req.params.id }).session(session);
      if (assignedClass) {
        return { status: 409, message: "Reassign this faculty member's classes before removing them" };
      }
      await User.deleteOne({ _id: req.params.id, role: "faculty" }, { session });
      return { status: 200 };
    });
    if (result.status !== 200) return res.status(result.status).json({ message: result.message });

    await recordActivity({ actor: req.user.id, action: "Faculty account deleted", entityType: "account", entityId: req.params.id, summary: "Removed a faculty account." });

    return res.json({ message: "Faculty member removed" });
  } catch (error) {
    return respondError(res, error, "Faculty deletion", "Unable to remove faculty account.");
  }
}

module.exports = { listFaculty, createFaculty, updateFaculty, deleteFaculty };
