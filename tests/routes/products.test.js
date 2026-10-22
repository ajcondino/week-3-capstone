/**
 * Tests for GET /api/products pagination (see SPEC.md, Definition of Done).
 *
 * Covers: defaults, custom limit/offset, limit clamping, 400 responses for
 * invalid limit/offset (exact error bodies, model never called), category
 * filter combined with pagination, total reflecting the filter, offset past
 * the end, MAX_SAFE_INTEGER boundaries, and model errors surfacing as 500.
 * Does NOT test: SQL (see tests/models/product.test.js), auth, GET /:id.
 *
 * Runs against the real app in src/index.js with the database config and the
 * Product model mocked, so no database is needed.
 */

jest.mock("../../src/config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../../src/models/Product", () => ({
  findAll: jest.fn(),
  count: jest.fn(),
  findById: jest.fn(),
  findBySku: jest.fn(),
  updateStock: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require("supertest");
const Product = require("../../src/models/Product");
const app = require("../../src/index");

const makeProduct = (overrides = {}) => ({
  id: "prod-1",
  name: "Widget",
  category: "books",
  price: "10.00",
  stock: 5,
  is_active: true,
  ...overrides,
});

const LIMIT_ERROR = { error: "limit must be a positive integer" };
const OFFSET_ERROR = { error: "offset must be a non-negative integer" };

describe("GET /api/products", () => {
  afterEach(() => jest.clearAllMocks());

  describe("defaults and custom values", () => {
    it("should return the first page with limit 20 and offset 0 by default", async () => {
      const rows = [
        makeProduct({ id: "p1" }),
        makeProduct({ id: "p2" }),
        makeProduct({ id: "p3" }),
      ];
      Product.findAll.mockResolvedValue(rows);
      Product.count.mockResolvedValue(3);

      const res = await request(app).get("/api/products");

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith({
        category: undefined,
        limit: 20,
        offset: 0,
      });
      expect(Product.count).toHaveBeenCalledWith({ category: undefined });
      expect(res.body).toEqual({
        products: rows,
        count: 3,
        total: 3,
        limit: 20,
        offset: 0,
      });
    });

    it("should honour a custom limit and offset and echo them back", async () => {
      const rows = [makeProduct({ id: "p11" }), makeProduct({ id: "p12" })];
      Product.findAll.mockResolvedValue(rows);
      Product.count.mockResolvedValue(42);

      const res = await request(app).get("/api/products?limit=5&offset=10");

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith({
        category: undefined,
        limit: 5,
        offset: 10,
      });
      expect(res.body).toEqual({
        products: rows,
        count: 2,
        total: 42,
        limit: 5,
        offset: 10,
      });
    });

    it("should accept the lower boundaries limit=1 and offset=0", async () => {
      Product.findAll.mockResolvedValue([makeProduct()]);
      Product.count.mockResolvedValue(1);

      const res = await request(app).get("/api/products?limit=1&offset=0");

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(0);
    });

    it("should accept a leading-zero limit and treat it as decimal", async () => {
      Product.findAll.mockResolvedValue([]);
      Product.count.mockResolvedValue(0);

      const res = await request(app).get("/api/products?limit=010");

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
      expect(res.body.limit).toBe(10);
    });
  });

  describe("limit above max (clamped)", () => {
    test.each([["101"], ["100000"], ["99999999999999999999"]])(
      "should clamp limit=%s to 100",
      async (value) => {
        Product.findAll.mockResolvedValue([]);
        Product.count.mockResolvedValue(0);

        const res = await request(app).get(`/api/products?limit=${value}`);

        expect(res.status).toBe(200);
        expect(Product.findAll).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 100 })
        );
        expect(res.body.limit).toBe(100);
      }
    );

    it("should use limit=100 as is", async () => {
      Product.findAll.mockResolvedValue([]);
      Product.count.mockResolvedValue(0);

      const res = await request(app).get("/api/products?limit=100");

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
      expect(res.body.limit).toBe(100);
    });
  });

  describe("invalid input (400)", () => {
    test.each([
      ["limit=0", "?limit=0", LIMIT_ERROR],
      ["limit=abc", "?limit=abc", LIMIT_ERROR],
      ["limit=10abc", "?limit=10abc", LIMIT_ERROR],
      ["limit=1.5", "?limit=1.5", LIMIT_ERROR],
      ["limit=-1", "?limit=-1", LIMIT_ERROR],
      ["limit= (empty)", "?limit=", LIMIT_ERROR],
      ["offset=-1", "?offset=-1", OFFSET_ERROR],
      ["offset=abc", "?offset=abc", OFFSET_ERROR],
      ["offset=1.5", "?offset=1.5", OFFSET_ERROR],
      ["offset=2abc", "?offset=2abc", OFFSET_ERROR],
      ["offset= (empty)", "?offset=", OFFSET_ERROR],
      [
        "offset=MAX_SAFE_INTEGER+1",
        "?offset=9007199254740992",
        OFFSET_ERROR,
      ],
      [
        "limit repeated",
        "?limit=1&limit=2",
        { error: "limit must be provided only once" },
      ],
      [
        "limit nested",
        "?limit[a]=1",
        { error: "limit must be provided only once" },
      ],
      [
        "offset repeated",
        "?offset=1&offset=2",
        { error: "offset must be provided only once" },
      ],
      ["limit invalid and offset invalid", "?limit=abc&offset=-1", LIMIT_ERROR],
    ])(
      "should reject %s with 400 and not query the model",
      async (_name, query, expectedBody) => {
        const res = await request(app).get(`/api/products${query}`);

        expect(res.status).toBe(400);
        expect(res.body).toEqual(expectedBody);
        expect(Product.findAll).not.toHaveBeenCalled();
        expect(Product.count).not.toHaveBeenCalled();
      }
    );
  });

  describe("category filter with pagination", () => {
    it("should pass the category and paging values to findAll and the category to count", async () => {
      Product.findAll.mockResolvedValue([makeProduct()]);
      Product.count.mockResolvedValue(7);

      const res = await request(app).get(
        "/api/products?category=books&limit=2&offset=2"
      );

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith({
        category: "books",
        limit: 2,
        offset: 2,
      });
      expect(Product.count).toHaveBeenCalledWith({ category: "books" });
    });

    it("should report a total that reflects the category filter", async () => {
      Product.findAll.mockResolvedValue([makeProduct()]);
      Product.count.mockImplementation(({ category } = {}) =>
        Promise.resolve(category === "books" ? 7 : 40)
      );

      const filtered = await request(app).get("/api/products?category=books");
      const unfiltered = await request(app).get("/api/products");

      expect(filtered.status).toBe(200);
      expect(filtered.body.total).toBe(7);
      expect(unfiltered.status).toBe(200);
      expect(unfiltered.body.total).toBe(40);
    });
  });

  describe("offset beyond the end and large offsets", () => {
    it("should return an empty page with the correct total when offset is past the end", async () => {
      Product.findAll.mockResolvedValue([]);
      Product.count.mockResolvedValue(7);

      const res = await request(app).get("/api/products?offset=1000");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        products: [],
        count: 0,
        total: 7,
        limit: 20,
        offset: 1000,
      });
    });

    it("should accept offset=Number.MAX_SAFE_INTEGER", async () => {
      Product.findAll.mockResolvedValue([]);
      Product.count.mockResolvedValue(7);

      const res = await request(app).get("/api/products?offset=9007199254740991");

      expect(res.status).toBe(200);
      expect(Product.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 9007199254740991 })
      );
      expect(res.body).toEqual({
        products: [],
        count: 0,
        total: 7,
        limit: 20,
        offset: 9007199254740991,
      });
    });
  });

  describe("model errors", () => {
    it("should return 500 when findAll rejects", async () => {
      Product.findAll.mockRejectedValue(new Error("db down"));
      Product.count.mockResolvedValue(0);

      const res = await request(app).get("/api/products");

      expect(res.status).toBe(500);
    });

    it("should return 500 when count rejects", async () => {
      Product.findAll.mockResolvedValue([]);
      Product.count.mockRejectedValue(new Error("db down"));

      const res = await request(app).get("/api/products");

      expect(res.status).toBe(500);
    });
  });
});
