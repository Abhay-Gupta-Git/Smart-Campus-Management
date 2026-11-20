const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const User = require("../models/User");
const Room = require("../models/Room");
const CampusClass = require("../models/CampusClass");
const Booking = require("../models/Booking");
const Attendance = require("../models/Attendance");
const Complaint = require("../models/Complaint");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const Notice = require("../models/Notice");
const { demoPersonName, validateDemoNameUniqueness } = require("../utils/demoNames");

const EXPECTED_DB = "campusos_demo_v2";
const ROLE_SPECS = {
  student: { count: 6000, idPattern: /^STU2026\d{4}$/ },
  faculty: { count: 450, idPattern: /^FAC2026\d{3}$/ },
  technician: { count: 36, idPattern: /^TEC2026\d{3}$/ },
};
const MODELS = [User, Room, CampusClass, Booking, Attendance, Complaint, Notification, ActivityLog, Notice];
const REFERENCE_PROJECTIONS = new Map([
  [User, { _id: 1, email: 1, password: 1, role: 1, studentId: 1 }],
  [Room, { _id: 1, equipment: 1, inspectionHistory: 1 }],
  [CampusClass, { _id: 1, faculty: 1, room: 1, enrolledStudents: 1 }],
  [Booking, { _id: 1, room: 1, bookedBy: 1 }],
  [Attendance, { _id: 1, student: 1, campusClass: 1, markedBy: 1 }],
  [Complaint, { _id: 1, room: 1, submittedBy: 1, assignedTo: 1, verifiedBy: 1, history: 1 }],
  [Notification, { _id: 1, recipient: 1, complaint: 1, entityType: 1, entityId: 1 }],
  [ActivityLog, { _id: 1, actor: 1, entityType: 1, entityId: 1 }],
  [Notice, { _id: 1, author: 1 }],
]);

function validateTarget(uri) {
  if (!uri) throw new Error("MONGO_URI is required; it must point to the dedicated campusos_demo_v2 database.");
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("MONGO_URI is not a valid MongoDB URL."); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0];
  const host = parsed.hostname.toLowerCase();
  if (database !== EXPECTED_DB || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing to connect: this upgrade only accepts a loopback MongoDB URI whose database name is exactly ${EXPECTED_DB}.`);
  }
}

async function assertCanonicalSeed() {
  const expectedCounts = new Map([
    [User, 6487], [Room, 120], [CampusClass, 600], [Booking, 600], [Attendance, 96000],
    [Complaint, 300], [Notification, 4], [ActivityLog, 77], [Notice, 5],
  ]);
  const counts = await Promise.all(MODELS.map((Model) => Model.countDocuments()));
  const mismatch = MODELS.find((Model, index) => counts[index] !== expectedCounts.get(Model));
  if (mismatch) {
    throw new Error(`Refusing to upgrade a non-canonical or incomplete seed: ${mismatch.collection.collectionName} has ${counts[MODELS.indexOf(mismatch)]} records; expected ${expectedCounts.get(mismatch)}.`);
  }

  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const rows = await User.find({ role }).select("_id studentId").sort({ studentId: 1 }).lean();
    if (rows.length !== spec.count || rows.some((row) => !spec.idPattern.test(row.studentId || "")) ||
      new Set(rows.map((row) => row.studentId)).size !== spec.count) {
      throw new Error(`Refusing to upgrade: ${role} accounts do not match the expected seeded identity pattern.`);
    }
  }
}

async function referenceStateDigest() {
  const digest = crypto.createHash("sha256");
  for (const Model of MODELS) {
    digest.update(`${Model.collection.collectionName}\n`);
    const cursor = Model.collection.find({}, { projection: REFERENCE_PROJECTIONS.get(Model) }).sort({ _id: 1 });
    for await (const row of cursor) digest.update(`${JSON.stringify(row)}\n`);
  }
  return digest.digest("hex");
}

async function validateReferences() {
  const modelsByType = {
    user: User, account: User, booking: Booking, room: Room, class: CampusClass,
    complaint: Complaint, attendance: Attendance, notice: Notice,
  };
  const ids = new Map();
  for (const Model of Object.values(modelsByType)) {
    const rows = await Model.collection.find({}, { projection: { _id: 1 } }).toArray();
    ids.set(Model.collection.collectionName, new Set(rows.map((row) => row._id.toString())));
  }
  const exists = (type, id) => id == null || ids.get(modelsByType[type].collection.collectionName).has(id.toString());
  const assertReference = (type, id, context) => {
    if (!exists(type, id)) throw new Error(`Dangling ${type} reference found in ${context}.`);
  };

  for await (const row of CampusClass.collection.find({}, { projection: { faculty: 1, room: 1, enrolledStudents: 1 } })) {
    assertReference("user", row.faculty, "class faculty");
    assertReference("room", row.room, "class room");
    for (const student of row.enrolledStudents || []) assertReference("user", student, "class enrollment");
  }
  for await (const row of Booking.collection.find({}, { projection: { room: 1, bookedBy: 1 } })) {
    assertReference("room", row.room, "booking room"); assertReference("user", row.bookedBy, "booking requester");
  }
  for await (const row of Attendance.collection.find({}, { projection: { student: 1, campusClass: 1, markedBy: 1 } })) {
    assertReference("user", row.student, "attendance student"); assertReference("class", row.campusClass, "attendance class"); assertReference("user", row.markedBy, "attendance marker");
  }
  for await (const row of Complaint.collection.find({}, { projection: { room: 1, submittedBy: 1, assignedTo: 1, verifiedBy: 1, history: 1 } })) {
    assertReference("room", row.room, "complaint room"); assertReference("user", row.submittedBy, "complaint submitter");
    assertReference("user", row.assignedTo, "complaint assignee"); assertReference("user", row.verifiedBy, "complaint verifier");
    for (const entry of row.history || []) assertReference("user", entry.actor, "complaint history");
  }
  for await (const row of Room.collection.find({}, { projection: { equipment: 1, inspectionHistory: 1 } })) {
    for (const item of [...(row.equipment || []), ...(row.inspectionHistory || []).flatMap((entry) => entry.equipment || [])]) assertReference("user", item.inspectedBy, "room inspection");
  }
  for await (const row of Notification.collection.find({}, { projection: { recipient: 1, complaint: 1, entityType: 1, entityId: 1 } })) {
    assertReference("user", row.recipient, "notification recipient"); assertReference("complaint", row.complaint, "notification complaint");
    if (row.entityId && modelsByType[row.entityType]) assertReference(row.entityType, row.entityId, "notification entity");
  }
  for await (const row of ActivityLog.collection.find({}, { projection: { actor: 1, entityType: 1, entityId: 1 } })) {
    assertReference("user", row.actor, "activity actor");
    if (modelsByType[row.entityType]) assertReference(row.entityType, row.entityId, "activity entity");
  }
  for await (const row of Notice.collection.find({}, { projection: { author: 1 } })) assertReference("user", row.author, "notice author");
}

async function syncBookingNameSnapshots(nameByUserId) {
  const bookings = await Booking.find({ purpose: /^BK2026\d{4} \|/ }).select("_id purpose bookedBy date").lean();
  if (bookings.length !== 600) throw new Error("Refusing to update booking name snapshots: expected 600 canonical BK2026 bookings.");
  const newBookingDetails = new Map();
  const bookingUpdates = bookings.map((booking) => {
    const name = nameByUserId.get(booking.bookedBy.toString());
    const separator = booking.purpose.lastIndexOf(" - ");
    if (!name || separator < 0) throw new Error("A seeded booking has no recognized requester name suffix; no safe snapshot update is possible.");
    const purpose = `${booking.purpose.slice(0, separator)} - ${name}`;
    newBookingDetails.set(booking._id.toString(), { purpose, date: booking.date });
    return { updateOne: { filter: { _id: booking._id }, update: { $set: { purpose } } } };
  });
  await Booking.collection.bulkWrite(bookingUpdates, { ordered: true });

  const activityRows = await ActivityLog.find({ action: "booking_recorded", entityType: "booking", entityId: { $in: bookings.map((booking) => booking._id) } }).select("_id entityId").lean();
  const activityUpdates = activityRows.map((activity) => {
    const booking = newBookingDetails.get(activity.entityId.toString());
    if (!booking) throw new Error("A seeded booking activity points to an unknown booking.");
    return { updateOne: { filter: { _id: activity._id }, update: { $set: { summary: `${booking.purpose} scheduled for ${booking.date}.` } } } };
  });
  if (activityUpdates.length !== 30) throw new Error("Refusing to update booking activity snapshots: expected 30 canonical booking activity entries.");
  if (activityUpdates.length) await ActivityLog.collection.bulkWrite(activityUpdates, { ordered: true });

  for (const booking of bookings) {
    const name = nameByUserId.get(booking.bookedBy.toString());
    const updated = newBookingDetails.get(booking._id.toString());
    if (!name || !updated?.purpose.endsWith(` - ${name}`)) throw new Error("A booking requester name is inconsistent after the upgrade.");
  }
  return { bookings: bookingUpdates.length, bookingActivities: activityUpdates.length, usersChecked: nameByUserId.size };
}

async function upgrade() {
  if (process.env.NODE_ENV === "production") throw new Error("Name upgrades are disabled in production.");
  if (!process.argv.includes("--apply")) {
    throw new Error(`No database changes made. Review the target and rerun with --apply only for ${EXPECTED_DB}.`);
  }
  validateTarget(process.env.MONGO_URI);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== EXPECTED_DB) throw new Error(`Connected database was not ${EXPECTED_DB}; no changes made.`);

  const uniqueNames = validateDemoNameUniqueness();
  await assertCanonicalSeed();
  const referencesBefore = await referenceStateDigest();
  await validateReferences();
  let updated = 0;
  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const rows = await User.find({ role }).select("_id studentId").sort({ studentId: 1 }).lean();
    const operations = rows.map((row, index) => ({
      updateOne: { filter: { _id: row._id, role, studentId: row.studentId }, update: { $set: { name: demoPersonName(index, role) } } },
    }));
    const result = await User.collection.bulkWrite(operations, { ordered: true });
    updated += result.matchedCount;
    if (result.matchedCount !== spec.count) throw new Error(`Only ${result.matchedCount} of ${spec.count} ${role} accounts matched; rerunning is safe and idempotent.`);
  }

  const nameByUserId = new Map();
  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const rows = await User.find({ role }).select("_id studentId").sort({ studentId: 1 }).lean();
    if (rows.length !== spec.count) throw new Error(`Expected ${spec.count} ${role} accounts after updating names.`);
    rows.forEach((row, index) => nameByUserId.set(row._id.toString(), demoPersonName(index, role)));
  }
  const nameSnapshots = await syncBookingNameSnapshots(nameByUserId);

  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const rows = await User.find({ role }).select("name studentId").lean();
    if (rows.length !== spec.count || new Set(rows.map((row) => row.name)).size !== spec.count) {
      throw new Error(`Post-upgrade ${role} name uniqueness validation failed.`);
    }
  }
  if (await referenceStateDigest() !== referencesBefore) throw new Error("Relationship, account identity, or password validation failed after the name upgrade.");
  await validateReferences();
  console.log(JSON.stringify({ database: mongoose.connection.name, updated, uniqueNames, nameSnapshots }, null, 2));
}

if (require.main === module) {
  upgrade()
    .catch((error) => { console.error(`Demo name upgrade stopped: ${error.message || error.name}`); process.exitCode = 1; })
    .finally(async () => { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); });
}

module.exports = { assertCanonicalSeed, referenceStateDigest, validateReferences, validateTarget };
