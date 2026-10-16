const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentId: user.studentId,
    department: user.department,
  };
}

function getRegistrationRole(requestedRole) {
  const normalizedRole = normalizeRole(requestedRole);

  if (normalizedRole === "admin") {
    const error = new Error(
      "Administrator signup is disabled. Use the backend initial-admin setup command.",
    );
    error.status = 403;
    throw error;
  }

  if (normalizedRole !== "student" && normalizedRole !== "faculty") {
    const error = new Error("Select a supported account role");
    error.status = 400;
    throw error;
  }

  return normalizedRole;
}

function normalizeRole(role) {
  const normalizedRole = String(role || "student")
    .trim()
    .toLowerCase();

  if (normalizedRole === "admin" || normalizedRole === "administrator") {
    return "admin";
  }

  if (normalizedRole === "faculty" || normalizedRole === "teacher") {
    return "faculty";
  }

  if (normalizedRole === "student") {
    return "student";
  }

  return null;
}

async function register(req, res) {
  try {
    const { name, email, password, studentId, department, role } = req.body;

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        message:
          "Name, email and password (at least 8 characters) are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const assignedRole = getRegistrationRole(role);
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: assignedRole,
      studentId,
      department,
    });

    return res.status(201).json({
      message: "Registration successful",
      user: getPublicUser(user),
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: "Email already registered" });
    }

    console.error("Registration failed:", error.message);
    return res.status(500).json({ message: "Registration failed" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Authentication is not configured",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const currentRole = normalizeRole(user.role);

    if (!currentRole) {
      return res.status(403).json({
        message:
          "This account has an unsupported role. Contact an administrator.",
      });
    }

    if (user.role !== currentRole) {
      user.role = currentRole;
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.json({
      message: "Login successful",
      token,
      user: getPublicUser(user),
    });
  } catch (error) {
    console.error("Login failed:", error.message);
    return res.status(500).json({ message: "Login failed" });
  }
}

module.exports = { register, login };
