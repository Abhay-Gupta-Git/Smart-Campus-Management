const express = require("express");
const Complaint = require("../models/Complaint");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", async (req, res) => {
  try {
    const filter =
      req.user.role === "admin" ? {} : { submittedBy: req.user.id };
    const complaints = await Complaint.find(filter)
      .populate("submittedBy", "name email")
      .sort("-createdAt");

    return res.json(complaints);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load complaints" });
  }
});

router.post("/", async (req, res) => {
  try {
    const complaint = await Complaint.create({
      ...req.body,
      submittedBy: req.user.id,
    });

    return res.status(201).json(complaint);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.patch("/:id", authorizeRoles("admin"), async (req, res) => {
  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true },
    );

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    return res.json(complaint);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

module.exports = router;
