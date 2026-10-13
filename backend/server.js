const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");

dotenv.config();

const app = express();

connectDB();

app.use(express.json());
app.use("/api/auth", authRoutes);
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Smart Campus Management System API Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});