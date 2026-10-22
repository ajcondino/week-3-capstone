/**
 * Tests for the Product model's list and count queries (see SPEC.md).
 *
 * Covers: findAll SQL and params (filters, ORDER BY name, id, LIMIT/OFFSET),
 * findAll without paging options, count SQL and params, and count returning a
 * number. SQL is whitespace-normalised and checked clause by clause.
 * Does NOT test: findById, findBySku, updateStock, or a real database.
 */

jest.mock("../../src/config/database", () => ({
  query: jest.fn(),
}));

const db = require("../../src/config/database");
const Product = require("../../src/models/Product");

const normalise = (sql) => sql.replace(/\s+/g, " ");
const lastCall = () => {
  const [sql, params] = db.query.mock.calls[0];
  return { sql: normalise(sql), params };
};

describe("Product model", () => {
  afterEach(() => jest.clearAllMocks());

  describe("findAll()", () => {
    it("should filter by active and category, order by name then id, and apply LIMIT and OFFSET", async () => {
      db.query.mockResolvedValue({ rows: [] });

      await Product.findAll({ category: "books", limit: 2, offset: 4 });

      const { sql, params } = lastCall();
      expect(sql).toContain("WHERE is_active = true AND category = $1");
      expect(sql).toContain("ORDER BY name, id");
      expect(sql).toContain("LIMIT $2");
      expect(sql).toContain("OFFSET $3");
      expect(params).toEqual(["books", 2, 4]);
    });

    it("should put LIMIT and OFFSET after ORDER BY", async () => {
      db.query.mockResolvedValue({ rows: [] });

      await Product.findAll({ limit: 5, offset: 0 });

      const { sql, params } = lastCall();
      expect(sql.indexOf("ORDER BY name, id")).toBeGreaterThan(-1);
      expect(sql.indexOf("LIMIT")).toBeGreaterThan(sql.indexOf("ORDER BY"));
      expect(sql.indexOf("OFFSET")).toBeGreaterThan(sql.indexOf("LIMIT"));
      expect(sql).toContain("LIMIT $1");
      expect(sql).toContain("OFFSET $2");
      expect(params).toEqual([5, 0]);
    });

    it("should still return rows and add no LIMIT or OFFSET when called without paging options", async () => {
      const rows = [{ id: "p1" }, { id: "p2" }];
      db.query.mockResolvedValue({ rows });

      const result = await Product.findAll({});

      const { sql, params } = lastCall();
      expect(result).toEqual(rows);
      expect(sql).toContain("ORDER BY name, id");
      expect(sql).not.toContain("LIMIT");
      expect(sql).not.toContain("OFFSET");
      expect(params).toEqual([]);
    });
  });

  describe("count()", () => {
    beforeEach(() => {
      expect(Product.count).toEqual(expect.any(Function));
    });

    it("should count with the same WHERE clause and category param as findAll", async () => {
      db.query.mockResolvedValue({ rows: [{ count: "7" }] });

      await Product.count({ category: "books" });

      const { sql, params } = lastCall();
      expect(sql).toContain("SELECT COUNT(*)");
      expect(sql).toContain("WHERE is_active = true AND category = $1");
      expect(sql).not.toContain("LIMIT");
      expect(sql).not.toContain("OFFSET");
      expect(params).toEqual(["books"]);
    });

    it("should return a number, not the string pg gives for COUNT", async () => {
      db.query.mockResolvedValue({ rows: [{ count: "7" }] });

      const total = await Product.count({ category: "books" });

      expect(total).toBe(7);
    });

    it("should count only active products when no category is given", async () => {
      db.query.mockResolvedValue({ rows: [{ count: "40" }] });

      const total = await Product.count({});

      const { sql, params } = lastCall();
      expect(sql).toContain("WHERE is_active = true");
      expect(sql).not.toContain("category");
      expect(params).toEqual([]);
      expect(total).toBe(40);
    });
  });
});
