const crypto = require("crypto");
const path = require("path");
const readline = require("readline/promises");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const User = require("../models/User");

const targetAdminEmail = "admin_cs24@gla.ac.in";
const minimumPasswordLength = 12;
const maximumPasswordBytes = 72;
const recoverySecretPattern = /^[a-f0-9]{64}$/i;

function isValidRecoverySecret(secret) {
  return typeof secret === "string" && recoverySecretPattern.test(secret);
}

function matchesRecoverySecret(configuredSecret, enteredSecret) {
  if (
    !isValidRecoverySecret(configuredSecret) ||
    !isValidRecoverySecret(enteredSecret)
  ) {
    return false;
  }

  const configuredBytes = Buffer.from(configuredSecret, "hex");
  const enteredBytes = Buffer.from(enteredSecret, "hex");

  return crypto.timingSafeEqual(configuredBytes, enteredBytes);
}

function isLocalMongoUri(mongoUri) {
  if (typeof mongoUri !== "string") {
    return false;
  }

  try {
    const parsedUri = new URL(mongoUri);
    const hostname = parsedUri.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    return (
      parsedUri.protocol === "mongodb:" &&
      !parsedUri.host.includes(",") &&
      localHosts.has(hostname)
    );
  } catch {
    return false;
  }
}

function safeTerminalName(name) {
  return String(name).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function promptForHiddenValue(prompt) {
  const input = process.stdin;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run the recovery command in an interactive terminal.");
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
          finish(new Error("Recovery was cancelled."));
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

async function promptForInitialPassword() {
  const password = await promptForHiddenValue("New admin password: ");
  const confirmation = await promptForHiddenValue("Confirm admin password: ");

  if (
    password.length < minimumPasswordLength ||
    Buffer.byteLength(password, "utf8") > maximumPasswordBytes
  ) {
    throw new Error(
      "Use a password of at least 12 characters and no more than 72 UTF-8 bytes.",
    );
  }

  if (password !== confirmation) {
    throw new Error("The passwords did not match.");
  }

  return password;
}

async function confirmRecovery(account, accountName, terminal) {
  if (account) {
    console.log("Recovery will promote this existing account:");
    console.log(`  Name: ${safeTerminalName(account.name)}`);
    console.log(`  Email: ${targetAdminEmail}`);
    console.log(`  Current role: ${account.role}`);
    console.log("  New role: admin");
    console.log("  Password and all other account fields will be preserved.");
  } else {
    console.log("Recovery will create this administrator account:");
    console.log(`  Name: ${safeTerminalName(accountName)}`);
    console.log(`  Email: ${targetAdminEmail}`);
    console.log("  Role: admin");
  }

  const expectedConfirmation = `RECOVER ${targetAdminEmail}`;
  const confirmation = await terminal.question(
    `Type "${expectedConfirmation}" to continue: `,
  );

  return confirmation === expectedConfirmation;
}

async function recoverConfiguredAdmin() {
  let connectedToDatabase = false;

  try {
    const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    if (configuredEmail !== targetAdminEmail) {
      throw new Error("ADMIN_EMAIL must match the recovery target.");
    }

    const recoverySecret = process.env.ADMIN_RECOVERY_SECRET;

    if (!isValidRecoverySecret(recoverySecret)) {
      throw new Error(
        "Set ADMIN_RECOVERY_SECRET to a 64-character hexadecimal secret before recovery.",
      );
    }

    if (!isLocalMongoUri(process.env.MONGO_URI)) {
      throw new Error(
        "Recovery is restricted to MongoDB running on this computer.",
      );
    }

    const enteredSecret = await promptForHiddenValue(
      "Enter ADMIN_RECOVERY_SECRET (input hidden): ",
    );
    const secretMatches = matchesRecoverySecret(recoverySecret, enteredSecret);

    if (!secretMatches) {
      throw new Error("Recovery secret did not match. No account was changed.");
    }

    await mongoose.connect(process.env.MONGO_URI);
    connectedToDatabase = true;

    const existingAccount = await User.findOne({ email: targetAdminEmail })
      .select("name email role")
      .lean();

    if (existingAccount?.role === "admin") {
      console.log("The target account is already an administrator. No changes made.");
      return;
    }

    if (
      existingAccount &&
      !["student", "faculty"].includes(existingAccount.role)
    ) {
      throw new Error("The target account has an unsupported role. No changes made.");
    }

    let accountName = existingAccount?.name;
    const terminal = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      if (!existingAccount) {
        accountName = (await terminal.question("Administrator name: ")).trim();

        if (!accountName) {
          throw new Error("Administrator name is required. No account was changed.");
        }
      }

      const confirmed = await confirmRecovery(
        existingAccount,
        accountName,
        terminal,
      );

      if (!confirmed) {
        console.log("Recovery cancelled. No account was changed.");
        return;
      }
    } finally {
      terminal.close();
    }

    if (existingAccount) {
      const promotion = await User.updateOne(
        {
          email: targetAdminEmail,
          role: existingAccount.role,
        },
        { $set: { role: "admin" } },
        { runValidators: true, timestamps: false },
      );

      if (promotion.matchedCount !== 1) {
        throw new Error(
          "The target account changed during recovery. No account was overwritten.",
        );
      }

      console.log("The target account was promoted. Its password was preserved.");
      return;
    }

    const password = await promptForInitialPassword();
    const hashedPassword = await bcrypt.hash(password, 12);

    await User.create({
      name: accountName,
      email: targetAdminEmail,
      password: hashedPassword,
      role: "admin",
    });

    console.log("The target administrator account was created successfully.");
  } catch (error) {
    if (error.code === 11000) {
      console.error("The target account already exists. No account was overwritten.");
    } else if (
      error.message === "Recovery was cancelled." ||
      error.message === "Recovery cancelled. No account was changed."
    ) {
      console.log("Recovery cancelled. No account was changed.");
    } else if (
      error.message === "Recovery secret did not match. No account was changed."
    ) {
      console.error(error.message);
    } else if (error.message?.includes("No account was changed.")) {
      console.error(error.message);
    } else {
      console.error(
        "Recovery stopped. Check local setup and MongoDB availability. " +
          "Sensitive details were not logged.",
      );
    }

    process.exitCode = 1;
  } finally {
    delete process.env.ADMIN_RECOVERY_SECRET;
    if (connectedToDatabase) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  recoverConfiguredAdmin();
}

module.exports = {
  isLocalMongoUri,
  isValidRecoverySecret,
  matchesRecoverySecret,
};
