const bcrypt = require("bcryptjs");

const MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

function isAcceptablePassword(password) {
  return typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, "utf8") <= MAX_BCRYPT_PASSWORD_BYTES;
}

function hashPassword(password, rounds = 12) {
  return bcrypt.hash(password, rounds);
}

function verifyPassword(password, hash) {
  if (typeof password !== "string" || typeof hash !== "string") return Promise.resolve(false);
  return bcrypt.compare(password, hash);
}

module.exports = { MIN_PASSWORD_LENGTH, MAX_BCRYPT_PASSWORD_BYTES, isAcceptablePassword, hashPassword, verifyPassword };
