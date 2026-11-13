const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const attendanceKey = { campusClass: 1, student: 1, date: 1 };
const attendanceIndexOptions = {
  unique: true,
  partialFilterExpression: { campusClass: { $type: "objectId" } },
  name: "uniq_attendance_class_student_date",
};
const supportingIndexes = [
  { key: { student: 1, date: -1 }, name: "student_1_date_-1" },
  { key: { campusClass: 1, date: -1 }, name: "campusClass_1_date_-1" },
];
const integrityIndexes = [
  { collection: "campusclasses", key: { room: 1 }, name: "room_1" },
  { collection: "complaints", key: { room: 1, status: 1, createdAt: -1 }, name: "room_1_status_1_createdAt_-1" },
  { collection: "complaints", key: { assignedTo: 1, status: 1, createdAt: -1 }, name: "assignedTo_1_status_1_createdAt_-1" },
  { collection: "complaints", key: { verifiedBy: 1 }, name: "verifiedBy_1" },
  { collection: "complaints", key: { "history.actor": 1 }, name: "history.actor_1" },
];
const notificationDedupeKey = { dedupeKey: 1 };

function sameKey(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function getIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error.code === 26 || error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

async function ensureIndex(collection, { key, name }) {
  const indexes = await getIndexes(collection);
  if (!indexes.some((index) => sameKey(index.key, key))) {
    await collection.createIndex(key, { name });
  }
}

async function migrateAttendanceIndex() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required; no database was changed.");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  const collection = mongoose.connection.collection("attendances");
  const duplicates = await collection.aggregate([
    { $match: { campusClass: { $type: "objectId" } } },
    { $group: {
      _id: { campusClass: "$campusClass", student: "$student", date: "$date" },
      count: { $sum: 1 },
      recordIds: { $push: "$_id" },
    } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { "_id.date": 1 } },
  ]).toArray();

  if (duplicates.length) {
    console.error("Attendance duplicates found. No indexes or records were changed.");
    for (const duplicate of duplicates) {
      console.error(JSON.stringify({ ...duplicate._id, count: duplicate.count, recordIds: duplicate.recordIds }));
    }
    console.error("Review these records and resolve duplicates through an approved data-retention process, then rerun this migration.");
    process.exitCode = 1;
    return;
  }

  const indexes = await getIndexes(collection);

  const existingAttendanceIndex = indexes.find((index) => sameKey(index.key, attendanceKey));
  const hasRequiredPartialFilter = sameKey(existingAttendanceIndex?.partialFilterExpression, attendanceIndexOptions.partialFilterExpression);
  if (existingAttendanceIndex && (existingAttendanceIndex.unique !== true || !hasRequiredPartialFilter || existingAttendanceIndex.name !== attendanceIndexOptions.name)) {
    await collection.dropIndex(existingAttendanceIndex.name);
  }
  await collection.createIndex(attendanceKey, attendanceIndexOptions);
  for (const index of supportingIndexes) {
    await collection.createIndex(index.key, { name: index.name });
  }

  for (const index of integrityIndexes) {
    await ensureIndex(mongoose.connection.collection(index.collection), index);
  }

  const notificationCollection = mongoose.connection.collection("notifications");
  const duplicateNotificationKeys = await notificationCollection.aggregate([
    { $match: { dedupeKey: { $type: "string" } } },
    { $group: { _id: "$dedupeKey", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  if (duplicateNotificationKeys.length) {
    throw new Error("Duplicate notification dedupe keys exist; review them before enabling the unique index. No records were removed.");
  }
  const notificationIndexes = await getIndexes(notificationCollection);
  const existingDedupeIndex = notificationIndexes.find((index) => sameKey(index.key, notificationDedupeKey));
  if (existingDedupeIndex && (existingDedupeIndex.unique !== true || existingDedupeIndex.sparse !== true)) {
    throw new Error("An incompatible notification dedupe index exists; review it before migration.");
  }
  if (!existingDedupeIndex) await notificationCollection.createIndex(notificationDedupeKey, { unique: true, sparse: true, name: "dedupeKey_1" });

  const complaintCollection = mongoose.connection.collection("complaints");
  const complaintIndexes = await getIndexes(complaintCollection);
  const redundantIndexes = [
    { key: { room: 1 }, replacement: { room: 1, status: 1, createdAt: -1 } },
    { key: { assignedTo: 1 }, replacement: { assignedTo: 1, status: 1, createdAt: -1 } },
  ];
  for (const redundant of redundantIndexes) {
    const existing = complaintIndexes.find((index) => sameKey(index.key, redundant.key));
    const replacementExists = complaintIndexes.some((index) => sameKey(index.key, redundant.replacement)) ||
      integrityIndexes.some((index) => index.collection === "complaints" && sameKey(index.key, redundant.replacement));
    if (existing && replacementExists) await complaintCollection.dropIndex(existing.name);
  }
  console.log("Integrity indexes are ready. No attendance or notification records were removed.");
}

migrateAttendanceIndex()
  .catch((error) => {
    console.error("Integrity index migration failed:", error.name || "Error", error.codeName || "");
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
