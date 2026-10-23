const db = require("../config/database");

// Shared by findAll and count so both always apply identical filters.
function buildWhere({ category, activeOnly }) {
  const params = [];
  const conditions = [];

  if (activeOnly) {
    conditions.push("is_active = true");
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  return { where, params };
}

async function findAll({ category, activeOnly = true, limit, offset } = {}) {
  const { where, params } = buildWhere({ category, activeOnly });
  let sql = "SELECT * FROM products" + where + " ORDER BY name, id";

  if (limit !== undefined) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (offset !== undefined) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ category, activeOnly = true } = {}) {
  const { where, params } = buildWhere({ category, activeOnly });
  const { rows } = await db.query(
    "SELECT COUNT(*) FROM products" + where,
    params
  );
  return Number(rows[0].count);
}

async function findById(id) {
  const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [id]);
  return rows[0] || null;
}

async function findBySku(sku) {
  const { rows } = await db.query("SELECT * FROM products WHERE sku = $1", [
    sku,
  ]);
  return rows[0] || null;
}

async function updateStock(productId, quantityDelta) {
  const { rows } = await db.query(
    `UPDATE products
     SET stock = stock + $1, updated_at = NOW()
     WHERE id = $2 AND stock + $1 >= 0
     RETURNING *`,
    [quantityDelta, productId]
  );
  return rows[0] || null;
}

module.exports = { findAll, count, findById, findBySku, updateStock };
