const path = require("path");
const ENV_PATH = path.resolve(__dirname, "../.env");
require("dotenv").config({ path: ENV_PATH });

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
const { demoPersonName, legacyDemoPersonName, validateDemoNameUniqueness } = require("../utils/demoNames");
const { buildRoomSpecs, buildClassSpecs } = require("./seedDemoData");

const EXPECTED_DB = "campusos_demo_v2";
const EXPECTED_REPLICA_SET = "rs0";
const ROLE_SPECS = {
  student: { count: 6000, prefix: "STU2026", digits: 4, email: (i) => `student${String(i + 1).padStart(4, "0")}@campus.edu.in` },
  faculty: { count: 450, prefix: "FAC2026", digits: 3, email: (i) => `faculty${String(i + 1).padStart(3, "0")}@campus.edu.in` },
  technician: { count: 36, prefix: "TEC2026", digits: 3, email: (i) => `facilities${String(i + 1).padStart(3, "0")}@campus.edu.in` },
};
const ROLE_ORDER = ["student", "faculty", "technician"];
const COLLECTION_COUNTS = new Map([
  [User, 6487], [Room, 120], [CampusClass, 600], [Booking, 600], [Attendance, 96000],
  [Complaint, 300], [Notification, 4], [ActivityLog, 77], [Notice, 5],
]);
const BOOKING_PURPOSES = [
  "Department seminar", "Robotics club workshop", "Project review panel", "Placement preparation session",
  "Student society meeting", "Laboratory safety briefing", "Alumni mentoring circle", "Research poster session",
  "Design review", "Entrepreneurship forum", "Peer tutoring clinic", "Guest lecture setup",
];

function validateTarget(uri) {
  if (!uri) throw new Error(`MONGO_URI is required and must target the local ${EXPECTED_DB} database.`);
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("MONGO_URI is not a valid MongoDB URL."); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0];
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (database !== EXPECTED_DB || !["localhost", "127.0.0.1", "::1"].includes(host) ||
    parsed.searchParams.get("replicaSet") !== EXPECTED_REPLICA_SET) {
    throw new Error(`Refusing to connect: URI must target loopback ${EXPECTED_DB} with replicaSet=${EXPECTED_REPLICA_SET}.`);
  }
}

function assertConnected(connection = mongoose.connection) {
  if (connection.readyState !== 1 || !connection.db) {
    throw new Error("MongoDB is not connected; refusing to start migration validation or database operations.");
  }
}

async function withConnectedDatabase(connection, operation) {
  assertConnected(connection);
  return operation();
}

function idString(value) { return value == null ? "" : value.toString(); }
function sameId(left, right) { return idString(left) === idString(right); }
function iso(value) { return new Date(value).toISOString(); }
function dateText(date) { return date.toISOString().slice(0, 10); }
function academicDate(dayOffset) {
  const date = new Date("2026-07-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return dateText(date);
}
function buildTimeSlots() {
  return Array.from({ length: 10 }, (_, slot) => {
    const startMinutes = 8 * 60 + slot * 75;
    const endMinutes = startMinutes + 65;
    const asTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return [asTime(startMinutes), asTime(endMinutes)];
  });
}

function assertInstitutionalAccounts(users) {
  const byRole = Object.fromEntries(ROLE_ORDER.map((role) => [role, []]));
  const admins = [];
  for (const user of users) {
    if (byRole[user.role]) byRole[user.role].push(user);
    else if (user.role === "admin") admins.push(user);
    else throw new Error(`Unexpected user role on institutional account ${user.studentId || "(missing ID)"}.`);
  }
  if (admins.length !== 1 || admins[0].studentId !== "ADM2026001") {
    throw new Error("Expected exactly the canonical admin account ADM2026001.");
  }
  const seenIds = new Set();
  const seenEmails = new Set();
  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const rows = byRole[role].sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
    if (rows.length !== spec.count) throw new Error(`Expected ${spec.count} ${role} accounts; found ${rows.length}.`);
    rows.forEach((user, index) => {
      const expectedId = `${spec.prefix}${String(index + 1).padStart(spec.digits, "0")}`;
      if (user.studentId !== expectedId) throw new Error(`Unexpected ${role} institutional ID; expected the complete canonical sequence ending at ${expectedId}.`);
      if (!user.email || user.email !== user.email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
        throw new Error(`Invalid canonical email for ${role} ${expectedId}.`);
      }
      // The first account per role uses the local credential file's email; all remaining emails are fixed by the seed.
      if (index > 0 && user.email !== spec.email(index)) throw new Error(`Unexpected email identity for ${role} ${expectedId}.`);
      const newName = demoPersonName(index, role);
      const oldName = legacyDemoPersonName(index, role);
      if (user.name !== newName && user.name !== oldName) throw new Error(`Unexpected or altered name on ${role} ${expectedId}.`);
      if (seenIds.has(user.studentId)) throw new Error(`Duplicate institutional ID ${user.studentId}.`);
      seenIds.add(user.studentId);
      if (seenEmails.has(user.email)) throw new Error(`Duplicate institutional email on ${user.studentId}.`);
      seenEmails.add(user.email);
    });
  }
  if (users.length !== 6487) throw new Error(`Expected 6487 total user accounts; found ${users.length}.`);
  for (const admin of admins) {
    if (!admin.email || !admin.password || !admin.name) throw new Error("The canonical admin account is incomplete.");
    if (seenIds.has(admin.studentId) || seenEmails.has(admin.email)) throw new Error("Admin identity collides with an institutional account.");
  }
  return { byRole, admin: admins[0] };
}

function canonicalRoomRows(roomRows) {
  const expected = buildRoomSpecs();
  if (roomRows.length !== expected.length) throw new Error(`Expected ${expected.length} canonical rooms; found ${roomRows.length}.`);
  const byKey = new Map(roomRows.map((room) => [`${room.building}\0${room.name}`, room]));
  if (byKey.size !== expected.length) throw new Error("Duplicate canonical room identity detected.");
  const ordered = expected.map((spec) => {
    const room = byKey.get(`${spec.building}\0${spec.name}`);
    if (!room || room.floor !== spec.floor || room.type !== spec.type || room.capacity !== spec.capacity) {
      throw new Error(`Missing or altered canonical room ${spec.building}/${spec.name}.`);
    }
    return { ...room, maintenanceHold: spec.faulty, available: !spec.faulty, _seedIndex: spec.index };
  });
  return ordered;
}

function canonicalBookingInputs({ usersByRole, rooms, classes }) {
  const classSpecs = buildClassSpecs({ faculty: usersByRole.faculty, students: usersByRole.student, rooms });
  const classRoomIds = new Set(classSpecs.map((row) => idString(row.room)));
  const operationalRooms = rooms.filter((room) => !room.maintenanceHold && room.available);
  const teachingRoomIds = new Set([...classRoomIds]);
  const bookingRooms = operationalRooms.filter((room) => !teachingRoomIds.has(idString(room._id)) && room._seedIndex % 20 >= 5);
  if (!bookingRooms.length) throw new Error("Canonical booking room list is empty.");
  // Ensure stored classes have the canonical IDs and relationships used when the seed generated bookings.
  const actualClasses = new Map(classes.map((row) => [`${row.courseCode}:${row.section}`, row]));
  if (actualClasses.size !== classSpecs.length) throw new Error("Duplicate or missing canonical class identity.");
  for (const spec of classSpecs) {
    const row = actualClasses.get(`${spec.courseCode}:${spec.section}`);
    if (!row || !sameId(row.room, spec.room) || !sameId(row.faculty, spec.faculty) ||
      row.day !== spec.day || row.startTime !== spec.startTime || row.endTime !== spec.endTime ||
      row.maxEnrollment !== spec.maxEnrollment || row.enrolledStudents.length !== spec.enrolledStudents.length ||
      row.enrolledStudents.some((id, index) => !sameId(id, spec.enrolledStudents[index]))) {
      throw new Error(`Missing or altered canonical class ${spec.courseCode}/${spec.section}.`);
    }
  }
  return { classSpecs, bookingRooms };
}

function makeExpectedBooking(index, context) {
  const { usersByRole, bookingRooms } = context;
  const requester = index % 7 === 0
    ? usersByRole.faculty[Math.floor(index / 7) % usersByRole.faculty.length]
    : usersByRole.student[index % usersByRole.student.length];
  const room = bookingRooms[index % bookingRooms.length];
  const slots = buildTimeSlots();
  const slot = slots[(index + Math.floor(index / bookingRooms.length)) % slots.length];
  const marker = `BK2026${String(index + 1).padStart(4, "0")}`;
  return {
    marker,
    room: room._id,
    date: academicDate(100 + Math.floor(index / bookingRooms.length) * 3),
    startTime: slot[0],
    endTime: slot[1],
    status: index % 20 < 14 ? "Approved" : index % 20 < 17 ? "Pending" : index % 20 < 19 ? "Rejected" : "Cancelled",
    requester,
    purposePrefix: `${marker} | ${BOOKING_PURPOSES[index % BOOKING_PURPOSES.length]} - `,
    createdAt: new Date(academicDate(98 + Math.floor(index / bookingRooms.length) * 3) + "T10:00:00.000Z"),
  };
}

function canonicalBookingPlan(bookings, activities, context) {
  if (bookings.length !== 600) throw new Error(`Expected exactly 600 canonical bookings; found ${bookings.length}.`);
  const byMarker = new Map();
  for (const row of bookings) {
    const match = /^BK2026(\d{4}) \| /.exec(row.purpose || "");
    if (!match) throw new Error("A booking has a missing or invalid canonical marker.");
    if (byMarker.has(match[1])) throw new Error(`Duplicate booking marker BK2026${match[1]}.`);
    byMarker.set(match[1], row);
  }
  if (byMarker.size !== 600) throw new Error("Unexpected, missing, or duplicate canonical booking markers.");

  const userById = new Map([...context.usersByRole.student, ...context.usersByRole.faculty].map((user) => [idString(user._id), user]));
  const ordered = [];
  const changes = [];
  for (let index = 0; index < 600; index += 1) {
    const expected = makeExpectedBooking(index, context);
    const row = byMarker.get(String(index + 1).padStart(4, "0"));
    const requester = userById.get(idString(row.bookedBy));
    if (!requester || !sameId(requester._id, expected.requester._id) || !sameId(row.room, expected.room) ||
      row.date !== expected.date || row.startTime !== expected.startTime || row.endTime !== expected.endTime || row.status !== expected.status ||
      row.purpose !== `${expected.purposePrefix}${requester.name}` ||
      iso(row.createdAt) !== iso(expected.createdAt)) {
      throw new Error(`Booking ${expected.marker} is missing or differs from its canonical seeded fields.`);
    }
    const newPurpose = `${expected.purposePrefix}${demoPersonName(expected.requester.role === "faculty"
      ? context.usersByRole.faculty.indexOf(expected.requester)
      : context.usersByRole.student.indexOf(expected.requester), expected.requester.role)}`;
    ordered.push({ row, expected, newPurpose });
    if (row.purpose !== newPurpose) changes.push({ row, oldValue: row.purpose, newValue: newPurpose });
  }

  const expectedActivityByBooking = new Map(ordered.slice(0, 30).map(({ row }) => [idString(row._id), row]));
  if (activities.length !== 30) throw new Error(`Expected exactly 30 canonical booking activity records; found ${activities.length}.`);
  const activityByBooking = new Map();
  for (const activity of activities) {
    const key = idString(activity.entityId);
    if (!expectedActivityByBooking.has(key) || activityByBooking.has(key)) throw new Error("Unexpected, missing, or duplicate canonical booking activity reference.");
    activityByBooking.set(key, activity);
  }
  const activityChanges = [];
  for (const item of ordered.slice(0, 30)) {
    const activity = activityByBooking.get(idString(item.row._id));
    const oldSummary = `${item.row.purpose} scheduled for ${item.row.date}.`;
    const newSummary = `${item.newPurpose} scheduled for ${item.row.date}.`;
    if (!activity || activity.action !== "booking_recorded" || activity.entityType !== "booking" ||
      !sameId(activity.actor, item.row.bookedBy) || activity.summary !== oldSummary) {
      throw new Error(`Booking activity for ${item.expected.marker} is missing or altered.`);
    }
    if (oldSummary !== newSummary) activityChanges.push({ row: activity, oldValue: oldSummary, newValue: newSummary });
  }
  return { bookings: ordered, bookingChanges: changes, activityChanges, userById };
}

async function readAll(Model, projection, session) {
  const cursor = Model.collection.find({}, { projection, ...(session ? { session } : {}) }).sort({ _id: 1 });
  return cursor.toArray();
}

async function validateReferences(session) {
  const modelsByType = { user: User, account: User, booking: Booking, room: Room, class: CampusClass, complaint: Complaint, attendance: Attendance, notice: Notice };
  const ids = new Map();
  for (const Model of Object.values(modelsByType)) {
    const rows = await Model.collection.find({}, { projection: { _id: 1 }, ...(session ? { session } : {}) }).toArray();
    ids.set(Model.collection.collectionName, new Set(rows.map((row) => idString(row._id))));
  }
  const exists = (type, id) => id != null && ids.get(modelsByType[type].collection.collectionName)?.has(idString(id));
  const assertRef = (type, id, where, required = false) => {
    if (id == null && !required) return;
    if (!exists(type, id)) throw new Error(`Missing or dangling ${type} reference in ${where}.`);
  };
  const scan = async (Model, projection, visit) => {
    for await (const row of Model.collection.find({}, { projection, ...(session ? { session } : {}) })) visit(row);
  };
  await scan(CampusClass, { faculty: 1, room: 1, enrolledStudents: 1 }, (r) => {
    assertRef("user", r.faculty, "class faculty", true); assertRef("room", r.room, "class room", true);
    for (const id of r.enrolledStudents || []) assertRef("user", id, "class enrollment", true);
  });
  await scan(Booking, { room: 1, bookedBy: 1 }, (r) => { assertRef("room", r.room, "booking room", true); assertRef("user", r.bookedBy, "booking requester", true); });
  await scan(Attendance, { student: 1, campusClass: 1, markedBy: 1 }, (r) => {
    assertRef("user", r.student, "attendance student", true); assertRef("class", r.campusClass, "attendance class"); assertRef("user", r.markedBy, "attendance marker");
  });
  await scan(Complaint, { room: 1, submittedBy: 1, assignedTo: 1, verifiedBy: 1, history: 1 }, (r) => {
    assertRef("room", r.room, "complaint room"); assertRef("user", r.submittedBy, "complaint submitter", true);
    assertRef("user", r.assignedTo, "complaint assignee"); assertRef("user", r.verifiedBy, "complaint verifier");
    for (const entry of r.history || []) assertRef("user", entry.actor, "complaint history");
  });
  await scan(Room, { equipment: 1, inspectionHistory: 1 }, (r) => {
    const items = [...(r.equipment || []), ...(r.inspectionHistory || []).flatMap((entry) => entry.equipment || [])];
    for (const item of items) assertRef("user", item.inspectedBy, "room inspection");
  });
  await scan(Notification, { recipient: 1, complaint: 1, entityType: 1, entityId: 1 }, (r) => {
    assertRef("user", r.recipient, "notification recipient", true); assertRef("complaint", r.complaint, "notification complaint");
    if (r.entityId) {
      if (!modelsByType[r.entityType]) throw new Error(`Unknown notification entity type ${r.entityType}.`);
      assertRef(r.entityType, r.entityId, "notification entity", true);
    }
  });
  await scan(ActivityLog, { actor: 1, entityType: 1, entityId: 1 }, (r) => {
    assertRef("user", r.actor, "activity actor", true);
    if (!modelsByType[r.entityType]) throw new Error(`Unknown activity entity type ${r.entityType}.`);
    assertRef(r.entityType, r.entityId, "activity entity", true);
  });
  await scan(Notice, { author: 1 }, (r) => assertRef("user", r.author, "notice author"));
  return true;
}

async function validateAndPlan(session) {
  return withConnectedDatabase(mongoose.connection, async () => {
  const counts = {};
  for (const [Model, expected] of COLLECTION_COUNTS) {
    const countQuery = Model.countDocuments({});
    if (session) countQuery.session(session);
    const actual = await countQuery;
    if (actual !== expected) throw new Error(`${Model.collection.collectionName} has ${actual} records; expected exactly ${expected}.`);
    counts[Model.collection.collectionName] = actual;
  }
  const userRows = await readAll(User, { _id: 1, name: 1, email: 1, password: 1, role: 1, studentId: 1, department: 1 }, session);
  const { byRole, admin } = assertInstitutionalAccounts(userRows);
  const roomRows = await readAll(Room, { _id: 1, name: 1, building: 1, floor: 1, type: 1, capacity: 1 }, session);
  const rooms = canonicalRoomRows(roomRows);
  const classRows = await readAll(CampusClass, { _id: 1, courseCode: 1, section: 1, room: 1, faculty: 1, day: 1, startTime: 1, endTime: 1, maxEnrollment: 1, enrolledStudents: 1 }, session);
  const bookingContext = canonicalBookingInputs({ usersByRole: byRole, rooms, classes: classRows });
  const bookingRows = await readAll(Booking, { _id: 1, room: 1, date: 1, startTime: 1, endTime: 1, purpose: 1, status: 1, bookedBy: 1, createdAt: 1 }, session);
  let activityQuery = ActivityLog.find({ action: "booking_recorded", entityType: "booking" }).select("_id actor action entityType entityId summary");
  if (session) activityQuery = activityQuery.session(session);
  const activityRows = await activityQuery.lean();
  const bookingPlan = canonicalBookingPlan(bookingRows, activityRows, { usersByRole: byRole, ...bookingContext });
  const nameChanges = buildNameChanges(byRole);
  const uniqueNames = validateDemoNameUniqueness();
  await validateReferences(session);
  return {
    database: EXPECTED_DB,
    countsByRole: { student: byRole.student.length, faculty: byRole.faculty.length, technician: byRole.technician.length, admin: 1 },
    adminId: admin.studentId,
    nameChanges,
    bookingChanges: bookingPlan.bookingChanges,
    activityChanges: bookingPlan.activityChanges,
    uniqueNames,
  };
  });
}

function safeReport(plan, mode, { writes = 0, alreadyComplete = false } = {}) {
  return {
    database: plan.database,
    mode,
    countsByRole: plan.countsByRole,
    pendingChanges: {
      names: plan.nameChanges.length,
      bookingSnapshots: plan.bookingChanges.length,
      activitySummaries: plan.activityChanges.length,
    },
    sampleNameChanges: plan.nameChanges.slice(0, 10).map(({ role, oldValue, newValue }) => ({ role, old: oldValue, new: newValue })),
    validations: {
      exactRoleCountsAndInstitutionalIDs: "passed",
      canonicalRoomsClassesBookingsAndActivityLinks: "passed",
      allDocumentReferences: "passed",
      protectedIdentityAndReferences: "update allowlist changes names and approved text fields only",
      uniqueGeneratedNames: plan.uniqueNames,
      replicaSetTransactionsRequiredForApply: EXPECTED_REPLICA_SET,
    },
    writes,
    dryRunPerformedZeroWrites: mode === "dry-run" ? writes === 0 : undefined,
    alreadyComplete,
  };
}

function buildNameChanges(byRole) {
  const changes = [];
  for (const role of ROLE_ORDER) {
    byRole[role].forEach((user, index) => {
      const newName = demoPersonName(index, role);
      if (user.name !== newName) changes.push({ user, role, oldValue: user.name, newValue: newName });
    });
  }
  return changes;
}

function runAtomic(session, task) {
  return session.withTransaction(task, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    readPreference: "primary",
  });
}

async function runDryRun(makePlan) {
  const plan = await makePlan();
  return safeReport(plan, "dry-run");
}

async function applyPlan(plan, session) {
  const operations = [
    [User, plan.nameChanges.map(({ user, role, oldValue, newValue }) => ({
      updateOne: { filter: { _id: user._id, role, studentId: user.studentId, email: user.email, name: oldValue }, update: { $set: { name: newValue } } },
    }))],
    [Booking, plan.bookingChanges.map(({ row, oldValue, newValue }) => ({
      updateOne: { filter: { _id: row._id, purpose: oldValue }, update: { $set: { purpose: newValue } } },
    }))],
    [ActivityLog, plan.activityChanges.map(({ row, oldValue, newValue }) => ({
      updateOne: { filter: { _id: row._id, actor: row.actor, entityId: row.entityId, action: row.action, entityType: row.entityType, summary: oldValue }, update: { $set: { summary: newValue } } },
    }))],
  ];
  let writes = 0;
  for (const [Model, ops] of operations) {
    if (!ops.length) continue;
    const result = await Model.collection.bulkWrite(ops, { ordered: true, session });
    if (result.matchedCount !== ops.length) throw new Error(`Concurrent change detected in ${Model.collection.collectionName}; transaction will abort.`);
    writes += result.modifiedCount;
  }
  return writes;
}

async function connectTargetDatabase(client, uri) {
  validateTarget(uri);
  await client.connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  const connection = client.connection;
  if (typeof connection.asPromise === "function") await connection.asPromise();
  assertConnected(connection);
  if (connection.name !== EXPECTED_DB) throw new Error(`Connected database was not ${EXPECTED_DB}.`);
  const hello = await connection.db.admin().command({ hello: 1 });
  if (hello.setName !== EXPECTED_REPLICA_SET || !hello.logicalSessionTimeoutMinutes) {
    throw new Error(`Requires replica set ${EXPECTED_REPLICA_SET} with transaction support; no changes were applied.`);
  }
  return connection;
}

async function runMigration({ mode = "dry-run", uri = process.env.MONGO_URI, mongooseClient = mongoose,
  makePlan = validateAndPlan, executePlan = applyPlan, nodeEnv = process.env.NODE_ENV } = {}) {
  if (nodeEnv === "production") throw new Error("Demo name upgrades are disabled in production.");
  if (!new Set(["dry-run", "apply"]).has(mode)) throw new Error("Choose exactly one supported mode: --dry-run or --apply.");
  let migrationError;
  try {
    await connectTargetDatabase(mongooseClient, uri);
    if (mode === "dry-run") {
      // Await inside the try so the finally block cannot disconnect during validation.
      return await runDryRun(() => makePlan(null));
    }
    const session = await mongooseClient.startSession();
    let report;
    try {
      await runAtomic(session, async () => {
        // All canonical validation and change planning completes before the first write, inside the transaction snapshot.
        const plan = await makePlan(session);
        const writes = await executePlan(plan, session);
        report = safeReport(plan, mode, { writes, alreadyComplete: writes === 0 });
      });
    } finally {
      await session.endSession();
    }
    return report;
  } catch (error) {
    migrationError = error;
    throw error;
  } finally {
    try {
      await mongooseClient.disconnect();
    } catch (disconnectError) {
      if (!migrationError) throw disconnectError;
    }
  }
}

function parseMode(argv) {
  const flags = argv.filter((arg) => arg === "--dry-run" || arg === "--apply");
  const unknown = argv.filter((arg) => !["--dry-run", "--apply"].includes(arg));
  if (unknown.length || flags.length > 1) throw new Error("Use no flag or --dry-run for preview, or --apply to commit the validated plan.");
  return flags[0] === "--apply" ? "apply" : "dry-run";
}

if (require.main === module) {
  let mode;
  try { mode = parseMode(process.argv.slice(2)); } catch (error) {
    console.error(`Demo name upgrade stopped: ${error.message}`);
    process.exitCode = 1;
  }
  if (mode) runMigration({ mode })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(`Demo name upgrade stopped: ${error.message || error.name}`); process.exitCode = 1; });
}

module.exports = {
  ENV_PATH, EXPECTED_DB, ROLE_SPECS, assertInstitutionalAccounts, assertConnected, canonicalBookingPlan,
  connectTargetDatabase, parseMode, buildNameChanges, runAtomic, runDryRun, runMigration,
  safeReport, validateReferences, validateTarget, withConnectedDatabase,
};
