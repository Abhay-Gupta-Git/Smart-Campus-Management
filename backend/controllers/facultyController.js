const bcrypt = require("bcryptjs");
const CampusClass = require("../models/CampusClass");
const User = require("../models/User");

async function listFaculty(req, res) {
  try {
    const faculty = await User.find({ role: "faculty" })
      .select("-password")
      .sort("name");

    return res.json(faculty);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load faculty" });
  }
}

async function createFaculty(req, res) {
  try {
    const { name, email, password, department, phone } = req.body;

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        message:
          "Name, email and password (at least 8 characters) are required",
      });
    }

    const faculty = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, 10),
      department,
      phone,
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
    const { name, email, department, phone, password } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (department !== undefined) updates.department = department;
    if (phone !== undefined) updates.phone = phone;

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
        });
      }

      updates.password = await bcrypt.hash(password, 10);
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
