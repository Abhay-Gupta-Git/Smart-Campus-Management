const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hashPassword, verifyPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { normalizeRole } = require("../utils/roles");
const { isValidEmail, hasOnlyFields } = require("../utils/validation");

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
  const normalizedRole = normalizeRole(requestedRole || "student");

  if (normalizedRole === "admin") {
    const error = new Error(
      "Administrator signup is disabled. Use the backend initial-admin setup command.",
    );
    error.status = 403;
    throw error;
  }

  if (normalizedRole !== "student") {
    const error = new Error("Faculty, technician, and administrator accounts must be provisioned by an administrator.");
    error.status = 403;
    throw error;
  }

  return normalizedRole;
}

async function register(req, res) {
  try {
    const body = req.body || {};
    if (!hasOnlyFields(body, ["name", "email", "password", "studentId", "department", "role"])) {
      return res.status(400).json({ message: "Request contains unsupported fields." });
    }
    const { name, email, password, studentId, department, role } = body;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || !isValidEmail(email) || !isAcceptablePassword(password)) {
      return res.status(400).json({
        message: `Provide a valid name, email, and password (${MIN_PASSWORD_LENGTH}+ characters, maximum 72 UTF-8 bytes).`,
      });
    }
    if ((studentId !== undefined && (typeof studentId !== "string" || studentId.length > 64)) ||
      (department !== undefined && (typeof department !== "string" || department.length > 120))) {
      return res.status(400).json({ message: "Student ID or department is invalid." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const assignedRole = getRegistrationRole(role);
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const hashedPassword = await hashPassword(password);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: assignedRole,
      studentId: studentId?.trim() || undefined,
      department: department?.trim() || undefined,
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
    const body = req.body || {};
    if (!hasOnlyFields(body, ["email", "password"])) {
      return res.status(400).json({ message: "Request contains unsupported fields." });
    }
    const { email, password } = body;

    if (!isValidEmail(email) || typeof password !== "string" || !password.length || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        message: "A valid email and password of at most 72 UTF-8 bytes are required.",
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

    const passwordMatches = await verifyPassword(password, user.password);

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

    const token = jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1d" },
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
