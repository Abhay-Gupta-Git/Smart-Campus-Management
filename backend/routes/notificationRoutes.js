const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);

router.get("/unread-count", async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ recipient: req.user.id, readAt: null });
    return res.json({ unreadCount });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load unread notification count." });
  }
});

router.get("/", async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id })
      .populate({ path: "complaint", select: "title status room", populate: { path: "room", select: "name building" } })
      .sort("-createdAt")
      .limit(50)
      .lean();
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load notifications." });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return res.json({ updated: result.modifiedCount });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notifications as read." });
  }
});

router.patch("/:id/read", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid notification ID." });
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!notification) return res.status(404).json({ message: "Notification not found." });
    return res.json({ id: notification._id, readAt: notification.readAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update notification." });
  }
});

module.exports = router;
