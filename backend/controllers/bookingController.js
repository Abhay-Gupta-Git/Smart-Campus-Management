
const Booking = require("../models/Booking");
const Room = require("../models/Room");

const isValidTime = (time) => {
  return typeof time === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
};

const createBooking = async (req, res) => {
  try {
    const { room, date, startTime, endTime, purpose } = req.body;

    if (!room || !date || !startTime || !endTime || !purpose) {
      return res.status(400).json({
        message: "All booking fields are required"
      });
    }

    if (
      !isValidTime(startTime) ||
      !isValidTime(endTime) ||
      startTime >= endTime ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return res.status(400).json({
        message: "Invalid date or time"
      });
    }

    const roomExists = await Room.findById(room);

    if (!roomExists) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const conflict = await Booking.findOne({
      room,
      date,
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });

    if (conflict) {
      return res.status(409).json({
        message: "Room is already booked for this time slot"
      });
    }

    const booking = await Booking.create({
      room,
      date,
      startTime,
      endTime,
      purpose,
      bookedBy: req.user.id
    });

    const result = await Booking.findById(booking._id)
      .populate("room")
      .populate("bookedBy", "name email");

    return res.status(201).json({
      message: "Room booked successfully",
      booking: result
    });
  } catch (error) {
    console.error("Create booking error:", error.message);

    return res.status(500).json({
      message: "Booking failed"
    });
  }
};

const getBookings = async (req, res) => {
  try {
    if (req.user.role === "student") {
      return res.status(403).json({
        message: "Students cannot view booking records"
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

    return res.status(500).json({
      message: "Failed to fetch bookings"
    });
  }
};

const updateBooking = async (req, res) => {
  try {
    const { room, date, startTime, endTime, purpose } = req.body;

    if (
      !room || !date || !startTime || !endTime || !purpose ||
      !isValidTime(startTime) ||
      !isValidTime(endTime) ||
      startTime >= endTime ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return res.status(400).json({
        message: "Provide valid booking details"
      });
    }

    if (!(await Room.exists({ _id: room }))) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (
      req.user.role !== "admin" &&
      booking.bookedBy.toString() !== req.user.id
    ) {
      return res.status(403).json({
        message: "You cannot update this booking"
      });
    }

    const conflict = await Booking.findOne({
      _id: { $ne: booking._id },
      room,
      date,
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });

    if (conflict) {
      return res.status(409).json({
        message: "Room is already booked for this time slot"
      });
    }

    booking.room = room;
    booking.date = date;
    booking.startTime = startTime;
    booking.endTime = endTime;
    booking.purpose = purpose;

    await booking.save();

    return res.json({
      message: "Booking updated successfully",
      booking
    });
  } catch (error) {
    console.error("Update booking error:", error.message);

    return res.status(500).json({
      message: "Failed to update booking"
    });
  }
};

const deleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (
      req.user.role !== "admin" &&
      booking.bookedBy.toString() !== req.user.id
    ) {
      return res.status(403).json({
        message: "You cannot delete this booking"
      });
    }

    await booking.deleteOne();

    return res.json({
      message: "Booking deleted successfully"
    });
  } catch (error) {
    console.error("Delete booking error:", error.message);

    return res.status(500).json({
      message: "Failed to delete booking"
    });
  }
};

module.exports = {
  createBooking,
  getBookings,
  updateBooking,
  deleteBooking
};
