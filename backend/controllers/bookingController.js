const Booking = require("../models/Booking");
const Room = require("../models/Room");

function isValidTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function hasValidBookingDetails(details) {
  const { room, date, startTime, endTime, purpose } = details;
  const hasRequiredFields = room && date && startTime && endTime && purpose;
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "");

  return Boolean(
    hasRequiredFields &&
    hasValidDate &&
    isValidTime(startTime) &&
    isValidTime(endTime) &&
    startTime < endTime,
  );
}

async function findBookingConflict(details, excludedBookingId) {
  const filter = {
    room: details.room,
    date: details.date,
    startTime: { $lt: details.endTime },
    endTime: { $gt: details.startTime },
  };

  if (excludedBookingId) {
    filter._id = { $ne: excludedBookingId };
  }

  return Booking.findOne(filter);
}

async function createBooking(req, res) {
  try {
    if (!hasValidBookingDetails(req.body)) {
      return res.status(400).json({ message: "Invalid booking details" });
    }

    const roomExists = await Room.exists({ _id: req.body.room });

    if (!roomExists) {
      return res.status(404).json({ message: "Room not found" });
    }

    const conflict = await findBookingConflict(req.body);

    if (conflict) {
      return res.status(409).json({
        message: "Room is already booked for this time slot",
      });
    }

    const booking = await Booking.create({
      ...req.body,
      bookedBy: req.user.id,
    });
    const populatedBooking = await Booking.findById(booking._id)
      .populate("room")
      .populate("bookedBy", "name email");

    return res.status(201).json({
      message: "Room booked successfully",
      booking: populatedBooking,
    });
  } catch (error) {
    console.error("Create booking error:", error.message);
    return res.status(500).json({ message: "Booking failed" });
  }
}

async function getBookings(req, res) {
  try {
    if (req.user.role === "student") {
      return res.status(403).json({
        message: "Students cannot view booking records",
      });
    }

    const filter = {};

    if (req.query.date) {
      filter.date = req.query.date;
    }

    if (req.user.role === "faculty") {
      filter.bookedBy = req.user.id;
    }

    const bookings = await Booking.find(filter)
      .populate("room")
      .populate("bookedBy", "name email")
      .sort({ date: 1, startTime: 1 });

    return res.json(bookings);
  } catch (error) {
    console.error("Get bookings error:", error.message);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
}

async function updateBooking(req, res) {
  try {
    const bookingDetails = req.body;

    if (!hasValidBookingDetails(bookingDetails)) {
      return res.status(400).json({ message: "Provide valid booking details" });
    }

    const roomExists = await Room.exists({ _id: bookingDetails.room });

    if (!roomExists) {
      return res.status(404).json({ message: "Room not found" });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const isOwner = booking.bookedBy.toString() === req.user.id;

    if (req.user.role !== "admin" && !isOwner) {
      return res
        .status(403)
        .json({ message: "You cannot update this booking" });
    }

    const conflict = await findBookingConflict(bookingDetails, booking._id);

    if (conflict) {
      return res.status(409).json({
        message: "Room is already booked for this time slot",
      });
    }

    Object.assign(booking, bookingDetails);
    await booking.save();

    return res.json({ message: "Booking updated successfully", booking });
  } catch (error) {
    console.error("Update booking error:", error.message);
    return res.status(500).json({ message: "Failed to update booking" });
  }
}

async function deleteBooking(req, res) {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const isOwner = booking.bookedBy.toString() === req.user.id;

    if (req.user.role !== "admin" && !isOwner) {
      return res
        .status(403)
        .json({ message: "You cannot delete this booking" });
    }

    await booking.deleteOne();
    return res.json({ message: "Booking deleted successfully" });
  } catch (error) {
    console.error("Delete booking error:", error.message);
    return res.status(500).json({ message: "Failed to delete booking" });
  }
}

module.exports = {
  createBooking,
  getBookings,
  updateBooking,
  deleteBooking,
};
