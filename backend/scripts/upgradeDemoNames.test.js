const test = require("node:test");
const assert = require("node:assert/strict");
const { demoPersonName, legacyDemoPersonName } = require("../utils/demoNames");
const {
  ROLE_SPECS, assertInstitutionalAccounts, buildNameChanges, canonicalBookingPlan,
  parseMode, runAtomic, runDryRun, validateTarget,
} = require("./upgradeDemoNames");

function accountFixture() {
  const rows = [];
  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    for (let index = 0; index < spec.count; index += 1) {
      rows.push({
        _id: `${role}-${index + 1}`, role,
        studentId: `${spec.prefix}${String(index + 1).padStart(spec.digits, "0")}`,
        email: index === 0 ? `${role}@campus.edu.in` : spec.email(index),
        name: legacyDemoPersonName(index, role),
      });
    }
  }
  rows.push({ _id: "admin-1", role: "admin", studentId: "ADM2026001", email: "admin@campus.edu.in", name: "Admin Example", password: "test-hash" });
  return rows;
}

function bookingFixture(usersByRole) {
  const bookingRooms = Array.from({ length: 60 }, (_, i) => ({ _id: `room-${i}` }));
  const slots = Array.from({ length: 10 }, (_, slot) => {
    const start = 8 * 60 + slot * 75;
    const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    return [fmt(start), fmt(start + 65)];
  });
  const dateAt = (offset) => {
    const date = new Date("2026-07-01T00:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const purposes = ["Department seminar", "Robotics club workshop", "Project review panel", "Placement preparation session", "Student society meeting", "Laboratory safety briefing", "Alumni mentoring circle", "Research poster session", "Design review", "Entrepreneurship forum", "Peer tutoring clinic", "Guest lecture setup"];
  const bookings = [];
  for (let i = 0; i < 600; i += 1) {
    const requester = i % 7 === 0 ? usersByRole.faculty[Math.floor(i / 7) % 450] : usersByRole.student[i % 6000];
    const room = bookingRooms[i % bookingRooms.length];
    const slot = slots[(i + Math.floor(i / bookingRooms.length)) % slots.length];
    const date = dateAt(100 + Math.floor(i / bookingRooms.length) * 3);
    const marker = `BK2026${String(i + 1).padStart(4, "0")}`;
    const purpose = `${marker} | ${purposes[i % purposes.length]} - ${requester.name}`;
    bookings.push({
      _id: `booking-${i + 1}`, room: room._id, date, startTime: slot[0], endTime: slot[1],
      status: i % 20 < 14 ? "Approved" : i % 20 < 17 ? "Pending" : i % 20 < 19 ? "Rejected" : "Cancelled",
      bookedBy: requester._id, purpose, createdAt: new Date(dateAt(98 + Math.floor(i / bookingRooms.length) * 3) + "T10:00:00.000Z"),
    });
  }
  const activities = bookings.slice(0, 30).map((booking) => ({
    _id: `activity-${booking._id}`, actor: booking.bookedBy, action: "booking_recorded", entityType: "booking",
    entityId: booking._id, summary: `${booking.purpose} scheduled for ${booking.date}.`,
  }));
  return { bookingRooms, bookings, activities };
}

test("default and explicit modes choose a read-only preview unless --apply is supplied", () => {
  assert.equal(parseMode([]), "dry-run");
  assert.equal(parseMode(["--dry-run"]), "dry-run");
  assert.equal(parseMode(["--apply"]), "apply");
  assert.throws(() => parseMode(["--apply", "--dry-run"]));
  assert.throws(() => parseMode(["--unknown"]));
  assert.doesNotThrow(() => validateTarget("mongodb://127.0.0.1:27017/campusos_demo_v2?replicaSet=rs0"));
  assert.throws(() => validateTarget("mongodb://127.0.0.1:27017/campusos_demo"));
  assert.throws(() => validateTarget("mongodb://example.invalid/campusos_demo_v2"));
});

test("dry-run plans and reports without invoking a writer", async () => {
  const report = await runDryRun(async () => ({
    database: "campusos_demo_v2", countsByRole: { student: 0, faculty: 0, technician: 0, admin: 1 },
    nameChanges: [], bookingChanges: [], activityChanges: [], uniqueNames: {},
  }));
  assert.equal(report.dryRunPerformedZeroWrites, true);
  assert.equal(report.writes, 0);
});

test("name migration is idempotent and keeps only two-part generated names", () => {
  const roles = assertInstitutionalAccounts(accountFixture()).byRole;
  let changes = buildNameChanges(roles);
  assert.ok(changes.length > 0 && changes.length <= 6486);
  assert.ok(changes.every(({ newValue }) => newValue.trim().split(/\s+/).length === 2));
  for (const { user, newValue } of changes) user.name = newValue;
  changes = buildNameChanges(roles);
  assert.equal(changes.length, 0);
  assert.equal(demoPersonName(0, "student").trim().split(/\s+/).length, 2);
});

test("booking and activity preview becomes empty after applying its planned values", () => {
  const byRole = assertInstitutionalAccounts(accountFixture()).byRole;
  const fixture = bookingFixture(byRole);
  const context = { usersByRole: byRole, bookingRooms: fixture.bookingRooms };
  const first = canonicalBookingPlan(fixture.bookings, fixture.activities, context);
  const changedRequesterIds = new Set(buildNameChanges(byRole).map(({ user }) => user._id));
  const expectedBookingChanges = fixture.bookings.filter((booking) => changedRequesterIds.has(booking.bookedBy)).length;
  const expectedActivityChanges = fixture.bookings.slice(0, 30).filter((booking) => changedRequesterIds.has(booking.bookedBy)).length;
  assert.equal(first.bookingChanges.length, expectedBookingChanges);
  assert.equal(first.activityChanges.length, expectedActivityChanges);
  for (const change of buildNameChanges(byRole)) change.user.name = change.newValue;
  for (const change of first.bookingChanges) change.row.purpose = change.newValue;
  for (const change of first.activityChanges) change.row.summary = change.newValue;
  const second = canonicalBookingPlan(fixture.bookings, fixture.activities, context);
  assert.equal(second.bookingChanges.length, 0);
  assert.equal(second.activityChanges.length, 0);
});

test("canonical booking validation rejects altered booking and activity fields", () => {
  const byRole = assertInstitutionalAccounts(accountFixture()).byRole;
  const fixture = bookingFixture(byRole);
  const context = { usersByRole: byRole, bookingRooms: fixture.bookingRooms };
  fixture.bookings[41].status = "Rejected";
  assert.throws(() => canonicalBookingPlan(fixture.bookings, fixture.activities, context), /differs from its canonical seeded fields/);

  const clean = bookingFixture(byRole);
  clean.activities[0].actor = "wrong-user";
  assert.throws(() => canonicalBookingPlan(clean.bookings, clean.activities, context), /activity.*altered/i);
});

test("transaction wrapper propagates errors so transaction implementation can roll back", async () => {
  const state = { value: "before" };
  const session = {
    async withTransaction(callback, options) {
      const before = state.value;
      assert.deepEqual(options.readConcern, { level: "snapshot" });
      assert.deepEqual(options.writeConcern, { w: "majority" });
      try { await callback(); } catch (error) { state.value = before; throw error; }
    },
  };
  await assert.rejects(runAtomic(session, async () => {
    state.value = "during";
    throw new Error("simulated migration failure");
  }), /simulated migration failure/);
  assert.equal(state.value, "before");
});
