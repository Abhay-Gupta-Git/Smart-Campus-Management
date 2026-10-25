require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const app = express();
const port = process.env.PORT || 5000;
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
  dashboard: "dashboardRoutes",
  "admin/users": "adminUserRoutes",
};

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  return res.json({ ok: true, service: "Smart Campus API" });
});

Object.entries(apiRoutes).forEach(([path, routeName]) => {
  app.use(`/api/${path}`, require(`./routes/${routeName}`));
});

app.use((error, req, res, next) => {
  console.error(error);
  return res.status(error.status || 500).json({
    message: error.message || "Server error",
  });
});

async function startServer() {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`API listening on port ${port}`);
    });
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
