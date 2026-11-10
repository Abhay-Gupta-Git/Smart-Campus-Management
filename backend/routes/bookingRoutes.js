const express = require("express");
const bookingController = require("../controllers/bookingController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.post("/", authorizeRoles("admin", "faculty", "student"), bookingController.createBooking);
router.get("/", bookingController.getBookings);
router.patch("/:id/status", authorizeRoles("admin"), bookingController.decideBooking);
router.patch("/:id/cancel", authorizeRoles("admin", "faculty", "student"), bookingController.cancelBooking);

module.exports = router;
