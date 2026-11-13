const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { protect } = require("../middleware/authMiddleware");
const { readPagination, executeListQuery } = require("../utils/pagination");

const router = express.Router();
router.use(protect);

function logNotificationFailure(event, error) {
  console.error("Notification request failed:", JSON.stringify({ event, error: error.name || "Error", code: error.code || "unknown" }));
}

router.get("/unread-count", async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ recipient: req.user.id, readAt: null });
    return res.json({ unreadCount });
  } catch (error) {
    logNotificationFailure("unread_count_failed", error);
    return res.status(500).json({ message: "Failed to load unread notification count." });
  }
});

router.get("/", async (req, res) => {
  try {
    const filter = { recipient: req.user.id };
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const query = Notification.find(filter)
      .populate({ path: "complaint", select: "title status room", populate: { path: "room", select: "name building" } })
      .sort("-createdAt")
      .lean();
    if (!pagination) query.limit(50);
    const notifications = await executeListQuery({ query, Model: Notification, filter, pagination, res });
    return res.json(notifications);
  } catch (error) {
    logNotificationFailure("list_failed", error);
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
    logNotificationFailure("mark_all_read_failed", error);
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
    logNotificationFailure("mark_read_failed", error);
    return res.status(500).json({ message: "Failed to update notification." });
  }
});

router.patch("/:id/unread", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid notification ID." });
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { $set: { readAt: null } },
      { new: true },
    );
    if (!notification) return res.status(404).json({ message: "Notification not found." });
    return res.json({ id: notification._id, readAt: notification.readAt });
  } catch (error) {
    logNotificationFailure("mark_unread_failed", error);
    return res.status(500).json({ message: "Failed to update notification." });
  }
});

module.exports = router;
