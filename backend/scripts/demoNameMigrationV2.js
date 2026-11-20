const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
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
const {
  DATABASE_NAME, REPLICA_SET, makePlan, prepareDryRun, validateBaseline,
} = require("./demoNameMigrationV2Core");

const ENV_PATH = path.resolve(__dirname, "../.env");
dotenv.config({ path: ENV_PATH });

const OUTPUT_DIR = path.resolve(__dirname, "../data");
const BASELINE_PATH = path.join(OUTPUT_DIR, "demo-name-baseline.json");
const PREVIEW_PATH = path.join(OUTPUT_DIR, "demo-name-preview.json");
const COLLECTION_MODELS = {
  users: User,
  rooms: Room,
  campusClasses: CampusClass,
  bookings: Booking,
  attendances: Attendance,
  complaints: Complaint,
  notifications: Notification,
  activityLogs: ActivityLog,
  notices: Notice,
};
const PROJECTIONS = {
  users: { _id: 1, role: 1, studentId: 1, name: 1, email: 1, password: 1 },
  rooms: { _id: 1, equipment: 1, inspectionHistory: 1 },
  campusClasses: { _id: 1, faculty: 1, room: 1, enrolledStudents: 1 },
  bookings: { _id: 1, purpose: 1, bookedBy: 1, date: 1, room: 1 },
  attendances: { _id: 1, student: 1, campusClass: 1, markedBy: 1 },
  complaints: { _id: 1, room: 1, submittedBy: 1, assignedTo: 1, verifiedBy: 1, history: 1 },
  notifications: { _id: 1, recipient: 1, complaint: 1, entityType: 1, entityId: 1 },
  activityLogs: { _id: 1, actor: 1, action: 1, entityType: 1, entityId: 1, summary: 1 },
  notices: { _id: 1, author: 1 },
};

function validateTarget(uri) {
  if (!uri) throw new Error("MONGO_URI is required in backend/.env.");
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("MONGO_URI is not a valid MongoDB URI."); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0];
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (database !== DATABASE_NAME || !["localhost", "127.0.0.1", "::1"].includes(host) || parsed.searchParams.get("replicaSet") !== REPLICA_SET) {
    throw new Error(`Refusing to connect: expected loopback ${DATABASE_NAME} with replicaSet=${REPLICA_SET}.`);
  }
}

async function loadData(session) {
  const data = {};
  for (const [key, Model] of Object.entries(COLLECTION_MODELS)) {
    data[key] = await Model.collection.find({}, { projection: PROJECTIONS[key], ...(session ? { session } : {}) }).sort({ _id: 1 }).toArray();
  }
  return data;
}

function parseJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { throw new Error(`Cannot read ${path.basename(filePath)}: ${error.message}`); }
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(tempPath, filePath);
}

function safeSummary(preview) {
  return {
    database: preview.database,
    replicaSet: preview.replicaSet,
    state: preview.state,
    countsByRole: preview.countsByRole,
    pending: preview.pending,
    databaseWrites: 0,
    validation: preview.validation,
    artifacts: { baseline: BASELINE_PATH, preview: PREVIEW_PATH },
    sample: preview.accountMapping.slice(0, 12).map((row) => ({
      role: row.role,
      studentId: row.studentId,
      oldName: row.oldName,
      newName: row.newName,
      bookingReferences: row.bookingReferences,
      activityReferences: row.activityReferences,
    })),
  };
}

function withStrictTransaction(session, operation) {
  return session.withTransaction(operation, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    readPreference: "primary",
  });
}

async function applyPlan(plan, data, session) {
  const liveUsers = new Map(data.users.map((row) => [row._id.toString(), row]));
  const liveBookings = new Map(data.bookings.map((row) => [row._id.toString(), row]));
  const liveActivities = new Map(data.activityLogs.map((row) => [row._id.toString(), row]));
  const groups = [
    [User, plan.nameUpdates.map((item) => {
      const live = liveUsers.get(item.accountId);
      return {
        updateOne: {
          filter: { _id: live._id, role: item.role, studentId: item.studentId, name: item.oldName, email: live.email, password: live.password },
          update: { $set: { name: item.newName } },
        },
      };
    })],
    [Booking, plan.bookingUpdates.map((item) => {
      const live = liveBookings.get(item.bookingId);
      return {
        updateOne: {
          filter: { _id: live._id, bookedBy: live.bookedBy, date: live.date, purpose: item.oldPurpose },
          update: { $set: { purpose: item.newPurpose } },
        },
      };
    })],
    [ActivityLog, plan.activityUpdates.map((item) => {
      const live = liveActivities.get(item.activityId);
      return {
        updateOne: {
          filter: { _id: live._id, actor: live.actor, entityId: live.entityId, action: live.action, entityType: live.entityType, summary: item.oldSummary },
          update: { $set: { summary: item.newSummary } },
        },
      };
    })],
  ];
  let writes = 0;
  for (const [Model, operations] of groups) {
    if (!operations.length) continue;
    const result = await Model.collection.bulkWrite(operations, { ordered: true, session });
    if (result.matchedCount !== operations.length || result.modifiedCount !== operations.length) {
      throw new Error(`Unexpected write result for ${Model.collection.collectionName}; transaction will roll back.`);
    }
    writes += result.modifiedCount;
  }
  return writes;
}

async function run({ mode = "dry-run", uri = process.env.MONGO_URI } = {}) {
  if (!new Set(["dry-run", "apply"]).has(mode)) throw new Error("Choose --dry-run or --apply.");
  validateTarget(uri);
  let runError;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    await mongoose.connection.asPromise();
    if (mongoose.connection.readyState !== 1 || mongoose.connection.name !== DATABASE_NAME || !mongoose.connection.db) {
      throw new Error(`Connection did not open on ${DATABASE_NAME}.`);
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName !== REPLICA_SET || !hello.logicalSessionTimeoutMinutes) throw new Error(`MongoDB transactions require replica set ${REPLICA_SET}.`);

    if (mode === "dry-run") {
      const data = await loadData();
      const existingBaseline = fs.existsSync(BASELINE_PATH) ? parseJson(BASELINE_PATH) : null;
      const prepared = prepareDryRun(data, existingBaseline);
      if (!existingBaseline) writeJsonAtomically(BASELINE_PATH, prepared.baseline);
      writeJsonAtomically(PREVIEW_PATH, prepared.preview);
      return safeSummary(prepared.preview);
    }

    if (!fs.existsSync(BASELINE_PATH) || !fs.existsSync(PREVIEW_PATH)) throw new Error("Run the new --dry-run first; baseline and preview artifacts are required before apply.");
    const baseline = parseJson(BASELINE_PATH);
    const reviewedPreview = parseJson(PREVIEW_PATH);
    validateBaseline(baseline);
    if (reviewedPreview.snapshotDigest !== baseline.snapshotDigest || reviewedPreview.database !== DATABASE_NAME) throw new Error("Reviewed preview does not match the baseline snapshot.");
    const session = await mongoose.startSession();
    let result;
    try {
      await withStrictTransaction(session, async () => {
        const data = await loadData(session);
        const plan = makePlan(data, baseline);
        if (plan.fullPlanDigest !== reviewedPreview.planDigest) throw new Error("Live migration plan differs from the reviewed preview; transaction aborted.");
        if (plan.state === "target") {
          result = { database: DATABASE_NAME, state: "already-complete", writes: 0 };
          return;
        }
        const writes = await applyPlan(plan, data, session);
        result = { database: DATABASE_NAME, state: "applied", writes };
      });
    } finally {
      await session.endSession();
    }
    return result;
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try { await mongoose.disconnect(); }
    catch (disconnectError) { if (!runError) throw disconnectError; }
  }
}

function parseMode(argv) {
  const flags = argv.filter((arg) => arg === "--dry-run" || arg === "--apply");
  if (argv.some((arg) => !["--dry-run", "--apply"].includes(arg)) || flags.length > 1) throw new Error("Use no flag or --dry-run for preview, or --apply after review.");
  return flags[0] === "--apply" ? "apply" : "dry-run";
}

if (require.main === module) {
  try {
    const mode = parseMode(process.argv.slice(2));
    run({ mode }).then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => { console.error(`Baseline name migration stopped: ${error.message || error.name}`); process.exitCode = 1; });
  } catch (error) {
    console.error(`Baseline name migration stopped: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { BASELINE_PATH, PREVIEW_PATH, applyPlan, loadData, parseMode, run, safeSummary, validateTarget, withStrictTransaction };
