
const express = require("express");
const router = express.Router();

const bookingController = require("../controllers/bookingController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

router.post(
  "/",
  protect,
  authorizeRoles("admin", "faculty"),
  bookingController.createBooking
);

router.get(
  "/",
  protect,
  bookingController.getBookings
);

router.put(
  "/:id",
  protect,
  authorizeRoles("admin", "faculty"),
  bookingController.updateBooking
);

router.delete(
  "/:id",
  protect,
  authorizeRoles("admin"),
  bookingController.deleteBooking
);

module.exports = router;
