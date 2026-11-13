const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { actor: req.user.id };
    const activities = await ActivityLog.find(filter)
      .populate("actor", "name role")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json(activities);
  } catch (error) {
    console.error("Activity history request failed:", error.message);
    return res.status(500).json({ message: "Failed to load activity history." });
  }
});

module.exports = router;
