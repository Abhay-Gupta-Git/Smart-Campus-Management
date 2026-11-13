const express = require("express");
const bookingController = require("../controllers/bookingController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const bookingRequestLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 30, message: "Too many booking requests. Try again later." });

router.use(protect);
router.post("/", authorizeRoles("admin", "faculty", "student"), bookingRequestLimiter, bookingController.createBooking);
router.get("/", bookingController.getBookings);
router.patch("/:id/status", authorizeRoles("admin"), bookingController.decideBooking);
router.patch("/:id/cancel", authorizeRoles("admin", "faculty", "student"), bookingController.cancelBooking);

module.exports = router;
