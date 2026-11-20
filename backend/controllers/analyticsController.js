const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Complaint = require("../models/Complaint");
const CampusClass = require("../models/CampusClass");

function utcDateString(date) { return date.toISOString().slice(0, 10); }

function createDateWindow(range) {
  if (range === "all") return null;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (range === "7d" ? 6 : 29));
  const nextDay = new Date(end);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { startDate: utcDateString(start), endDate: utcDateString(end), startAt: start, endAt: nextDay };
}

function zeroBookingCounts() { return { total: 0, Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 }; }
const COMPLAINT_STATUSES = ["Open", "In progress", "Pending Verification", "Resolved", "Closed"];
const BOOKING_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

function conditionalCount(field, value) { return { $sum: { $cond: [{ $eq: [`$${field}`, value] }, 1, 0] } }; }

function makePeriods(window, observedPeriods) {
  if (!window) return observedPeriods;
  const periods = [];
  const current = new Date(`${window.startDate}T00:00:00.000Z`);
  const end = new Date(`${window.endDate}T00:00:00.000Z`);
  while (current <= end) { periods.push(utcDateString(current)); current.setUTCDate(current.getUTCDate() + 1); }
  return periods;
}

function aggregateAttendancePatterns(dailyRows) {
  const weekly = new Map();
  const monthly = new Map();
  for (const row of dailyRows) {
    const date = new Date(`${row.period}T00:00:00.000Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    const week = utcDateString(date);
    const month = row.period.slice(0, 7);
    for (const [map, key] of [[weekly, week], [monthly, month]]) {
      const current = map.get(key) || { period: key, total: 0, present: 0, absent: 0, late: 0 };
      current.total += row.total;
      current.present += row.present;
      current.absent += row.absent;
      current.late += row.late;
      map.set(key, current);
    }
  }
  return { weekly: [...weekly.values()], monthly: [...monthly.values()] };
}

function aggregateBookingPatterns(dailyRows) {
  const weekly = new Map();
  const monthly = new Map();
  for (const row of dailyRows) {
    const date = new Date(`${row.period}T00:00:00.000Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    for (const [map, key] of [[weekly, utcDateString(date)], [monthly, row.period.slice(0, 7)]]) {
      const current = map.get(key) || { period: key, ...zeroBookingCounts() };
      current.total += row.total;
      for (const status of BOOKING_STATUSES) current[status] += row[status] || 0;
      map.set(key, current);
    }
  }
  return { weekly: [...weekly.values()], monthly: [...monthly.values()] };
}

async function getAnalytics(req, res) {
  const range = req.query.range || "30d";
  if (!["7d", "30d", "all"].includes(range)) return res.status(400).json({ message: "Range must be 7d, 30d, or all." });

  const window = createDateWindow(range);
  const bookingMatch = window ? { date: { $gte: window.startDate, $lte: window.endDate } } : {};
  const attendanceMatch = window ? { date: { $gte: window.startDate, $lte: window.endDate } } : {};
  const complaintMatch = window ? { createdAt: { $gte: window.startAt, $lt: window.endAt } } : {};
  const periodFormat = "$date";
  const complaintPeriodFormat = range === "all" ? "%Y-%m" : "%Y-%m-%d";

  try {
    const [studentCount, facultyCount, technicianCount, roomCount, buildingCount, classCount,
      departmentRows, yearSemesterRows, enrollmentTrendRows, bookingStatusRows, bookingTrendRows,
      buildingBookingRows, bookingHours, bookingHoursByHour, roomUsage, roomStates, equipmentFaults, complaintRows,
      complaintTrendRows, complaintBuildingRows, complaintPriorityRows, resolutionStats, technicianWorkload,
      attendanceDailyRows, complaintTotalAllTime] = await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "faculty" }),
      User.countDocuments({ role: "technician" }),
      Room.countDocuments(),
      Room.distinct("building").then((rows) => rows.length),
      CampusClass.countDocuments(),
      User.aggregate([
        { $match: { role: "student" } },
        { $group: { _id: "$department", students: { $sum: 1 } } },
        { $sort: { students: -1, _id: 1 } },
      ]),
      User.aggregate([
        { $match: { role: "student" } },
        { $group: { _id: { year: "$yearOfStudy", semester: "$semester" }, students: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.semester": 1 } },
      ]),
      User.aggregate([
        { $match: { role: "student", createdAt: { $type: "date" } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, students: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $group: { _id: { $ifNull: ["$status", "Pending"] }, count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $group: { _id: { period: periodFormat, status: { $ifNull: ["$status", "Pending"] } }, count: { $sum: 1 } } },
        { $sort: { "_id.period": 1 } },
      ]),
      Booking.aggregate([
        { $match: { ...bookingMatch, status: "Approved" } },
        { $lookup: { from: Room.collection.name, localField: "room", foreignField: "_id", as: "room" } },
        { $unwind: "$room" },
        { $group: { _id: "$room.building", bookings: { $sum: 1 } } },
        { $sort: { bookings: -1, _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $addFields: {
          startHour: { $convert: { input: { $substrBytes: ["$startTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          endHour: { $convert: { input: { $substrBytes: ["$endTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          bookingDate: { $dateFromString: { dateString: "$date", onError: null, onNull: null } },
        } },
        { $group: { _id: { hour: "$startHour", day: { $dayOfWeek: "$bookingDate" } }, bookings: { $sum: 1 }, endHour: { $avg: "$endHour" } } },
        { $sort: { bookings: -1 } },
      ]),
      Booking.aggregate([
        { $match: bookingMatch },
        { $addFields: { startHour: { $convert: { input: { $substrBytes: ["$startTime", 0, 2] }, to: "int", onError: -1, onNull: -1 } } } },
        { $match: { startHour: { $gte: 0, $lte: 23 } } },
        { $group: { _id: "$startHour", bookings: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: { ...bookingMatch, status: "Approved" } },
        { $addFields: {
          startHour: { $convert: { input: { $substrBytes: ["$startTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          startMinute: { $convert: { input: { $substrBytes: ["$startTime", 3, 2] }, to: "int", onError: 0, onNull: 0 } },
          endHour: { $convert: { input: { $substrBytes: ["$endTime", 0, 2] }, to: "int", onError: 0, onNull: 0 } },
          endMinute: { $convert: { input: { $substrBytes: ["$endTime", 3, 2] }, to: "int", onError: 0, onNull: 0 } },
        } },
        { $addFields: { durationMinutes: { $max: [0, { $subtract: [
          { $add: [{ $multiply: ["$endHour", 60] }, "$endMinute"] },
          { $add: [{ $multiply: ["$startHour", 60] }, "$startMinute"] },
        ] }] } } },
        { $group: { _id: "$room", approvedBookings: { $sum: 1 }, bookedMinutes: { $sum: "$durationMinutes" } } },
        { $lookup: { from: Room.collection.name, localField: "_id", foreignField: "_id", as: "room" } },
        { $unwind: "$room" },
        { $project: { _id: 0, roomId: "$room._id", name: "$room.name", building: "$room.building", type: "$room.type", capacity: "$room.capacity", approvedBookings: 1, bookedHours: { $round: [{ $divide: ["$bookedMinutes", 60] }, 1] } } },
        { $sort: { approvedBookings: -1, bookedHours: -1, building: 1, name: 1 } },
      ]),
      Room.aggregate([
        {
          $addFields: {
            equipmentFault: {
              $gt: [
                { $size: { $filter: { input: { $ifNull: ["$equipment", []] }, as: "item", cond: { $ne: ["$$item.status", "Working"] } } } },
                0,
              ],
            },
          },
        },
        { $group: {
          _id: "$building", rooms: { $sum: 1 },
          operationalRooms: { $sum: { $cond: [{ $and: [{ $eq: ["$available", true] }, { $ne: ["$maintenanceHold", true] }, { $eq: ["$equipmentFault", false] }] }, 1, 0] } },
          maintenanceRooms: { $sum: { $cond: [{ $or: [{ $eq: ["$available", false] }, { $eq: ["$maintenanceHold", true] }, { $eq: ["$equipmentFault", true] }] }, 1, 0] } },
        } },
        { $sort: { _id: 1 } },
      ]),
      Room.aggregate([
        { $unwind: "$equipment" },
        { $match: { "equipment.status": { $ne: "Working" } } },
        { $group: { _id: "$equipment.type", faults: { $sum: 1 } } },
        { $sort: { faults: -1, _id: 1 } },
      ]),
      Complaint.aggregate([
        { $match: complaintMatch },
        { $group: { _id: { $ifNull: ["$status", "Open"] }, count: { $sum: 1 } } },
      ]),
      Complaint.aggregate([
        { $match: complaintMatch },
        { $group: { _id: { $dateToString: { format: complaintPeriodFormat, date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Complaint.aggregate([
        { $match: complaintMatch },
        { $lookup: { from: Room.collection.name, localField: "room", foreignField: "_id", as: "room" } },
        { $unwind: { path: "$room", preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ["$room.building", "Campus"] }, complaints: { $sum: 1 } } },
        { $sort: { complaints: -1, _id: 1 } },
      ]),
      Complaint.aggregate([
        { $match: complaintMatch },
        { $group: { _id: "$priority", complaints: { $sum: 1 } } },
        { $sort: { complaints: -1, _id: 1 } },
      ]),
      Complaint.aggregate([
        { $match: { ...complaintMatch, status: { $in: ["Resolved", "Closed"] }, room: { $ne: null } } },
        { $addFields: { finishedAt: { $ifNull: ["$verifiedAt", { $ifNull: [{ $arrayElemAt: ["$history.createdAt", -1] }, "$updatedAt"] }] } } },
        { $project: { hours: { $divide: [{ $subtract: ["$finishedAt", "$createdAt"] }, 3600000] } } },
        { $group: { _id: null, avgResolutionHours: { $avg: "$hours" }, completedRepairs: { $sum: 1 } } },
      ]),
      Complaint.aggregate([
        { $match: { assignedTo: { $ne: null }, room: { $ne: null } } },
        { $group: {
          _id: "$assignedTo", assigned: { $sum: 1 },
          active: { $sum: { $cond: [{ $in: ["$status", ["Open", "In progress"]] }, 1, 0] } },
          pendingVerification: { $sum: { $cond: [{ $eq: ["$status", "Pending Verification"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "Closed"] }, 1, 0] } },
        } },
        { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "technician" } },
        { $unwind: "$technician" },
        { $project: { _id: 0, technicianId: "$technician._id", name: "$technician.name", department: "$technician.department", assigned: 1, active: 1, pendingVerification: 1, completed: 1 } },
        { $sort: { assigned: -1, name: 1 } },
      ]),
      Attendance.aggregate([
        { $match: attendanceMatch },
        { $group: {
          _id: "$date", total: { $sum: 1 },
          present: conditionalCount("status", "present"), absent: conditionalCount("status", "absent"), late: conditionalCount("status", "late"),
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, period: "$_id", total: 1, present: 1, absent: 1, late: 1 } },
      ]),
      Complaint.countDocuments(),
    ]);

    const bookings = zeroBookingCounts();
    for (const row of bookingStatusRows) {
      bookings.total += row.count;
      if (Object.hasOwn(bookings, row._id)) bookings[row._id] = row.count;
    }
    const bookingTrendMap = new Map();
    for (const row of bookingTrendRows) {
      const period = row._id.period;
      if (!bookingTrendMap.has(period)) bookingTrendMap.set(period, { period, ...zeroBookingCounts() });
      const bucket = bookingTrendMap.get(period);
      bucket.total += row.count;
      if (Object.hasOwn(bucket, row._id.status)) bucket[row._id.status] = row.count;
    }
    const observedBookingPeriods = [...bookingTrendMap.keys()].sort();
    const bookingPeriods = makePeriods(window, observedBookingPeriods);
    const dailyBookingTrend = bookingPeriods.map((period) => bookingTrendMap.get(period) || { period, ...zeroBookingCounts() });
    const bookingPatterns = aggregateBookingPatterns(dailyBookingTrend);
    const bookingTrend = range === "all" ? bookingPatterns.monthly : dailyBookingTrend;

    const complaints = { total: 0, ...Object.fromEntries(COMPLAINT_STATUSES.map((status) => [status, 0])) };
    for (const row of complaintRows) {
      complaints.total += row.count;
      if (COMPLAINT_STATUSES.includes(row._id)) complaints[row._id] = row.count;
    }
    const attendance = { total: 0, present: 0, absent: 0, late: 0, attendanceRate: 0 };
    for (const row of attendanceDailyRows) {
      attendance.total += row.total;
      attendance.present += row.present;
      attendance.absent += row.absent;
      attendance.late += row.late;
    }
    attendance.attendanceRate = attendance.total ? Math.round(((attendance.present + attendance.late) / attendance.total) * 100) : 0;
    const dailyAttendanceTrend = window
      ? makePeriods(window, attendanceDailyRows.map((row) => row.period)).map((period) => attendanceDailyRows.find((row) => row.period === period) || { period, total: 0, present: 0, absent: 0, late: 0 })
      : attendanceDailyRows;
    const attendancePatterns = aggregateAttendancePatterns(dailyAttendanceTrend);
    const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const bookingCountByHour = new Map(bookingHoursByHour.map((row) => [row._id, row.bookings]));
    const peakBookingHours = Array.from({ length: 24 }, (_, hour) => ({ hour, bookings: bookingCountByHour.get(hour) || 0 }));
    const peakBookingDays = Object.entries(bookingHours.reduce((days, row) => {
      const day = weekdayNames[row._id.day - 1];
      if (day) days[day] = (days[day] || 0) + row.bookings;
      return days;
    }, {})).map(([day, count]) => ({ day, bookings: count }));
    const averageResolution = resolutionStats[0]?.avgResolutionHours || 0;

    return res.json({
      range, generatedAt: new Date().toISOString(),
      dateWindow: window ? { startDate: window.startDate, endDate: window.endDate } : null,
      totals: { students: studentCount, faculty: facultyCount, technicians: technicianCount, rooms: roomCount, buildings: buildingCount, classes: classCount },
      students: { departmentDistribution: departmentRows.map((row) => ({ department: row._id || "Unassigned", students: row.students })), yearSemesterDistribution: yearSemesterRows.map((row) => ({ year: row._id.year || 0, semester: row._id.semester || 0, students: row.students })), enrollmentTrend: enrollmentTrendRows.map((row) => ({ period: row._id, students: row.students })) },
      bookings, bookingTrend,
      bookingAnalytics: { dailyTrend: dailyBookingTrend, weeklyTrend: bookingPatterns.weekly, monthlyTrend: bookingPatterns.monthly, buildingDistribution: buildingBookingRows.map((row) => ({ building: row._id, bookings: row.bookings })), peakHours: peakBookingHours, peakDays: peakBookingDays },
      roomUsage,
      rooms: { byBuilding: roomStates.map((row) => ({ building: row._id, rooms: row.rooms, operationalRooms: row.operationalRooms, maintenanceRooms: row.maintenanceRooms })), equipmentFaults: equipmentFaults.map((row) => ({ equipment: row._id, faults: row.faults })) },
      complaints: { ...complaints, totalAllTime: complaintTotalAllTime, byBuilding: complaintBuildingRows.map((row) => ({ building: row._id || "Campus", complaints: row.complaints })), byPriority: complaintPriorityRows.map((row) => ({ priority: row._id || "Normal", complaints: row.complaints })), trend: complaintTrendRows.map((row) => ({ period: row._id, complaints: row.count })), averageResolutionHours: Math.round(averageResolution * 10) / 10, completedRepairs: resolutionStats[0]?.completedRepairs || 0, technicianWorkload },
      attendance: { ...attendance, dailyTrend: dailyAttendanceTrend, weeklyTrend: attendancePatterns.weekly, monthlyTrend: attendancePatterns.monthly },
      periodGranularity: range === "all" ? "month" : "day",
    });
  } catch (error) {
    console.error("Analytics request failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load analytics." });
  }
}

module.exports = { getAnalytics };
