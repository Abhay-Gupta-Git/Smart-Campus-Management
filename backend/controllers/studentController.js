const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function listStudents(req, res) {
  try {
    const students = await User.find({ role: "student" })
      .select("-password")
      .sort("name");

    return res.json(students);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load students" });
  }
}

async function createStudent(req, res) {
  try {
    const { name, email, password, studentId, department, phone } = req.body;

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        message:
          "Name, email and password (at least 8 characters) are required",
      });
    }

    const student = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, 10),
      studentId,
      department,
      phone,
      role: "student",
    });
    const safeStudent = student.toObject();
    delete safeStudent.password;

    return res.status(201).json(safeStudent);
  } catch (error) {
    const statusCode = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000 ? "Email already registered" : error.message;

    return res.status(statusCode).json({ message });
  }
}

async function updateStudent(req, res) {
  try {
    const { name, email, studentId, department, phone, password } = req.body;
    const updates = {};

    if (name !== undefined) {
      updates.name = name;
    }

    if (email !== undefined) {
      updates.email = email.trim().toLowerCase();
    }

    if (studentId !== undefined) {
      updates.studentId = studentId;
    }

    if (department !== undefined) {
      updates.department = department;
    }

    if (phone !== undefined) {
      updates.phone = phone;
    }

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
        });
      }

      updates.password = await bcrypt.hash(password, 10);
    }

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: "student" },
      updates,
      { new: true, runValidators: true },
    ).select("-password");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.json(student);
  } catch (error) {
    const statusCode = error.code === 11000 ? 409 : 400;
    const message =
      error.code === 11000 ? "Email already registered" : error.message;

    return res.status(statusCode).json({ message });
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
    return res.status(400).json({ message: error.message });
  }
}

module.exports = {
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
};
