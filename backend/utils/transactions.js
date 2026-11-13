const mongoose = require("mongoose");

async function runTransaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

function isTransactionUnsupported(error) {
  return error?.code === 20 || error?.code === 303 ||
    /transaction numbers are only allowed|transactions are not supported|replica set/i.test(error?.message || "");
}

async function lockRoomReference(Room, roomId, session) {
  const result = await Room.updateOne(
    { _id: roomId },
    { $inc: { referenceVersion: 1 } },
    { session },
  );
  return result.matchedCount === 1;
}

async function lockStudentReferences(User, studentIds, session) {
  const uniqueIds = [...new Set(studentIds.map(String))].sort();
  if (!uniqueIds.length) return true;
  const result = await User.updateMany(
    { _id: { $in: uniqueIds }, role: "student" },
    { $inc: { referenceVersion: 1 } },
    { session },
  );
  return result.modifiedCount === uniqueIds.length;
}

async function lockUserReference(User, userId, role, session) {
  const result = await User.updateOne(
    { _id: userId, role },
    { $inc: { referenceVersion: 1 } },
    { session },
  );
  return result.matchedCount === 1;
}

module.exports = { runTransaction, isTransactionUnsupported, lockRoomReference, lockStudentReferences, lockUserReference };
