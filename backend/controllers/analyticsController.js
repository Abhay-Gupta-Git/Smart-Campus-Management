const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Complaint = require("../models/Complaint");
const CampusClass = require("../models/CampusClass");

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function createDateWindow(range) {
  if (range === "all") return null;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (range === "7d" ? 6 : 29));
  const nextDay = new Date(end);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    startDate: utcDateString(start),
    endDate: utcDateString(end),
    startAt: start,
    endAt: nextDay,
  };
}

function zeroBookingCounts() {
  return { total: 0, Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 };
}

function makePeriods(window, range, observedPeriods) {
  if (!window) return observedPeriods;
  const periods = [];
  const current = new Date(`${window.startDate}T00:00:00.000Z`);
  const end = new Date(`${window.endDate}T00:00:00.000Z`);
  while (current <= end) {
    periods.push(utcDateString(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return periods;
}

async function getAnalytics(req, res) {
  const range = req.query.range || "30d";
  if (!["7d", "30d", "all"].includes(range)) {
    return res.status(400).json({ message: "Range must be 7d, 30d, or all." });
  }

  const window = createDateWindow(range);
  const bookingMatch = window
    ? { date: { $gte: window.startDate, $lte: window.endDate } }
    : {};
  const complaintMatch = window
    ? { createdAt: { $gte: window.startAt, $lt: window.endAt } }
    : {};
  const attendanceMatch = window
    ? { date: { $gte: window.startDate, $lte: window.endDate } }
    : {};
  const periodFormat = range === "all" ? { $substrBytes: ["$date", 0, 7] } : "$date";

  try {
    const [
      studentCount,
      facultyCount,
      roomCount,
      classCount,
      bookingStatusRows,
      bookingTrendRows,
      roomUsage,
      complaintRows,
      attendanceRows,
    ] = await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "faculty" }),
      Room.countDocuments(),
      CampusClass.countDocuments(),
      Booking.aggregate([
        { $match: bookingMatch },
        { $group: { _id: { $ifNull: ["$status", "Pending"] }, count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $group: {
          _id: { period: periodFormat, status: { $ifNull: ["$status", "Pending"] } },
          count: { $sum: 1 },
        } },
        { $sort: { "_id.period": 1 } },
      ]),
      Booking.aggregate([
        { $match: { ...bookingMatch, status: "Approved" } },
        { $addFields: {
          startHour: { $convert: { input: { $substrBytes: ["$startTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          startMinute: { $convert: { input: { $substrBytes: ["$startTime", 3, 2] }, to: "int", onError: 0, onNull: 0 } },
          endHour: { $convert: { input: { $substrBytes: ["$endTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          endMinute: { $convert: { input: { $substrBytes: ["$endTime", 3, 2] }, to: "int", onError: 0, onNull: 0 } },
        } },
        { $addFields: {
          durationMinutes: { $max: [0, { $subtract: [
            { $add: [{ $multiply: ["$endHour", 60] }, "$endMinute"] },
            { $add: [{ $multiply: ["$startHour", 60] }, "$startMinute"] },
          ] }] },
        } },
        { $group: { _id: "$room", approvedBookings: { $sum: 1 }, bookedMinutes: { $sum: "$durationMinutes" } } },
        { $lookup: { from: Room.collection.name, localField: "_id", foreignField: "_id", as: "room" } },
        { $unwind: "$room" },
        { $project: {
          _id: 0,
          roomId: "$room._id",
          name: "$room.name",
          building: "$room.building",
          type: "$room.type",
          capacity: "$room.capacity",
          approvedBookings: 1,
          bookedHours: { $round: [{ $divide: ["$bookedMinutes", 60] }, 1] },
        } },
        { $sort: { approvedBookings: -1, bookedHours: -1, building: 1, name: 1 } },
      ]),
      Complaint.aggregate([
        { $match: complaintMatch },
        { $group: { _id: { $ifNull: ["$status", "Open"] }, count: { $sum: 1 } } },
      ]),
      Attendance.aggregate([
        { $match: attendanceMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const bookings = zeroBookingCounts();
    for (const row of bookingStatusRows) {
      bookings.total += row.count;
      if (Object.hasOwn(bookings, row._id)) bookings[row._id] = row.count;
    }

    const trendByPeriod = new Map();
    for (const row of bookingTrendRows) {
      const period = row._id.period;
      if (!trendByPeriod.has(period)) trendByPeriod.set(period, { period, ...zeroBookingCounts() });
      const bucket = trendByPeriod.get(period);
      bucket.total += row.count;
      if (Object.hasOwn(bucket, row._id.status)) bucket[row._id.status] = row.count;
    }
    const observedPeriods = [...trendByPeriod.keys()].sort();
    const periods = makePeriods(window, range, observedPeriods);
    const bookingTrend = periods.map((period) => trendByPeriod.get(period) || { period, ...zeroBookingCounts() });

    const complaints = { total: 0, Open: 0, "In progress": 0, Resolved: 0 };
    for (const row of complaintRows) {
      complaints.total += row.count;
      if (Object.hasOwn(complaints, row._id)) complaints[row._id] = row.count;
    }

    const attendance = { total: 0, present: 0, absent: 0, late: 0, attendanceRate: 0 };
    for (const row of attendanceRows) {
      attendance.total += row.count;
      if (Object.hasOwn(attendance, row._id)) attendance[row._id] = row.count;
    }
    attendance.attendanceRate = attendance.total
      ? Math.round(((attendance.present + attendance.late) / attendance.total) * 100)
      : 0;

    return res.json({
      range,
      generatedAt: new Date().toISOString(),
      totals: { students: studentCount, faculty: facultyCount, rooms: roomCount, classes: classCount },
      bookings,
      bookingTrend,
      roomUsage,
      complaints,
      attendance,
      periodGranularity: range === "all" ? "month" : "day",
    });
  } catch (error) {
    console.error("Analytics request failed:", error.message);
    return res.status(500).json({ message: "Failed to load analytics." });
  }
}

module.exports = { getAnalytics };
