const User = require("../models/User");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { isValidEmail } = require("../utils/validation");
const recordActivity = require("../utils/activityLog");

const minimumPasswordLength = MIN_PASSWORD_LENGTH;

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

      const promotion = await User.updateOne(
        { _id: existingUser._id, role: existingUser.role },
        { $set: { role: "admin" }, $inc: { tokenVersion: 1 } },
        { timestamps: false, runValidators: true },
      );
      if (!promotion.modifiedCount) return res.status(409).json({ message: "The configured account changed while it was being promoted. Retry the request." });

      await recordActivity({ actor: req.user.id, action: "Account role changed", entityType: "account", entityId: existingUser._id, summary: "Promoted a configured account to administrator." });

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
      !isAcceptablePassword(body.password)
    ) {
      return res.status(400).json({
        message:
          "Password must be at least 12 characters and no more than 72 UTF-8 bytes.",
      });
    }

    const hashedPassword = await hashPassword(body.password);

    const createdAdmin = await User.create({
      name: body.name.trim(),
      email: configuredEmail,
      password: hashedPassword,
      role: "admin",
    });

    await recordActivity({ actor: req.user.id, action: "Administrator account created", entityType: "account", entityId: createdAdmin._id, summary: "Created the configured administrator account." });

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

async function provisionTechnician(req, res) {
  const body = req.body || {};
  if (Object.keys(body).some((key) => !["name", "email", "password"].includes(key))) {
    return res.status(400).json({ message: "Only name, email, and password are accepted." });
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120 || !isValidEmail(body.email)) {
    return res.status(400).json({ message: "A valid name and email are required." });
  }
  if (!isAcceptablePassword(body.password)) {
    return res.status(400).json({ message: "Password must be at least 12 characters and no more than 72 UTF-8 bytes." });
  }
  try {
    const email = body.email.trim().toLowerCase();
    const exists = await User.exists({ email });
    if (exists) return res.status(409).json({ message: "An account with this email already exists." });
    const password = await hashPassword(body.password);
    const technician = await User.create({ name: body.name.trim(), email, password, role: "technician" });
    await recordActivity({ actor: req.user.id, action: "Technician account created", entityType: "account", entityId: technician._id, summary: "Created a technician account." });
    return res.status(201).json({ technician: { id: technician._id, name: technician.name, role: technician.role } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "An account with this email already exists." });
    console.error("Technician provisioning failed:", error.name || "Error");
    return res.status(500).json({ message: "Unable to create technician account." });
  }
}

async function listTechnicians(req, res) {
  try {
    const filter = { role: "technician" };
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    const sort = readSort(req, res, ["name", "createdAt"], "name");
    if (sort === false) return;
    if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
    const technicians = await executeListQuery({ query: User.find(filter).select("name role createdAt").sort(sort).lean(), Model: User, filter, pagination, res });
    return res.json(technicians.map(({ _id, name, role, createdAt }) => ({ id: _id, name, role, createdAt })));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load technician accounts." });
  }
}

module.exports = { provisionConfiguredAdmin, provisionTechnician, listTechnicians };
