const crypto = require("crypto");
const { demoPersonName } = require("../utils/demoNames");

const DATABASE_NAME = "campusos_demo_v2";
const REPLICA_SET = "rs0";
const ROLE_ORDER = ["student", "faculty", "technician"];
const ROLE_SPECS = {
  student: { count: 6000, prefix: "STU2026", digits: 4 },
  faculty: { count: 450, prefix: "FAC2026", digits: 3 },
  technician: { count: 36, prefix: "TEC2026", digits: 3 },
};
const EXPECTED_COUNTS = {
  users: 6487,
  rooms: 120,
  campusClasses: 600,
  bookings: 600,
  attendances: 96000,
  complaints: 300,
  notifications: 4,
  activityLogs: 77,
  notices: 5,
};
const BOOKING_MARKER = /^BK2026(\d{4}) \| /;
const BOOKING_ACTIVITY_ACTION = "booking_recorded";

function idOf(value) {
  if (value == null) return null;
  return typeof value.toHexString === "function" ? value.toHexString() : value.toString();
}

function normalize(value) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toHexString === "function") return value.toHexString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
}

function canonicalJson(value) { return JSON.stringify(normalize(value)); }
function digest(value) { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function sortById(rows) { return [...rows].sort((a, b) => idOf(a._id).localeCompare(idOf(b._id))); }

function validateCounts(data) {
  const actual = {};
  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    actual[key] = data[key]?.length ?? 0;
    if (actual[key] !== expected) throw new Error(`${key} count is ${actual[key]}, expected exactly ${expected}.`);
  }
  return actual;
}

function validateAccounts(users) {
  if (users.length !== EXPECTED_COUNTS.users) throw new Error("Unexpected total user count.");
  const admins = users.filter((user) => user.role === "admin");
  if (admins.length !== 1 || admins[0].studentId !== "ADM2026001") throw new Error("Expected exactly the existing ADM2026001 admin account.");
  const accounts = [];
  const seenMongoIds = new Set();
  const seenInstitutionalIds = new Set();
  const seenEmails = new Set();
  for (const role of ROLE_ORDER) {
    const spec = ROLE_SPECS[role];
    const rows = users.filter((user) => user.role === role).sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
    if (rows.length !== spec.count) throw new Error(`Expected ${spec.count} ${role} accounts, found ${rows.length}.`);
    rows.forEach((user, index) => {
      const expectedId = `${spec.prefix}${String(index + 1).padStart(spec.digits, "0")}`;
      if (user.studentId !== expectedId) throw new Error(`Unexpected ${role} institutional ID at position ${index + 1}.`);
      if (!user.name || typeof user.name !== "string") throw new Error(`Missing current name for ${role} ${expectedId}.`);
      if (!user.email || !user.password || seenEmails.has(user.email)) throw new Error(`Missing or duplicate protected account identity for ${expectedId}.`);
      const mongoId = idOf(user._id);
      if (!mongoId || seenMongoIds.has(mongoId)) throw new Error(`Missing or duplicate MongoDB account ID for ${expectedId}.`);
      if (seenInstitutionalIds.has(user.studentId)) throw new Error(`Duplicate institutional ID ${user.studentId}.`);
      seenMongoIds.add(mongoId);
      seenInstitutionalIds.add(user.studentId);
      seenEmails.add(user.email);
      accounts.push({ accountId: mongoId, role, studentId: user.studentId, name: user.name });
    });
  }
  if (accounts.length !== 6486) throw new Error("Expected exactly 6486 non-admin accounts.");
  const admin = admins[0];
  if (!idOf(admin._id) || !admin.email || !admin.password) throw new Error("The existing admin identity is incomplete.");
  if (seenEmails.has(admin.email)) throw new Error("The admin email collides with an institutional account.");
  return { accounts, admin: { accountId: idOf(admin._id), role: admin.role, studentId: admin.studentId, name: admin.name } };
}

function referenceRows(data) {
  return {
    rooms: sortById(data.rooms).map((r) => ({ _id: idOf(r._id), equipment: r.equipment || [], inspectionHistory: r.inspectionHistory || [] })),
    campusClasses: sortById(data.campusClasses).map((r) => ({ _id: idOf(r._id), faculty: idOf(r.faculty), room: idOf(r.room), enrolledStudents: (r.enrolledStudents || []).map(idOf) })),
    bookings: sortById(data.bookings).map((r) => ({ _id: idOf(r._id), room: idOf(r.room), bookedBy: idOf(r.bookedBy) })),
    attendances: sortById(data.attendances).map((r) => ({ _id: idOf(r._id), student: idOf(r.student), campusClass: idOf(r.campusClass), markedBy: idOf(r.markedBy) })),
    complaints: sortById(data.complaints).map((r) => ({ _id: idOf(r._id), room: idOf(r.room), submittedBy: idOf(r.submittedBy), assignedTo: idOf(r.assignedTo), verifiedBy: idOf(r.verifiedBy), history: (r.history || []).map((h) => ({ actor: idOf(h.actor) })) })),
    notifications: sortById(data.notifications).map((r) => ({ _id: idOf(r._id), recipient: idOf(r.recipient), complaint: idOf(r.complaint), entityType: r.entityType, entityId: idOf(r.entityId) })),
    activityLogs: sortById(data.activityLogs).map((r) => ({ _id: idOf(r._id), actor: idOf(r.actor), entityType: r.entityType, entityId: idOf(r.entityId) })),
    notices: sortById(data.notices).map((r) => ({ _id: idOf(r._id), author: idOf(r.author) })),
  };
}

function validateReferences(data) {
  const idSets = {
    users: new Set(data.users.map((r) => idOf(r._id))),
    rooms: new Set(data.rooms.map((r) => idOf(r._id))),
    campusClasses: new Set(data.campusClasses.map((r) => idOf(r._id))),
    bookings: new Set(data.bookings.map((r) => idOf(r._id))),
    complaints: new Set(data.complaints.map((r) => idOf(r._id))),
    attendances: new Set(data.attendances.map((r) => idOf(r._id))),
    notices: new Set(data.notices.map((r) => idOf(r._id))),
  };
  let checked = 0;
  const ref = (type, value, context, optional = false) => {
    if (value == null && optional) return;
    if (value == null || !idSets[type]?.has(idOf(value))) throw new Error(`Missing or dangling ${type} reference in ${context}.`);
    checked += 1;
  };
  const entityTypes = { user: "users", account: "users", room: "rooms", booking: "bookings", class: "campusClasses", complaint: "complaints", attendance: "attendances", notice: "notices" };
  for (const row of data.campusClasses) {
    ref("users", row.faculty, "class faculty"); ref("rooms", row.room, "class room");
    for (const id of row.enrolledStudents || []) ref("users", id, "class enrollment");
  }
  for (const row of data.bookings) { ref("rooms", row.room, "booking room"); ref("users", row.bookedBy, "booking requester"); }
  for (const row of data.attendances) {
    ref("users", row.student, "attendance student"); ref("campusClasses", row.campusClass, "attendance class", true); ref("users", row.markedBy, "attendance marker", true);
  }
  for (const row of data.complaints) {
    ref("rooms", row.room, "complaint room", true); ref("users", row.submittedBy, "complaint submitter");
    ref("users", row.assignedTo, "complaint assignee", true); ref("users", row.verifiedBy, "complaint verifier", true);
    for (const item of row.history || []) ref("users", item.actor, "complaint history actor");
  }
  for (const row of data.rooms) {
    const equipment = [...(row.equipment || []), ...(row.inspectionHistory || []).flatMap((i) => i.equipment || [])];
    for (const item of equipment) ref("users", item.inspectedBy, "room inspection", true);
  }
  for (const row of data.notifications) {
    ref("users", row.recipient, "notification recipient"); ref("complaints", row.complaint, "notification complaint", true);
    if (row.entityId != null) {
      const target = entityTypes[row.entityType];
      if (!target) throw new Error(`Unknown notification entity type ${row.entityType}.`);
      ref(target, row.entityId, "notification entity");
    }
  }
  for (const row of data.activityLogs) {
    ref("users", row.actor, "activity actor");
    const target = entityTypes[row.entityType];
    if (!target) throw new Error(`Unknown activity entity type ${row.entityType}.`);
    ref(target, row.entityId, "activity entity");
  }
  for (const row of data.notices) ref("users", row.author, "notice author", true);
  return { result: "passed", referencesChecked: checked };
}

function accountProtectedDigest(users) {
  return digest(sortById(users).map((u) => ({ _id: idOf(u._id), role: u.role, studentId: u.studentId, email: u.email, password: u.password })));
}

function snapshotDigest(snapshot) {
  const { snapshotDigest: _omitted, createdAt: _createdAt, ...payload } = snapshot;
  return digest(payload);
}

function createBaseline(data, createdAt = new Date().toISOString()) {
  const counts = validateCounts(data);
  const { accounts, admin } = validateAccounts(data.users);
  const refs = validateReferences(data);
  const baseline = {
    schemaVersion: 1,
    database: DATABASE_NAME,
    replicaSet: REPLICA_SET,
    createdAt,
    counts,
    roleCounts: { student: 6000, faculty: 450, technician: 36, admin: 1 },
    accounts,
    admin,
    accountProtectedDigest: accountProtectedDigest(data.users),
    referenceDigest: digest(referenceRows(data)),
    referenceValidation: refs,
    bookingSnapshots: [],
    bookingActivitySnapshots: [],
  };
  const accountById = new Map(data.users.map((u) => [idOf(u._id), u]));
  const seenMarkers = new Set();
  for (const booking of data.bookings) {
    const match = BOOKING_MARKER.exec(booking.purpose || "");
    if (!match || seenMarkers.has(match[1])) throw new Error("Booking markers are missing, malformed, or duplicated.");
    seenMarkers.add(match[1]);
    const requester = accountById.get(idOf(booking.bookedBy));
    if (!requester || !baseline.accounts.some((a) => a.accountId === idOf(requester._id))) throw new Error(`Booking ${match[0].trim()} has a non-canonical requester.`);
    if (!booking.purpose.endsWith(` - ${requester.name}`)) throw new Error(`Booking ${match[0].trim()} requester name snapshot does not match the current account name.`);
    baseline.bookingSnapshots.push({
      bookingId: idOf(booking._id), marker: `BK2026${match[1]}`, bookedBy: idOf(booking.bookedBy), date: booking.date, purpose: booking.purpose,
    });
  }
  if (seenMarkers.size !== 600 || Array.from({ length: 600 }, (_, i) => String(i + 1).padStart(4, "0")).some((n) => !seenMarkers.has(n))) {
    throw new Error("Booking markers do not match the exact canonical BK20260001–BK20260600 sequence.");
  }
  baseline.bookingSnapshots.sort((a, b) => a.marker.localeCompare(b.marker));

  const bookingById = new Map(baseline.bookingSnapshots.map((b) => [b.bookingId, b]));
  const bookingActivities = data.activityLogs.filter((a) => a.action === BOOKING_ACTIVITY_ACTION && a.entityType === "booking");
  if (bookingActivities.length !== 30) throw new Error(`Expected exactly 30 booking_recorded activity logs, found ${bookingActivities.length}.`);
  const seenActivityBookings = new Set();
  for (const activity of bookingActivities) {
    const booking = bookingById.get(idOf(activity.entityId));
    if (!booking || seenActivityBookings.has(booking.bookingId) || idOf(activity.actor) !== booking.bookedBy) throw new Error("Booking activity links are missing, duplicated, or have an unexpected actor.");
    const expectedSummary = `${booking.purpose} scheduled for ${booking.date}.`;
    if (activity.summary !== expectedSummary) throw new Error(`Booking activity ${idOf(activity._id)} summary does not match its booking snapshot.`);
    seenActivityBookings.add(booking.bookingId);
    baseline.bookingActivitySnapshots.push({
      activityId: idOf(activity._id), actor: idOf(activity.actor), action: activity.action,
      entityType: activity.entityType, bookingId: booking.bookingId, summary: activity.summary,
    });
  }
  const expectedFirstThirty = new Set(baseline.bookingSnapshots.slice(0, 30).map((b) => b.bookingId));
  if (seenActivityBookings.size !== 30 || [...expectedFirstThirty].some((id) => !seenActivityBookings.has(id))) {
    throw new Error("Booking activity records do not match the exact first 30 canonical bookings.");
  }
  baseline.bookingActivitySnapshots.sort((a, b) => a.bookingId.localeCompare(b.bookingId));
  baseline.snapshotDigest = snapshotDigest(baseline);
  return baseline;
}

function validateBaseline(baseline) {
  if (baseline.schemaVersion !== 1 || baseline.database !== DATABASE_NAME || baseline.replicaSet !== REPLICA_SET ||
    baseline.accounts?.length !== 6486 || baseline.snapshotDigest !== snapshotDigest(baseline)) {
    throw new Error("Baseline snapshot is invalid, incomplete, or has been altered.");
  }
  return true;
}

function createNameMapping(accounts) {
  const roleIndex = new Map(ROLE_ORDER.map((role, index) => [role, index]));
  const ordered = [...accounts].sort((a, b) => roleIndex.get(a.role) - roleIndex.get(b.role) || a.studentId.localeCompare(b.studentId));
  if (ordered.length !== 6486) throw new Error("Name mapping requires exactly 6486 non-admin account snapshots.");
  const oldNames = new Set(ordered.map((a) => a.name));
  const generated = new Set();
  let candidateIndex = 0;
  const mapping = ordered.map((account) => {
    let newName;
    do {
      if (candidateIndex >= 14400) throw new Error("Unique generated name space was exhausted.");
      newName = demoPersonName(candidateIndex++, "student");
    } while (oldNames.has(newName) || generated.has(newName));
    generated.add(newName);
    return { ...account, oldName: account.name, newName, bookingReferences: [], activityReferences: [] };
  });
  if (new Set(mapping.map((m) => m.newName)).size !== mapping.length) throw new Error("Generated full names are not globally unique.");
  return mapping;
}

function makePlan(data, baseline) {
  validateBaseline(baseline);
  const counts = validateCounts(data);
  const refs = validateReferences(data);
  const baselineUsers = baseline.accounts;
  const currentUsers = new Map(data.users.map((u) => [idOf(u._id), u]));
  const { accounts: validatedAccounts, admin } = validateAccounts(data.users);
  if (accountProtectedDigest(data.users) !== baseline.accountProtectedDigest) throw new Error("Account identity (email/password/role/IDs) changed since baseline creation.");
  if (digest(referenceRows(data)) !== baseline.referenceDigest) throw new Error("Document references changed since baseline creation.");
  if (admin.accountId !== baseline.admin.accountId || admin.role !== baseline.admin.role || admin.studentId !== baseline.admin.studentId || admin.name !== baseline.admin.name) {
    throw new Error("The existing admin account changed since baseline creation.");
  }
  if (digest(validatedAccounts) !== digest(baselineUsers)) throw new Error("Account IDs, roles, institutional IDs, or current names differ from the baseline.");

  const mapping = createNameMapping(baselineUsers);
  const mappingById = new Map(mapping.map((m) => [m.accountId, m]));
  const accountStates = [];
  for (const item of mapping) {
    const current = currentUsers.get(item.accountId);
    if (!current) throw new Error(`Baseline account ${item.studentId} is missing.`);
    if (current.name === item.oldName) accountStates.push("baseline");
    else if (current.name === item.newName) accountStates.push("target");
    else throw new Error(`Account ${item.studentId} has a name outside the baseline and generated target states.`);
  }

  const liveBookings = new Map(data.bookings.map((b) => [idOf(b._id), b]));
  const bookingUpdates = [];
  const bookingByMarker = new Map();
  const bookingStates = [];
  for (const snapshot of baseline.bookingSnapshots) {
    const booking = liveBookings.get(snapshot.bookingId);
    if (!booking || idOf(booking.bookedBy) !== snapshot.bookedBy || booking.date !== snapshot.date) throw new Error(`Booking ${snapshot.marker} identity changed since baseline creation.`);
    const mappingItem = mappingById.get(snapshot.bookedBy);
    if (!mappingItem) throw new Error(`Booking ${snapshot.marker} requester is not in the non-admin baseline.`);
    const separator = snapshot.purpose.lastIndexOf(" - ");
    if (separator < 0 || snapshot.purpose.slice(separator + 3) !== mappingItem.oldName) throw new Error(`Baseline booking ${snapshot.marker} does not end with its requester's snapshot name.`);
    const newPurpose = `${snapshot.purpose.slice(0, separator + 3)}${mappingItem.newName}`;
    if (booking.purpose === snapshot.purpose) bookingStates.push("baseline");
    else if (booking.purpose === newPurpose) bookingStates.push("target");
    else throw new Error(`Booking ${snapshot.marker} text differs from both baseline and planned target.`);
    bookingByMarker.set(snapshot.marker, booking);
    bookingUpdates.push({ bookingId: snapshot.bookingId, marker: snapshot.marker, bookedBy: snapshot.bookedBy, oldPurpose: snapshot.purpose, newPurpose });
    mappingItem.bookingReferences.push({ bookingId: snapshot.bookingId, marker: snapshot.marker });
  }

  const activityUpdates = [];
  const liveActivities = new Map(data.activityLogs.map((a) => [idOf(a._id), a]));
  const activityStates = [];
  for (const snapshot of baseline.bookingActivitySnapshots) {
    const activity = liveActivities.get(snapshot.activityId);
    const booking = bookingUpdates.find((b) => b.bookingId === snapshot.bookingId);
    if (!activity || !booking || idOf(activity.actor) !== snapshot.actor || idOf(activity.entityId) !== snapshot.bookingId ||
      activity.action !== snapshot.action || activity.entityType !== snapshot.entityType) {
      throw new Error(`Booking activity ${snapshot.activityId} identity changed since baseline creation.`);
    }
    const newSummary = `${booking.newPurpose} scheduled for ${bookingUpdates.length ? bookingByMarker.get(booking.marker).date : ""}.`;
    if (activity.summary === snapshot.summary) activityStates.push("baseline");
    else if (activity.summary === newSummary) activityStates.push("target");
    else throw new Error(`Booking activity ${snapshot.activityId} summary differs from baseline and target.`);
    activityUpdates.push({ activityId: snapshot.activityId, bookingId: snapshot.bookingId, actor: snapshot.actor, oldSummary: snapshot.summary, newSummary });
    const requesterMapping = mappingById.get(booking.bookedBy);
    requesterMapping.activityReferences.push({ activityId: snapshot.activityId, marker: booking.marker });
  }
  const phases = [...new Set([...accountStates, ...bookingStates, ...activityStates])];
  if (phases.length !== 1) throw new Error("Baseline is in a mixed or partial migration state; refusing to prepare or apply changes.");
  const state = phases[0] || "baseline";
  const pending = state === "baseline";
  const nameUpdates = pending ? mapping.map((m) => ({ accountId: m.accountId, role: m.role, studentId: m.studentId, oldName: m.oldName, newName: m.newName })) : [];
  const pendingBookingUpdates = pending ? bookingUpdates : [];
  const pendingActivityUpdates = pending ? activityUpdates : [];
  const fullPlan = {
    snapshotDigest: baseline.snapshotDigest,
    mapping: mapping.map(({ accountId, role, studentId, oldName, newName }) => ({ accountId, role, studentId, oldName, newName })),
    bookingUpdates,
    activityUpdates,
  };
  const fullPlanDigest = digest(fullPlan);
  return {
    database: DATABASE_NAME,
    replicaSet: REPLICA_SET,
    state,
    counts,
    countsByRole: baseline.roleCounts,
    referenceValidation: refs,
    mapping,
    nameUpdates: pending ? nameUpdates : [],
    bookingUpdates: pendingBookingUpdates,
    activityUpdates: pendingActivityUpdates,
    fullPlan,
    fullPlanDigest,
  };
}

function makePreview(plan, generatedAt = new Date().toISOString()) {
  const byAccount = plan.mapping.map((m) => ({
    accountId: m.accountId,
    role: m.role,
    studentId: m.studentId,
    oldName: m.oldName,
    newName: m.newName,
    bookingReferences: m.bookingReferences,
    activityReferences: m.activityReferences,
  }));
  return {
    generatedAt,
    database: plan.database,
    replicaSet: plan.replicaSet,
    snapshotDigest: plan.fullPlan.snapshotDigest,
    planDigest: plan.fullPlanDigest,
    state: plan.state,
    countsByRole: plan.countsByRole,
    pending: {
      names: plan.nameUpdates.length,
      bookingPurposes: plan.bookingUpdates.length,
      activitySummaries: plan.activityUpdates.length,
    },
    databaseWrites: 0,
    validation: { result: "passed", referencesChecked: plan.referenceValidation.referencesChecked, expectedCounts: plan.counts },
    accountMapping: byAccount,
    bookingPurposeUpdates: plan.bookingUpdates,
    activitySummaryUpdates: plan.activityUpdates,
  };
}

function prepareDryRun(data, existingBaseline = null, generatedAt = new Date().toISOString()) {
  const baseline = existingBaseline ? (validateBaseline(existingBaseline), existingBaseline) : createBaseline(data, generatedAt);
  const plan = makePlan(data, baseline);
  return { baseline, plan, preview: makePreview(plan, generatedAt) };
}

module.exports = {
  DATABASE_NAME, EXPECTED_COUNTS, REPLICA_SET, ROLE_ORDER, ROLE_SPECS,
  accountProtectedDigest, canonicalJson, createBaseline, createNameMapping, digest,
  makePlan, makePreview, referenceRows, snapshotDigest, validateAccounts,
  prepareDryRun, validateBaseline, validateCounts, validateReferences,
};
