const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const { protect } = require("../middleware/authMiddleware");
const { readPagination, executeListQuery } = require("../utils/pagination");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { actor: req.user.id };
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const query = ActivityLog.find(filter)
      .populate("actor", "name role")
      .sort({ createdAt: -1 })
      .lean();
    if (!pagination) query.limit(200);
    const activities = await executeListQuery({ query, Model: ActivityLog, filter, pagination, res });
    return res.json(activities);
  } catch (error) {
    console.error("Activity history request failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load activity history." });
  }
});

module.exports = router;
