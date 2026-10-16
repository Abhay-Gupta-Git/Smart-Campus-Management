const bcrypt = require("bcryptjs");
const User = require("../models/User");

const minimumPasswordLength = 12;
const maximumBcryptPasswordBytes = 72;

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function hasUnsupportedFields(body) {
  const allowedFields = new Set(["email", "name", "password"]);

  return Object.keys(body).some((field) => !allowedFields.has(field));
}

async function provisionConfiguredAdmin(req, res) {
  try {
    const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    if (!isValidEmail(configuredEmail)) {
      return res.status(503).json({
        message: "Administrator provisioning is not configured.",
      });
    }

    const body = req.body || {};

    if (hasUnsupportedFields(body)) {
      return res.status(400).json({
        message: "Only email, name, and password fields are accepted.",
      });
    }

    if (typeof body.email !== "string") {
      return res.status(400).json({ message: "A valid email is required." });
    }

    const requestedEmail = body.email.trim().toLowerCase();

    if (!isValidEmail(requestedEmail)) {
      return res.status(400).json({ message: "A valid email is required." });
    }

    if (requestedEmail !== configuredEmail) {
      return res.status(403).json({
        message:
          "This endpoint can only provision the configured administrator account.",
      });
    }

    const existingUser = await User.findOne({ email: configuredEmail });

    if (existingUser) {
      if (existingUser.role === "admin") {
        return res.status(409).json({
          message: "The configured administrator account already exists.",
        });
      }

      if (!["student", "faculty"].includes(existingUser.role)) {
        return res.status(409).json({
          message:
            "The configured account cannot be promoted from its current role.",
        });
      }

      if (body.name !== undefined || body.password !== undefined) {
        return res.status(400).json({
          message:
            "Promotion accepts only the configured email and preserves existing account data.",
        });
      }

      existingUser.role = "admin";
      await existingUser.save({ timestamps: false });

      return res.status(200).json({
        message: "The configured account was promoted to administrator.",
      });
    }

    if (typeof body.name !== "string" || !body.name.trim()) {
      return res.status(400).json({
        message: "A name is required when creating the administrator account.",
      });
    }

    if (
      typeof body.password !== "string" ||
      body.password.length < minimumPasswordLength ||
      Buffer.byteLength(body.password, "utf8") > maximumBcryptPasswordBytes
    ) {
      return res.status(400).json({
        message:
          "Password must be at least 12 characters and no more than 72 UTF-8 bytes.",
      });
    }

    const hashedPassword = await bcrypt.hash(body.password, 12);

    await User.create({
      name: body.name.trim(),
      email: configuredEmail,
      password: hashedPassword,
      role: "admin",
    });

    return res.status(201).json({
      message: "The configured administrator account was created.",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "An account with the configured email already exists.",
      });
    }

    return res.status(500).json({
      message: "Unable to provision the configured administrator account.",
    });
  }
}

module.exports = { provisionConfiguredAdmin };
