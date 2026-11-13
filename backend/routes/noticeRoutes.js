const express = require("express");
const mongoose = require("mongoose");
const Notice = require("../models/Notice");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { hasOnlyFields } = require("../utils/validation");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const respondError = require("../utils/respondError");
const recordActivity = require("../utils/activityLog");

const router = express.Router();

router.use(protect);

router.get("/", async (req, res) => {
  try {
    const baseFilter =
      req.user.role === "admin"
        ? {}
        : { $or: [{ audience: "all" }, { audience: req.user.role }] };
    if (req.query.recordId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.recordId)) return res.status(400).json({ message: "Record filter is invalid." });
    }
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    let filter = req.query.recordId !== undefined
      ? { $and: [baseFilter, { _id: req.query.recordId }] }
      : baseFilter;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const searchFilter = { $or: ["title", "body", "category"].map((field) => ({ [field]: regex })) };
      filter = Object.keys(baseFilter).length ? { $and: [baseFilter, searchFilter] } : searchFilter;
    }
    const sort = readSort(req, res, ["createdAt", "title", "category"], "createdAt", "desc");
    if (sort === false) return;
    const notices = await executeListQuery({ query: Notice.find(filter)
      .populate("author", "name")
      .sort(sort)
      .lean(), Model: Notice, filter, pagination, res });

    return res.json(notices);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load notices" });
  }
});

router.post("/", authorizeRoles("admin", "faculty"), async (req, res) => {
  try {
    const allowedAudiences = ["all", "student", "faculty"];
    const body = req.body || {};
    if (!hasOnlyFields(body, ["title", "body", "category", "audience"])) return res.status(400).json({ message: "Request contains unsupported fields." });
    const { title, body: noticeBody, category } = body;
    const audience = body.audience || "all";

    if (typeof title !== "string" || !title.trim() || title.trim().length > 160 ||
      typeof noticeBody !== "string" || !noticeBody.trim() || noticeBody.trim().length > 5000 ||
      (category !== undefined && (typeof category !== "string" || category.length > 80))) {
      return res.status(400).json({ message: "Provide a title, announcement (maximum 5,000 characters), and valid category." });
    }

    if (!allowedAudiences.includes(audience)) {
      return res
        .status(400)
        .json({ message: "Select a valid notice audience" });
    }

    const notice = await Notice.create({
      title: title.trim(),
      body: noticeBody.trim(),
      category: category?.trim() || "General",
      audience,
      author: req.user.id,
    });

    await recordActivity({ actor: req.user.id, action: "Notice published", entityType: "notice", entityId: notice._id, summary: `Published notice: ${notice.title}.` });

    return res.status(201).json(notice);
  } catch (error) {
    return respondError(res, error, "Notice creation", "Unable to publish notice.");
  }
});

router.delete("/:id", authorizeRoles("admin"), async (req, res) => {
  try {
    const notice = await Notice.findByIdAndDelete(req.params.id);

    if (!notice) {
      return res.status(404).json({ message: "Notice not found" });
    }

    await recordActivity({ actor: req.user.id, action: "Notice deleted", entityType: "notice", entityId: notice._id, summary: `Deleted notice: ${notice.title}.` });

    return res.json({ message: "Notice removed" });
  } catch (error) {
    return respondError(res, error, "Notice deletion", "Unable to remove notice.");
  }
});

module.exports = router;
