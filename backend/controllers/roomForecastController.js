const Booking = require("../models/Booking");
const Room = require("../models/Room");

const HISTORY_DAYS = 90;
const MIN_BOOKINGS = 14;
const MIN_ACTIVE_WEEKS = 4;
const TIME_SLOTS = [
  { key: "overnight", label: "Overnight", start: 0, end: 6 },
  { key: "morning", label: "Morning", start: 6, end: 12 },
  { key: "afternoon", label: "Afternoon", start: 12, end: 18 },
  { key: "evening", label: "Evening", start: 18, end: 24 },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function parseTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isoWeek(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekdayOccurrences(startDate, endExclusive) {
  const counts = Array(7).fill(0);
  const date = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endExclusive}T00:00:00.000Z`);
  while (date < end) {
    counts[date.getUTCDay()] += 1;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return counts;
}

function overlaps(start, end, slot) {
  return Math.max(0, Math.min(end, slot.end * 60) - Math.max(start, slot.start * 60));
}

function demandLabel(values, index) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return max === 0 ? "No historical demand" : "Typical";
  const sorted = [...values].sort((a, b) => a - b);
  const lowCutoff = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const highCutoff = sorted[Math.ceil((sorted.length - 1) * 0.75)];
  if (values[index] >= highCutoff && values[index] > 0) return "High demand";
  if (values[index] <= lowCutoff) return "Low demand";
  return "Typical";
}

async function getRoomForecast(req, res) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const historyStart = new Date(today);
  historyStart.setUTCDate(historyStart.getUTCDate() - HISTORY_DAYS);
  const forecastStart = new Date(today);
  forecastStart.setUTCDate(forecastStart.getUTCDate() + 1);
  const forecastEnd = new Date(forecastStart);
  forecastEnd.setUTCDate(forecastEnd.getUTCDate() + 7);
  const startDate = dateString(historyStart);
  const endDate = dateString(today);

  try {
    const [history, rooms] = await Promise.all([
      Booking.aggregate([
        { $match: { status: "Approved", date: { $gte: startDate, $lt: endDate } } },
        { $lookup: { from: Room.collection.name, localField: "room", foreignField: "_id", as: "roomInfo" } },
        { $unwind: "$roomInfo" },
        { $project: {
          _id: 0,
          date: 1,
          startTime: 1,
          endTime: 1,
          roomId: "$roomInfo._id",
          roomName: "$roomInfo.name",
          building: "$roomInfo.building",
          type: "$roomInfo.type",
        } },
      ]),
      Room.find().select("name building type capacity available").lean(),
    ]);

    const validHistory = history.flatMap((booking) => {
      const start = parseTime(booking.startTime);
      const end = parseTime(booking.endTime);
      if (!booking.date || start === null || end === null || end <= start) return [];
      return [{ ...booking, start, end, duration: end - start, weekday: new Date(`${booking.date}T00:00:00.000Z`).getUTCDay() }];
    });

    const weekKeys = new Set(validHistory.map((booking) => isoWeek(booking.date)));
    const activeWeeks = weekKeys.size;
    const sufficientHistory = validHistory.length >= MIN_BOOKINGS && activeWeeks >= MIN_ACTIVE_WEEKS;
    const occurrences = weekdayOccurrences(startDate, endDate);
    const weekdayTotals = WEEKDAYS.map((day, weekday) => ({
      day,
      bookings: 0,
      bookedHours: 0,
      avgBookings: 0,
      avgBookedHours: 0,
      weekday,
    }));
    const slotTotals = TIME_SLOTS.map((slot) => ({ ...slot, bookings: 0, bookedMinutes: 0 }));
    const buildingMap = new Map();
    const typeMap = new Map();
    const roomMap = new Map();
    const weekdaySlotMap = new Map();
    let totalMinutes = 0;

    for (const booking of validHistory) {
      totalMinutes += booking.duration;
      const weekdayTotal = weekdayTotals[booking.weekday];
      weekdayTotal.bookings += 1;
      weekdayTotal.bookedHours += booking.duration / 60;

      const buildingStats = buildingMap.get(booking.building) || { name: booking.building, bookings: 0, bookedMinutes: 0 };
      buildingStats.bookings += 1;
      buildingStats.bookedMinutes += booking.duration;
      buildingMap.set(booking.building, buildingStats);

      const typeStats = typeMap.get(booking.type) || { name: booking.type, bookings: 0, bookedMinutes: 0 };
      typeStats.bookings += 1;
      typeStats.bookedMinutes += booking.duration;
      typeMap.set(booking.type, typeStats);

      const roomStats = roomMap.get(booking.roomId.toString()) || { bookings: 0, bookedMinutes: 0 };
      roomStats.bookings += 1;
      roomStats.bookedMinutes += booking.duration;
      roomMap.set(booking.roomId.toString(), roomStats);

      for (const slot of TIME_SLOTS) {
        const minutes = overlaps(booking.start, booking.end, slot);
        if (!minutes) continue;
        const slotStats = slotTotals.find((item) => item.key === slot.key);
        slotStats.bookings += 1;
        slotStats.bookedMinutes += minutes;
        const key = `${booking.weekday}:${slot.key}`;
        const weekdaySlot = weekdaySlotMap.get(key) || { bookings: 0, bookedMinutes: 0 };
        weekdaySlot.bookings += 1;
        weekdaySlot.bookedMinutes += minutes;
        weekdaySlotMap.set(key, weekdaySlot);
      }
    }

    for (const row of weekdayTotals) {
      const count = occurrences[row.weekday];
      row.avgBookings = count ? round(row.bookings / count, 2) : 0;
      row.avgBookedHours = count ? round(row.bookedHours / count) : 0;
      row.bookedHours = round(row.bookedHours);
      delete row.weekday;
    }

    const totalHours = totalMinutes / 60;
    const roomUsage = rooms.map((room) => {
      const actual = roomMap.get(room._id.toString()) || { bookings: 0, bookedMinutes: 0 };
      const bookedHours = actual.bookedMinutes / 60;
      return {
        roomId: room._id,
        name: room.name,
        building: room.building,
        type: room.type,
        capacity: room.capacity,
        available: room.available,
        approvedBookings: actual.bookings,
        bookedHours: round(bookedHours),
        utilizationPercent: totalHours ? round((bookedHours / totalHours) * 100) : 0,
      };
    }).sort((a, b) => b.bookedHours - a.bookedHours || a.building.localeCompare(b.building) || a.name.localeCompare(b.name));

    const buildingUsage = [...buildingMap.values()].map((row) => ({
      building: row.name,
      approvedBookings: row.bookings,
      bookedHours: round(row.bookedMinutes / 60),
      usageSharePercent: totalHours ? round((row.bookedMinutes / totalMinutes) * 100) : 0,
    })).sort((a, b) => b.bookedHours - a.bookedHours);
    const roomTypeUsage = [...typeMap.values()].map((row) => ({
      roomType: row.name,
      approvedBookings: row.bookings,
      bookedHours: round(row.bookedMinutes / 60),
      usageSharePercent: totalHours ? round((row.bookedMinutes / totalMinutes) * 100) : 0,
    })).sort((a, b) => b.bookedHours - a.bookedHours);
    const slotPatterns = slotTotals.map((slot) => ({
      key: slot.key,
      label: slot.label,
      startTime: `${String(slot.start).padStart(2, "0")}:00`,
      endTime: `${String(slot.end).padStart(2, "0")}:00`,
      approvedBookings: slot.bookings,
      bookedHours: round(slot.bookedMinutes / 60),
      usageSharePercent: totalMinutes ? round((slot.bookedMinutes / totalMinutes) * 100) : 0,
    }));

    const forecasts = [];
    if (sufficientHistory) {
      const date = new Date(forecastStart);
      while (date < forecastEnd) {
        const forecastDate = dateString(date);
        const weekday = date.getUTCDay();
        for (const slot of TIME_SLOTS) {
          const actual = weekdaySlotMap.get(`${weekday}:${slot.key}`) || { bookings: 0, bookedMinutes: 0 };
          const divisor = occurrences[weekday] || 1;
          forecasts.push({
            date: forecastDate,
            day: WEEKDAYS[weekday],
            slot: slot.label,
            startTime: `${String(slot.start).padStart(2, "0")}:00`,
            endTime: `${String(slot.end).padStart(2, "0")}:00`,
            expectedBookings: round(actual.bookings / divisor, 2),
            expectedBookedHours: round(actual.bookedMinutes / divisor / 60, 2),
          });
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
      const values = forecasts.map((row) => row.expectedBookedHours);
      forecasts.forEach((row, index) => { row.demandLevel = demandLabel(values, index); });
    }

    return res.json({
      history: {
        startDate,
        endDate: dateString(new Date(today.getTime() - 86400000)),
        windowDays: HISTORY_DAYS,
        approvedBookings: validHistory.length,
        bookedHours: round(totalHours),
        activeWeeks,
      },
      forecast: {
        available: sufficientHistory,
        method: "weekday-and-time-slot historical mean",
        demandClassification: "High demand is at or above the forecast upper quartile; low demand is at or below the lower quartile. Identical predicted values are labeled typical.",
        minimumApprovedBookings: MIN_BOOKINGS,
        minimumActiveWeeks: MIN_ACTIVE_WEEKS,
        startDate: dateString(forecastStart),
        endDate: dateString(new Date(forecastEnd.getTime() - 86400000)),
        periods: forecasts,
      },
      historicalPatterns: {
        weekdays: weekdayTotals,
        timeSlots: slotPatterns,
        buildings: buildingUsage,
        roomTypes: roomTypeUsage,
      },
      roomUsage,
      utilizationDefinition: "Per-room share of all approved booked hours in this 90-day history; room opening hours and occupancy are not stored.",
      noDataMessage: validHistory.length === 0 ? "No approved bookings were found in the last 90 days." : undefined,
      insufficientHistoryMessage: sufficientHistory ? undefined : `Forecasts require at least ${MIN_BOOKINGS} approved bookings across ${MIN_ACTIVE_WEEKS} different weeks. Found ${validHistory.length} bookings across ${activeWeeks} weeks. Historical summaries are shown without predictions.`,
    });
  } catch (error) {
    console.error("Room forecast request failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to build room usage forecast." });
  }
}

module.exports = { getRoomForecast };
