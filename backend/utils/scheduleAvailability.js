const Booking = require("../models/Booking");
const CampusClass = require("../models/CampusClass");
const Complaint = require("../models/Complaint");

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value) {
  return typeof value === "string" && timePattern.test(value);
}

function weekdayForDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return weekdays[parsed.getUTCDay()];
}

function intervalsOverlap(startTime, endTime, otherStart, otherEnd) {
  return startTime < otherEnd && endTime > otherStart;
}

function equipmentHasFault(room) {
  if (room.equipment != null && !Array.isArray(room.equipment)) return true;
  return (room.equipment || []).some((item) => !item || item.status !== "Working");
}

async function roomMaintenanceBlock(room, session) {
  if (!room.available) return "Room is marked unavailable.";
  if (room.maintenanceHold || equipmentHasFault(room)) return "Room is on maintenance hold because equipment has an unresolved fault.";
  let query = Complaint.exists({ room: room._id, status: { $ne: "Closed" } });
  if (session) query = query.session(session);
  if (await query) return "Room has an unresolved maintenance complaint.";
  return null;
}

async function classConflictForBooking({ roomId, date, startTime, endTime, session }) {
  const weekday = weekdayForDate(date);
  if (!weekday) return { conflict: true, invalidSchedule: true };
  let query = CampusClass.find({ room: roomId, $or: [{ day: weekday }, { day: { $nin: weekdays } }] }).select("day startTime endTime");
  if (session) query = query.session(session);
  const schedules = await query.lean();
  for (const schedule of schedules) {
    if (!weekdays.includes(schedule.day)) return { conflict: true, invalidSchedule: true };
    if (schedule.day !== weekday) continue;
    if (!isValidTime(schedule.startTime) || !isValidTime(schedule.endTime) || schedule.startTime >= schedule.endTime) {
      return { conflict: true, invalidSchedule: true };
    }
    if (intervalsOverlap(startTime, endTime, schedule.startTime, schedule.endTime)) {
      return { conflict: true, invalidSchedule: false };
    }
  }
  return { conflict: false, invalidSchedule: false };
}

async function approvedBookingConflictForClass({ roomId, day, startTime, endTime, session }) {
  const today = new Date().toISOString().slice(0, 10);
  let query = Booking.find({ room: roomId, status: "Approved", date: { $gte: today } })
    .select("date startTime endTime");
  if (session) query = query.session(session);
  const bookings = await query.lean();
  for (const booking of bookings) {
    const bookingDay = weekdayForDate(booking.date);
    if (!bookingDay) return { conflict: true, invalidSchedule: true };
    if (bookingDay !== day) continue;
    if (!isValidTime(booking.startTime) || !isValidTime(booking.endTime) || booking.startTime >= booking.endTime) {
      return { conflict: true, invalidSchedule: true };
    }
    if (intervalsOverlap(startTime, endTime, booking.startTime, booking.endTime)) {
      return { conflict: true, invalidSchedule: false };
    }
  }
  return { conflict: false, invalidSchedule: false };
}

module.exports = { roomMaintenanceBlock, classConflictForBooking, approvedBookingConflictForClass };
