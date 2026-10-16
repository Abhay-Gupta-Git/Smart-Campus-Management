const jwt = require("jsonwebtoken");
const User = require("../models/User");

function normalizeRole(role) {
  const normalizedRole = String(role || "")
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

async function protect(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ message: "Authentication is not configured" });
  }

  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access denied. Token required." });
  }

  const token = authorizationHeader.split(" ")[1];

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decodedToken.id);

    if (!user) {
      return res.status(401).json({ message: "Account no longer exists" });
    }

    const role = normalizeRole(user.role);

    if (!role) {
      return res
        .status(403)
        .json({ message: "Account role is not recognized" });
    }

    if (user.role !== role) {
      user.role = role;
      await user.save();
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role,
      studentId: user.studentId,
      department: user.department,
    };
    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    console.error("Authentication lookup failed:", error.message);
    return res.status(500).json({ message: "Authentication check failed" });
  }
}

function authorizeRoles(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied. You do not have permission.",
      });
    }

    return next();
  };
}

module.exports = { protect, authorizeRoles };
