function readPagination(req, res) {
  if (req.query.page === undefined && req.query.limit === undefined) return null;
  const pageText = String(req.query.page ?? "1");
  const limitText = String(req.query.limit ?? "50");
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) {
    res.status(400).json({ message: "Page and limit must be positive integers." });
    return false;
  }
  const page = Number(pageText);
  const limit = Number(limitText);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(skip)) {
    res.status(400).json({ message: "Page must be positive and limit must be between 1 and 100." });
    return false;
  }
  return { page, limit, skip };
}

function readSearch(req, res, maxLength = 100) {
  if (req.query.search === undefined) return "";
  if (typeof req.query.search !== "string") {
    res.status(400).json({ message: "Search must be a single text value." });
    return false;
  }
  const search = req.query.search.trim();
  if (search.length > maxLength) {
    res.status(400).json({ message: `Search must be ${maxLength} characters or fewer.` });
    return false;
  }
  return search;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSort(req, res, allowedFields, defaultField, defaultDirection = "asc") {
  const field = req.query.sort === undefined ? defaultField : req.query.sort;
  const direction = req.query.direction === undefined ? defaultDirection : req.query.direction;
  if (typeof field !== "string" || !allowedFields.includes(field)) {
    res.status(400).json({ message: "Sort field is not supported." });
    return false;
  }
  if (!(["asc", "desc"].includes(direction))) {
    res.status(400).json({ message: "Sort direction must be asc or desc." });
    return false;
  }
  return { [field]: direction === "desc" ? -1 : 1, _id: 1 };
}

async function executeListQuery({ query, Model, filter, pagination, res }) {
  if (pagination === false) return null;
  if (!pagination) return query;
  const [items, total] = await Promise.all([
    query.skip(pagination.skip).limit(pagination.limit),
    Model.countDocuments(filter),
  ]);
  res.set("X-Total-Count", String(total));
  res.set("X-Page", String(pagination.page));
  res.set("X-Page-Size", String(pagination.limit));
  res.set("X-Total-Pages", String(Math.ceil(total / pagination.limit)));
  return items;
}

module.exports = { readPagination, readSearch, escapeRegex, readSort, executeListQuery };
