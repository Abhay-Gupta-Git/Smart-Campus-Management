require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { validateEnvironment } = require("./config/environment");

const app = express();
const corsOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((origin) => {
  try { return new URL(origin.trim()).origin; } catch { return ""; }
}).filter(Boolean);
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);
const apiRoutes = {
  
  auth: "authRoutes",
  students: "studentRoutes",
  faculty: "facultyRoutes",
  classes: "classRoutes",
  attendance: "attendanceRoutes",
  rooms: "roomRoutes",
  bookings: "bookingRoutes",
  notices: "noticeRoutes",
  complaints: "complaintRoutes",
  notifications: "notificationRoutes",
  activity: "activityRoutes",
  dashboard: "dashboardRoutes",
  "admin/users": "adminUserRoutes",
};

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
  return next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Total-Count", "X-Page", "X-Page-Size", "X-Total-Pages", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
  maxAge: 600,
}));
app.use(express.json({ limit: "100kb", strict: true }));

app.get("/api/health", (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  return res.status(databaseReady ? 200 : 503).json({ ok: databaseReady, service: "Smart Campus API" });
});

Object.entries(apiRoutes).forEach(([path, routeName]) => {
  app.use(`/api/${path}`, require(`./routes/${routeName}`));
});

app.use((req, res) => res.status(404).json({ message: "API route not found." }));

app.use((error, req, res, next) => {
  const status = error.type === "entity.parse.failed" ? 400
    : error.type === "entity.too.large" ? 413
      : Number.isInteger(error.status) && error.status < 500 ? error.status : 500;
  if (status >= 500) console.error("Unhandled API error:", { method: req.method, path: req.path, error: error.name || "Error", code: error.code || "unknown" });
  const message = status === 400 ? "Invalid JSON request body."
    : status === 413 ? "Request body is too large."
      : status >= 500 ? "Internal server error."
        : "Request rejected.";
  return res.status(status).json({ message });
});

async function startServer() {
  let configuration;
  try {
    configuration = validateEnvironment();
  } catch (error) {
    console.error("Server configuration invalid:", error.message);
    process.exitCode = 1;
    return;
  }

  try {
    await connectDB();
    app.listen(configuration.port, () => {
      console.log(`API listening on port ${configuration.port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.name || "Error");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
