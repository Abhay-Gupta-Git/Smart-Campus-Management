const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Room = require("../models/Room");
const Notification = require("../models/Notification");
const User = require("../models/User");
const recordActivity = require("../utils/activityLog");
const { readPagination, executeListQuery } = require("../utils/pagination");
const { isValidDateString } = require("../utils/validation");

async function notifyBooking(recipients, title, message) {
  try {
    const ids = [...new Set(recipients.filter(Boolean).map((id) => id.toString()))];
    if (ids.length) await Notification.insertMany(ids.map((recipient) => ({ recipient, title, message })));
  } catch (error) {
    console.error("Booking notification failed:", error.name || "Error");
  }
}

function isValidTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function isValidDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date &&
    date >= new Date().toISOString().slice(0, 10);
}

function validateDetails(details) {
  if (!details || !mongoose.isValidObjectId(details.room) || !isValidDate(details.date) ||
    !isValidTime(details.startTime) || !isValidTime(details.endTime) ||
    details.startTime >= details.endTime || typeof details.purpose !== "string" ||
    !details.purpose.trim() || details.purpose.trim().length > 500) {
    return "Provide a room, valid upcoming date, start and end times, and a purpose of 1–500 characters.";
  }
  return null;
}

function conflictFilter(details, excludedId) {
  const filter = {
    room: details.room,
    date: details.date,
    status: "Approved",
    startTime: { $lt: details.endTime },
    endTime: { $gt: details.startTime },
  };
  if (excludedId) filter._id = { $ne: excludedId };
  return filter;
}

async function populatedBooking(id, session) {
  let query = Booking.findById(id).populate("room").populate("bookedBy", "name");
  if (session) query = query.session(session);
  return query;
}

function handleError(res, error, fallback) {
  if (error.code === 11000) return res.status(409).json({ message: "This booking conflicts with another request." });
  if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: "Booking request data is invalid." });
  if (error.code === 20 || /transaction numbers are only allowed|replica set/i.test(error.message || "")) {
    return res.status(503).json({ message: "Booking approval requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
  }
  console.error(`${fallback}:`, error.name || "Error");
  return res.status(500).json({ message: fallback });
}

async function createBooking(req, res) {
  const validationError = validateDetails(req.body);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    const room = await Room.findById(req.body.room);
    if (!room) return res.status(404).json({ message: "Room not found." });
    if (!room.available) return res.status(409).json({ message: "This room is currently unavailable." });

    const booking = await Booking.create({
      room: room._id,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      purpose: req.body.purpose.trim(),
      bookedBy: req.user.id,
      status: "Pending",
    });
    await recordActivity({ actor: req.user.id, action: "Booking requested", entityType: "booking", entityId: booking._id, summary: `Requested ${room.name} in ${room.building} for ${booking.date}.` });
    try {
      const admins = await User.find({ role: "admin" }).select("_id").lean();
      await notifyBooking(admins.map((admin) => admin._id), "New room booking request", `${room.name} in ${room.building} requested for ${booking.date}, ${booking.startTime}–${booking.endTime}.`);
    } catch (error) { console.error("Booking notification recipients lookup failed:", error.name || "Error"); }
    return res.status(201).json({ message: "Booking request submitted for approval.", booking: await populatedBooking(booking._id) });
  } catch (error) {
    return handleError(res, error, "Booking request failed.");
  }
}

async function getBookings(req, res) {
  try {
    const filter = req.user.role === "admin" ? {} : { bookedBy: req.user.id };
    if (req.query.date) {
      if (!isValidDateString(req.query.date)) return res.status(400).json({ message: "Date filter must use a valid YYYY-MM-DD date." });
      filter.date = req.query.date;
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const bookings = await executeListQuery({ query: Booking.find(filter)
      .populate("room")
      .populate("bookedBy", "name")
      .sort({ date: 1, startTime: 1, createdAt: -1 }), Model: Booking, filter, pagination, res });
    return res.json(bookings);
  } catch (error) {
    return handleError(res, error, "Failed to fetch booking requests.");
  }
}

async function decideBooking(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid booking ID." });
  if (!["Approved", "Rejected"].includes(status)) return res.status(400).json({ message: "Status must be Approved or Rejected." });

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const booking = await Booking.findById(id).session(session);
      if (!booking) {
        result = { code: 404, message: "Booking request not found." };
        return;
      }
      if (booking.bookedBy.toString() === req.user.id) {
        result = { code: 403, message: "You cannot approve or reject your own booking request." };
        return;
      }
      if (booking.status !== "Pending") {
        result = { code: 409, message: `This request is already ${booking.status.toLowerCase()}.` };
        return;
      }
      const roomUpdate = await Room.updateOne(
        { _id: booking.room },
        { $inc: { scheduleVersion: 1 } },
        { session },
      );
      if (!roomUpdate.matchedCount) {
        result = { code: 404, message: "The requested room no longer exists." };
        return;
      }
      if (status === "Approved") {
        const conflict = await Booking.findOne(conflictFilter(booking, booking._id)).session(session);
        if (conflict) {
          result = { code: 409, message: "This time overlaps an approved booking for the same room." };
          return;
        }
      }
      booking.status = status;
      await booking.save({ session });
      result = { code: 200, bookingId: booking._id };
    });

    if (result?.code !== 200) return res.status(result?.code || 409).json({ message: result?.message || "Booking decision could not be completed." });
    const updatedBooking = await populatedBooking(result.bookingId);
    await recordActivity({ actor: req.user.id, action: `Booking ${status.toLowerCase()}`, entityType: "booking", entityId: result.bookingId, summary: `${updatedBooking.room?.name || "Room"} booking for ${updatedBooking.date} was ${status.toLowerCase()}.` });
    await notifyBooking([updatedBooking.bookedBy?._id], `Booking ${status.toLowerCase()}`, `Your request for ${updatedBooking.room?.name || "a room"} on ${updatedBooking.date} was ${status.toLowerCase()}.`);
    return res.json({ message: `Booking ${status.toLowerCase()} successfully.`, booking: updatedBooking });
  } catch (error) {
    return handleError(res, error, "Failed to update booking decision.");
  } finally {
    await session.endSession();
  }
}

async function cancelBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
  try {
    const booking = await Booking.findOne({ _id: req.params.id, bookedBy: req.user.id });
    if (!booking) return res.status(404).json({ message: "Booking request not found." });
    if (!["Pending", "Approved"].includes(booking.status)) {
      return res.status(409).json({ message: "Only pending or approved requests can be cancelled." });
    }
    booking.status = "Cancelled";
    await booking.save();
    const room = await Room.findById(booking.room).select("name building").lean();
    await recordActivity({ actor: req.user.id, action: "Booking cancelled", entityType: "booking", entityId: booking._id, summary: `${room?.name || "Room"} booking for ${booking.date} was cancelled.` });
    try {
      const admins = await User.find({ role: "admin" }).select("_id").lean();
      await notifyBooking(admins.map((admin) => admin._id), "Room booking cancelled", `${room?.name || "Room"} booking for ${booking.date} was cancelled.`);
    } catch (error) { console.error("Booking notification recipients lookup failed:", error.name || "Error"); }
    return res.json({ message: "Booking request cancelled.", booking: await populatedBooking(booking._id) });
  } catch (error) {
    return handleError(res, error, "Failed to cancel booking request.");
  }
}

module.exports = { createBooking, getBookings, decideBooking, cancelBooking };
