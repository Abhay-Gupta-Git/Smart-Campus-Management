const path = require("path");
const readline = require("readline");
const readlinePromises = require("readline/promises");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const connectDB = require("../config/db");
const User = require("../models/User");

const adminRoleValues = [/^admin$/i, /^administrator$/i];

async function promptForHiddenValue(prompt) {
  const input = process.stdin;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this setup command in an interactive terminal.");
  }

  process.stdout.write(prompt);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";

    function finish(error) {
      input.removeListener("data", handleInput);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");

      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    }

    function handleInput(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Setup cancelled."));
          return;
        }

        if (character === "\r" || character === "\n") {
          finish();
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        if (character >= " ") {
          value += character;
        }
      }
    }

    input.on("data", handleInput);
  });
}

async function getInitialAdminPassword() {
  const password = await promptForHiddenValue(
    "New admin password (12+ characters): ",
  );
  const confirmation = await promptForHiddenValue("Confirm admin password: ");

  if (password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }

  if (password !== confirmation) {
    throw new Error("The passwords did not match.");
  }

  return password;
}

async function saveInitialAdmin({ configuredEmail, adminName, password }) {
  if (password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }

  const existingAdmin = await User.exists({
    role: { $in: adminRoleValues },
  });

  if (existingAdmin) {
    throw new Error(
      "An administrator already exists. Initial admin setup can only run once.",
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const existingAccount = await User.findOne({ email: configuredEmail });

  if (existingAccount) {
    existingAccount.name = adminName || existingAccount.name;
    existingAccount.role = "admin";
    existingAccount.password = hashedPassword;
    await existingAccount.save();
    return;
  }

  await User.create({
    name: adminName,
    email: configuredEmail,
    password: hashedPassword,
    role: "admin",
  });
}

async function initializeFirstAdmin() {
  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!configuredEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail)) {
    throw new Error("Set a valid ADMIN_EMAIL in backend/.env before setup.");
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("Set JWT_SECRET in backend/.env before setup.");
  }

  await connectDB();

  const existingAdmin = await User.exists({
    role: { $in: adminRoleValues },
  });

  if (existingAdmin) {
    throw new Error(
      "An administrator already exists. Initial admin setup can only run once.",
    );
  }

  const existingAccount = await User.findOne({ email: configuredEmail });
  const terminal = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let adminName = existingAccount?.name || "";

  try {
    console.log("This command initializes the first administrator account.");
    console.log("The account email is read from backend/.env (ADMIN_EMAIL).");
    console.log(
      existingAccount
        ? "The matching account will become the initial admin, and its password will be reset."
        : "A new admin account will be created for the configured email.",
    );

    const confirmation = await terminal.question(
      'Type "INITIALIZE" to continue: ',
    );

    if (confirmation !== "INITIALIZE") {
      console.log("Initial admin setup cancelled. No account was changed.");
      return;
    }

    if (!existingAccount) {
      adminName = (await terminal.question("Administrator name: ")).trim();
    }

    if (!adminName) {
      throw new Error("Administrator name is required.");
    }
  } finally {
    terminal.close();
  }

  const password = await getInitialAdminPassword();
  await saveInitialAdmin({
    configuredEmail,
    adminName,
    password,
  });

  console.log("Initial administrator account created successfully.");
}

if (require.main === module) {
  initializeFirstAdmin()
    .catch((error) => {
      console.error(`Initial admin setup failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = { saveInitialAdmin };
