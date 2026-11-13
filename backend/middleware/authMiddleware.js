const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const { normalizeRole } = require("../utils/roles");

async function protect(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ message: "Authentication is not configured" });
  }

  const authorizationHeader = req.headers.authorization;

  const authorization = typeof authorizationHeader === "string"
    ? authorizationHeader.match(/^Bearer ([^\s]+)$/i)
    : null;
  if (!authorization) {
    return res.status(401).json({ message: "Access denied. Token required." });
  }

  const token = authorization[1];

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const now = Math.floor(Date.now() / 1000);
    if (typeof decodedToken.exp !== "number" || decodedToken.exp <= now ||
      (decodedToken.iat !== undefined && decodedToken.iat > now + 60) ||
      typeof decodedToken.id !== "string" || !mongoose.isValidObjectId(decodedToken.id)) {
      return res.status(401).json({ message: "Invalid or expired token." });
    }
    const user = await User.findById(decodedToken.id).select("_id name email role studentId department").lean();

    if (!user) {
      return res.status(401).json({ message: "Account no longer exists" });
    }

    const role = normalizeRole(user.role);

    if (!role) {
      return res
        .status(403)
        .json({ message: "Account role is not recognized" });
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
