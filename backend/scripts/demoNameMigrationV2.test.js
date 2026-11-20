const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLE_ORDER, ROLE_SPECS, createBaseline, createNameMapping, digest,
  makePlan, prepareDryRun, validateReferences,
} = require("./demoNameMigrationV2Core");
const { parseMode } = require("./demoNameMigrationV2");
const { withStrictTransaction } = require("./demoNameMigrationV2");

function accountRows() {
  const rows = [];
  for (const role of ROLE_ORDER) {
    const spec = ROLE_SPECS[role];
    for (let i = 0; i < spec.count; i += 1) {
      rows.push({
        _id: `${role}-mongo-${i + 1}`,
        role,
        studentId: `${spec.prefix}${String(i + 1).padStart(spec.digits, "0")}`,
        name: `Existing ${role} ${String(i + 1).padStart(4, "0")}`,
        email: `${role}-${i + 1}@example.invalid`,
        password: `hash-${role}-${i + 1}`,
      });
    }
  }
  rows.push({ _id: "admin-mongo", role: "admin", studentId: "ADM2026001", name: "Existing Admin", email: "admin@example.invalid", password: "admin-hash" });
  return rows;
}

function canonicalFixture() {
  const users = accountRows();
  const students = users.filter((row) => row.role === "student");
  const faculty = users.filter((row) => row.role === "faculty");
  const admin = users.find((row) => row.role === "admin");
  const rooms = Array.from({ length: 120 }, (_, i) => ({ _id: `room-${i + 1}`, equipment: [], inspectionHistory: [] }));
  const campusClasses = Array.from({ length: 600 }, (_, i) => ({
    _id: `class-${i + 1}`, faculty: faculty[i % faculty.length]._id,
    room: rooms[i % rooms.length]._id, enrolledStudents: [students[i % students.length]._id],
  }));
  const bookings = Array.from({ length: 600 }, (_, i) => {
    const requester = students[i % students.length];
    return {
      _id: `booking-${i + 1}`,
      purpose: `BK2026${String(i + 1).padStart(4, "0")} | Demo event ${i + 1} - ${requester.name}`,
      bookedBy: requester._id,
      date: "2026-10-01",
      room: rooms[i % rooms.length]._id,
    };
  });
  const activityLogs = bookings.slice(0, 30).map((booking, i) => ({
    _id: `booking-activity-${i + 1}`, actor: booking.bookedBy, action: "booking_recorded",
    entityType: "booking", entityId: booking._id,
    summary: `${booking.purpose} scheduled for ${booking.date}.`,
  }));
  for (let i = 0; i < 47; i += 1) activityLogs.push({
    _id: `room-activity-${i + 1}`, actor: admin._id, action: "room_inspected",
    entityType: "room", entityId: rooms[i % rooms.length]._id, summary: "Room inspection recorded.",
  });
  return {
    users,
    rooms,
    campusClasses,
    bookings,
    attendances: Array.from({ length: 96000 }, (_, i) => ({ _id: `attendance-${i + 1}`, student: students[i % students.length]._id, campusClass: null, markedBy: null })),
    complaints: Array.from({ length: 300 }, (_, i) => ({ _id: `complaint-${i + 1}`, room: null, submittedBy: students[i % students.length]._id, assignedTo: null, verifiedBy: null, history: [] })),
    notifications: Array.from({ length: 4 }, (_, i) => ({ _id: `notification-${i + 1}`, recipient: students[i]._id, complaint: null, entityType: null, entityId: null })),
    activityLogs,
    notices: Array.from({ length: 5 }, (_, i) => ({ _id: `notice-${i + 1}`, author: admin._id })),
  };
}

test("generated full names are unique across all three roles and deterministic", () => {
  const accounts = accountRows().filter((row) => row.role !== "admin").map(({ _id, role, studentId, name }) => ({ accountId: _id, role, studentId, name }));
  const first = createNameMapping(accounts);
  const second = createNameMapping(accounts);
  assert.deepEqual(first, second);
  assert.equal(first.length, 6486);
  assert.equal(new Set(first.map((row) => row.newName)).size, 6486);
  assert.ok(first.every((row) => row.newName.trim().split(/\s+/).length === 2));
  for (const role of ROLE_ORDER) assert.equal(first.filter((row) => row.role === role).length, ROLE_SPECS[role].count);
});

test("reference validator accepts a valid graph and rejects dangling references", () => {
  const valid = {
    users: [{ _id: "u1" }, { _id: "u2" }], rooms: [{ _id: "r1", equipment: [{ inspectedBy: "u1" }], inspectionHistory: [] }],
    campusClasses: [{ _id: "c1", faculty: "u2", room: "r1", enrolledStudents: ["u1"] }],
    bookings: [{ _id: "b1", room: "r1", bookedBy: "u1" }],
    attendances: [{ _id: "at1", student: "u1", campusClass: "c1", markedBy: "u2" }],
    complaints: [{ _id: "co1", room: "r1", submittedBy: "u1", assignedTo: null, verifiedBy: null, history: [{ actor: "u2" }] }],
    notifications: [{ _id: "n1", recipient: "u1", complaint: "co1", entityType: "booking", entityId: "b1" }],
    activityLogs: [{ _id: "a1", actor: "u2", entityType: "booking", entityId: "b1" }],
    notices: [{ _id: "no1", author: "u2" }],
  };
  assert.equal(validateReferences(valid).result, "passed");
  const broken = structuredClone(valid);
  broken.bookings[0].bookedBy = "missing-user";
  assert.throws(() => validateReferences(broken), /dangling users reference in booking requester/);
});

test("dry-run creates a complete preview without mutating its baseline data", () => {
  const data = canonicalFixture();
  const oldName = data.users[0].name;
  const oldPurpose = data.bookings[0].purpose;
  const oldSummary = data.activityLogs[0].summary;
  const before = digest({ firstAccount: data.users[0], firstBooking: data.bookings[0], firstActivity: data.activityLogs[0] });
  const prepared = prepareDryRun(data, null, "2026-11-21T00:00:00.000Z");
  assert.equal(prepared.baseline.accounts.length, 6486);
  assert.equal(prepared.preview.database, "campusos_demo_v2");
  assert.equal(prepared.preview.pending.names, 6486);
  assert.equal(prepared.preview.pending.bookingPurposes, 600);
  assert.equal(prepared.preview.pending.activitySummaries, 30);
  assert.equal(prepared.preview.databaseWrites, 0);
  assert.equal(prepared.preview.accountMapping[0].oldName, oldName);
  assert.ok(prepared.preview.accountMapping[0].newName);
  assert.ok(prepared.preview.accountMapping.some((row) => row.bookingReferences.length > 0));
  assert.ok(prepared.preview.accountMapping.some((row) => row.activityReferences.length > 0));
  assert.equal(data.users[0].name, oldName);
  assert.equal(data.bookings[0].purpose, oldPurpose);
  assert.equal(data.activityLogs[0].summary, oldSummary);
  assert.equal(digest({ firstAccount: data.users[0], firstBooking: data.bookings[0], firstActivity: data.activityLogs[0] }), before);
  assert.equal(prepared.plan.fullPlanDigest, makePlan(data, prepared.baseline).fullPlanDigest);
});

test("future plans reject protected identity or reference drift", () => {
  const data = canonicalFixture();
  const baseline = createBaseline(data, "2026-11-21T00:00:00.000Z");
  const changedIdentity = structuredClone(data);
  changedIdentity.users[0].email = "changed@example.invalid";
  assert.throws(() => makePlan(changedIdentity, baseline), /Account identity/);
  const changedReference = structuredClone(data);
  changedReference.bookings[0].room = "missing-room";
  assert.throws(() => makePlan(changedReference, baseline), /Missing or dangling rooms reference|Document references changed/);
});

test("future apply wrapper uses an atomic transaction and rolls back mocked writes on failure", async () => {
  const state = { name: "baseline" };
  let transactionOptions;
  const session = {
    async withTransaction(callback, options) {
      const before = state.name;
      transactionOptions = options;
      try { await callback(); } catch (error) { state.name = before; throw error; }
    },
  };
  await assert.rejects(withStrictTransaction(session, async () => {
    state.name = "changed";
    throw new Error("simulated update failure");
  }), /simulated update failure/);
  assert.equal(state.name, "baseline");
  assert.deepEqual(transactionOptions.readConcern, { level: "snapshot" });
  assert.deepEqual(transactionOptions.writeConcern, { w: "majority" });
  assert.equal(transactionOptions.readPreference, "primary");
});

test("CLI defaults to dry-run and requires explicit apply", () => {
  assert.equal(parseMode([]), "dry-run");
  assert.equal(parseMode(["--dry-run"]), "dry-run");
  assert.equal(parseMode(["--apply"]), "apply");
  assert.throws(() => parseMode(["--apply", "--dry-run"]));
});
