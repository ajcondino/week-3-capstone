const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { optionalAuth } = require("../middleware/auth");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Query params must be a single string of digits; repeated (?a=1&a=2) or
// nested (?a[b]=1) params arrive as arrays/objects and are rejected.
function parseLimit(value) {
  if (value === undefined) return { value: DEFAULT_LIMIT };
  if (typeof value !== "string") {
    return { error: "limit must be provided only once" };
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    return { error: "limit must be a positive integer" };
  }
  return { value: Math.min(Number(value), MAX_LIMIT) };
}

function parseOffset(value) {
  if (value === undefined) return { value: 0 };
  if (typeof value !== "string") {
    return { error: "offset must be provided only once" };
  }
  if (!/^\d+$/.test(value) || Number(value) > Number.MAX_SAFE_INTEGER) {
    return { error: "offset must be a non-negative integer" };
  }
  return { value: Number(value) };
}

/**
 * GET /api/products
 * List active products, paginated. Optional ?category= filter,
 * ?limit= (default 20, max 100, larger values are clamped) and ?offset=
 * (default 0). Invalid limit/offset returns 400.
 * Responds { products, count, total, limit, offset }: count is the number of
 * items in this page, total the number matching the filter.
 */
router.get("/", optionalAuth(), async (req, res, next) => {
  try {
    const { category } = req.query;

    const limit = parseLimit(req.query.limit);
    if (limit.error) return res.status(400).json({ error: limit.error });
    const offset = parseOffset(req.query.offset);
    if (offset.error) return res.status(400).json({ error: offset.error });

    const [products, total] = await Promise.all([
      Product.findAll({ category, limit: limit.value, offset: offset.value }),
      Product.count({ category }),
    ]);
    res.json({
      products,
      count: products.length,
      total,
      limit: limit.value,
      offset: offset.value,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
