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

module.exports = { readPagination, executeListQuery };
