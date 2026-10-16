const express = require("express");
const bookingController = require("../controllers/bookingController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.post(
  "/",
  protect,
  authorizeRoles("admin", "faculty"),
  bookingController.createBooking,
);
router.get("/", protect, bookingController.getBookings);
router.put(
  "/:id",
  protect,
  authorizeRoles("admin", "faculty"),
  bookingController.updateBooking,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("admin"),
  bookingController.deleteBooking,
);

module.exports = router;
