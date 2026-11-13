const Booking = require("../models/Booking");
const CampusClass = require("../models/CampusClass");
const Complaint = require("../models/Complaint");
const Room = require("../models/Room");

const ROOM_TYPES = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date &&
    date >= new Date().toISOString().slice(0, 10);
}

function validTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function overlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && end > otherStart;
}

function conflictsWithRequestedTime(item, startTime, endTime) {
  // Invalid legacy schedule data is treated as unavailable because its actual
  // conflict window cannot be determined safely.
  if (!item || !validTime(item.startTime) || !validTime(item.endTime) || item.startTime >= item.endTime) return true;
  return overlaps(startTime, endTime, item.startTime, item.endTime);
}

async function recommendRooms(req, res) {
  const capacity = Number(req.query.capacity);
  const { type, date, startTime, endTime } = req.query;
  const building = typeof req.query.building === "string" ? req.query.building.trim() : "";

  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
    return res.status(400).json({ message: "Capacity must be a whole number from 1 to 10,000." });
  }
  if (!ROOM_TYPES.includes(type)) {
    return res.status(400).json({ message: "Choose a supported room type." });
  }
  if (!validDate(date)) {
    return res.status(400).json({ message: "Choose a valid date today or later." });
  }
  if (!validTime(startTime) || !validTime(endTime) || startTime >= endTime) {
    return res.status(400).json({ message: "Enter a valid start and end time; the end must be later." });
  }
  if (building.length > 80) {
    return res.status(400).json({ message: "Building preference must be 80 characters or fewer." });
  }

  try {
    const rooms = await Room.find({ available: true, capacity: { $gte: capacity }, type })
      .select("name building floor capacity type facilities equipment maintenanceHold available createdAt updatedAt")
      .lean();
    if (rooms.length === 0) {
      return res.json({ recommendations: [], count: 0, message: "No rooms match the requested capacity and room type." });
    }

    const healthyRooms = rooms.filter((room) => {
      if (room.maintenanceHold === true || (room.equipment != null && !Array.isArray(room.equipment))) return false;
      return !(room.equipment || []).some((item) => !item || item.status !== "Working");
    });
    if (healthyRooms.length === 0) {
      return res.json({ recommendations: [], count: 0, message: "No suitable room is available for this time slot." });
    }

    const roomIds = healthyRooms.map((room) => room._id);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    const [approvedBookings, classSchedules, activeComplaintRoomIds] = await Promise.all([
      Booking.find({ room: { $in: roomIds }, date, status: "Approved" })
        .select("room startTime endTime")
        .lean(),
      CampusClass.find({ room: { $in: roomIds }, day: weekday })
        .select("room startTime endTime")
        .lean(),
      Complaint.distinct("room", { room: { $in: roomIds }, status: { $ne: "Closed" } }),
    ]);

    const unavailableIds = new Set(activeComplaintRoomIds.map((id) => id.toString()));
    for (const booking of approvedBookings) {
      if (conflictsWithRequestedTime(booking, startTime, endTime)) unavailableIds.add(booking.room.toString());
    }
    for (const schedule of classSchedules) {
      if (conflictsWithRequestedTime(schedule, startTime, endTime)) unavailableIds.add(schedule.room.toString());
    }

    const preferredBuilding = building.toLocaleLowerCase();

    const recommendations = healthyRooms
      .filter((room) => !unavailableIds.has(room._id.toString()))
      .map((room) => ({
        ...room,
        capacityFit: room.capacity - capacity,
        preferredBuilding: Boolean(preferredBuilding) && room.building.toLocaleLowerCase() === preferredBuilding,
      }))
      .sort((a, b) =>
        a.capacityFit - b.capacityFit ||
        Number(b.preferredBuilding) - Number(a.preferredBuilding) ||
        a.building.localeCompare(b.building) ||
        a.name.localeCompare(b.name),
      );

    return res.json({
      recommendations,
      count: recommendations.length,
      message: recommendations.length ? undefined : "No suitable room is available for this time slot.",
    });
  } catch (error) {
    console.error("Room recommendation error:", error.name || "Error");
    return res.status(500).json({ message: "Unable to load room recommendations. Please try again." });
  }
}

module.exports = { recommendRooms };
