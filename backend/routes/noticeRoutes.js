const express = require("express");
const Notice = require("../models/Notice");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", async (req, res) => {
  try {
    const filter =
      req.user.role === "admin"
        ? {}
        : { $or: [{ audience: "all" }, { audience: req.user.role }] };
    const notices = await Notice.find(filter)
      .populate("author", "name")
      .sort("-createdAt");

    return res.json(notices);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load notices" });
  }
});

router.post("/", authorizeRoles("admin", "faculty"), async (req, res) => {
  try {
    const allowedAudiences = ["all", "student", "faculty"];
    const audience = req.body.audience || "all";

    if (!allowedAudiences.includes(audience)) {
      return res
        .status(400)
        .json({ message: "Select a valid notice audience" });
    }

    const notice = await Notice.create({
      ...req.body,
      audience,
      author: req.user.id,
    });

    return res.status(201).json(notice);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", authorizeRoles("admin"), async (req, res) => {
  try {
    const notice = await Notice.findByIdAndDelete(req.params.id);

    if (!notice) {
      return res.status(404).json({ message: "Notice not found" });
    }

    return res.json({ message: "Notice removed" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

module.exports = router;
