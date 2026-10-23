# SPEC: Pagination for GET /api/products

## Goal

`GET /api/products` currently returns every active product in one response ([src/routes/products.js:13](src/routes/products.js#L13)). Add `limit`/`offset` pagination with a stable ordering and a `total` count, so clients can page through the catalogue without the response growing unbounded. The change is additive: existing clients that read `products` and `count` keep working.

## Decisions

Rulings marked **(ruled)** were decided by the owner. Items marked **⚠ may disagree** are my recommendations and are open for a ruling.

| # | Decision | Options | Pick | Reason |
|---|----------|---------|------|--------|
| 1 | Default and max `limit` | 20/100; 50/200 (matches orders); no max | **Default 20, max 100 (ruled)** | Bounds payload size; orders' 50 default has no cap at all. |
| 2a | `limit` above max | clamp to 100; 400 | **Clamp to 100 (ruled)** | A too-large page size is harmless to honour at the cap, and the response echoes the effective `limit`. |
| 2b | Invalid `limit`/`offset` (non-integer, negative, `limit < 1`) | 400; clamp/fallback to defaults | **400 `{ error }` (ruled)** | Avoids the silent fallbacks in orders (`parseInt(x) \|\| 50`, [routes/orders.js:22](src/routes/orders.js#L22)) that turn `limit=0` into 50. |
| 3 | Ordering | `name`; `name, id`; `created_at` | **`ORDER BY name, id` (ruled)** | `name` is not unique ([models/Product.js:19](src/models/Product.js#L19)), so pages could repeat or skip rows without a tie-break. |
| 4 | Total count | separate `COUNT(*)` with identical filters; window function; none | **Separate COUNT, identical `WHERE` (ruled)** | Simple and testable. Not transactional with the page query, so `total` can drift by a row under concurrent writes; accepted. |
| 5 | Response shape | additive `{ products, count, total, limit, offset }`; envelope/rename | **Additive; `count` stays "items in this page" (ruled)** | No breaking change; `limit`/`offset` echo the effective values after clamping. |

Smaller choices I made while writing this. **⚠ may disagree**:

- **Strict integer syntax.** A value is valid only if it is a single string matching `^\d+$`. This rejects `"10abc"`, `"1.5"`, `"-1"`, `"+5"`, `" 5"`, `"0x10"`, `"1e2"` and the empty string `?limit=`. Alternative: treat an empty value as absent and use the default. I chose 400 so the rule is one sentence.
- **Repeated or nested params are 400.** `?limit=1&limit=2` and `?limit[a]=1` make Express produce an array or object rather than a string, so they fail the "single string" check. Same for `offset`. **Known imperfection:** a nested param such as `?limit[a]=1` gets the same `... must be provided only once` message as a repeated param, even though the problem is its shape, not repetition. I accept this to keep one rule and four error strings; the DoD pins the behaviour (item 16) so it is not changed by accident.
- **Huge digit strings.** `limit=99999999999999999999` matches the pattern, so it is valid and clamps to 100. `offset` greater than `Number.MAX_SAFE_INTEGER` returns 400 (avoids precision loss and a Postgres bigint overflow). Alternative: accept and let the DB return an empty page.
- **Leading zeros** (`limit=010`) are accepted as 10. Alternative: reject.
- **Validation order.** `limit` is checked before `offset`; if both are invalid the `limit` error is returned.
- **Where validation lives.** In the route (parse and validate once, then pass numbers to the model). The model takes already-valid numbers and does no validation.
- **Model back-compat.** `Product.findAll` keeps working unpaginated when `limit`/`offset` are omitted (no `LIMIT`/`OFFSET` clause is added). The route always passes both. Alternative: make the model default to 20/0 itself, which would put the defaults in two places, as orders does today.
- **Error text** (exact strings, fixed so tests can assert them):
  - `limit must be a positive integer`
  - `offset must be a non-negative integer`
  - `limit must be provided only once`
  - `offset must be provided only once`
- **Repeated `category`** is existing behaviour and is not changed by this feature.

## Files that change, in order

1. [src/models/Product.js](src/models/Product.js): extend `findAll({ category, activeOnly, limit, offset })` with `ORDER BY name, id` and optional `LIMIT $n OFFSET $n`; add `count({ category, activeOnly })` using the same `WHERE` logic (shared helper so the filters cannot diverge); export `count`.
2. [src/routes/products.js](src/routes/products.js): parse and validate `limit`/`offset` from `req.query`; call `findAll` and `count`; respond with the new shape; update the doc comment.
3. Tests (written and committed **first**, per CAPSTONE.md, and confirmed failing before items 1 and 2 are implemented):
   - `tests/routes/products.test.js` (new): supertest against `src/index.js` with the DB config and `Product` model mocked.
   - `tests/models/product.test.js` (new): mocks `config/database` and asserts the SQL text and params.
4. [README.md](README.md): update the `GET /api/products` row (line 29) with the `limit`, `offset` and `category` params and the response shape.

Commit order: SPEC.md, then failing tests, then model, route and README.

## Out of scope

- `GET /api/orders` and its limit/offset parsing bugs ([routes/orders.js](src/routes/orders.js), [models/Order.js](src/models/Order.js)); these are noted in REVIEW.md or PROCESS.md only.
- `GET /api/orders/history` ([handlers/orderHistory.js](src/handlers/orderHistory.js)).
- Authentication and authorization, including `optionalAuth` ([middleware/auth.js](src/middleware/auth.js)); `GET /api/products` stays public.
- `GET /api/products/:id`, `findById`, `findBySku` and `updateStock`.
- [src/routes/search.js](src/routes/search.js), migrations (no index or schema change), CI, `.claude/` files.
- New dependencies. `supertest` and `jest` are already in devDependencies.
- Cursor/keyset pagination, sorting options, and `Link` headers.

## Definition of done

Route tests use a mocked `Product` model. Unless stated, `Product.findAll` resolves to a fixture array and `Product.count` resolves to a number, and the request carries no `Authorization` header. "findAll called with" means the exact argument object.

**Defaults and custom values**

1. `GET /api/products` returns **200**. `findAll` is called with `{ category: undefined, limit: 20, offset: 0 }` and `count` with `{ category: undefined }`. With 3 fixture rows and `count` resolving 3, the body is `{"products":[<3 rows>],"count":3,"total":3,"limit":20,"offset":0}`.
2. `GET /api/products?limit=5&offset=10` returns **200**. `findAll` is called with `limit: 5, offset: 10`. With 2 fixture rows and `count` resolving 42, the body is `{"products":[<2 rows>],"count":2,"total":42,"limit":5,"offset":10}`.

**Limit above max (clamped)**

3. `GET /api/products?limit=101` returns **200**. `findAll` is called with `limit: 100` and the body has `"limit":100`. The same holds for `limit=100000` and `limit=99999999999999999999`. `limit=100` is used as is.

**Invalid input (400)**

For every case below the status is **400**, the body is exactly the JSON shown, and neither `findAll` nor `count` is called.

4. `?limit=0` → `{"error":"limit must be a positive integer"}`
5. `?limit=abc` → `{"error":"limit must be a positive integer"}`
6. `?limit=10abc` → `{"error":"limit must be a positive integer"}`
7. `?limit=1.5` → `{"error":"limit must be a positive integer"}`
8. `?limit=-1` → `{"error":"limit must be a positive integer"}`
9. `?limit=` (empty) → `{"error":"limit must be a positive integer"}`
10. `?limit=1&limit=2` → `{"error":"limit must be provided only once"}`
11. `?offset=-1` → `{"error":"offset must be a non-negative integer"}`
12. `?offset=abc`, `?offset=1.5`, `?offset=2abc` and `?offset=` each → `{"error":"offset must be a non-negative integer"}`
13. `?offset=1&offset=2` → `{"error":"offset must be provided only once"}`
14. `?offset=0` is valid (**200**, `"offset":0`); `?limit=1` is valid (**200**, `"limit":1`). These are the boundaries of the rules above.
15. `?limit=abc&offset=-1` → **400** with the `limit` error (limit is validated first).
16. `?limit[a]=1` (nested; Express parses it to an object) → **400** `{"error":"limit must be provided only once"}`. This reuses the repeated-param message; see the known imperfection in Decisions.

**Offset and limit syntax edges**

17. `?offset=9007199254740992` (`Number.MAX_SAFE_INTEGER + 1`) → **400** `{"error":"offset must be a non-negative integer"}`, and neither `findAll` nor `count` is called.
18. `?offset=9007199254740991` (`Number.MAX_SAFE_INTEGER`) → **200**. `findAll` is called with `offset: 9007199254740991`. With `findAll` resolving `[]` and `count` resolving 7, the body is `{"products":[],"count":0,"total":7,"limit":20,"offset":9007199254740991}`.
19. `?limit=010` → **200**. `findAll` is called with `limit: 10` and the body has `"limit":10`.

**Category filter with pagination**

20. `GET /api/products?category=books&limit=2&offset=2` returns **200**. `findAll` is called with `{ category: "books", limit: 2, offset: 2 }` and `count` with `{ category: "books" }`.
21. With `count` mocked to resolve 7 when called with `category: "books"` and 40 when called without a category, `?category=books` returns `"total":7` and an unfiltered request returns `"total":40`.

**Offset beyond the end**

22. With `findAll` resolving `[]` and `count` resolving 7, `GET /api/products?offset=1000` returns **200** and the body is exactly `{"products":[],"count":0,"total":7,"limit":20,"offset":1000}`.

**Model SQL** (`tests/models/product.test.js`, with `db.query` mocked)

23. `findAll({ category: "books", limit: 2, offset: 4 })` runs SQL that contains `WHERE is_active = true AND category = $1`, `ORDER BY name, id`, `LIMIT $2` and `OFFSET $3`, with params `["books", 2, 4]`.
24. `findAll({})` with no limit/offset still returns rows, with no `LIMIT` or `OFFSET` in the SQL and `ORDER BY name, id`.
25. `count({ category: "books" })` runs `SELECT COUNT(*) ...` with the same `WHERE` clause and params `["books"]` as item 23 (without limit/offset), and returns a JavaScript number (the mocked `rows[0].count` is the string `"7"` and the result is `7`).
26. `count({})` uses `WHERE is_active = true` and no category param.

**Errors and regressions**

27. If `findAll` or `count` rejects, the response is **500** through the existing `errorHandler` (not a 200 and not a hang).
28. `GET /api/products/:id` behaviour is unchanged. `npm test` passes in full, including the existing suites.
29. The diff touches only SPEC.md, `src/models/Product.js`, `src/routes/products.js`, `README.md` and the two new test files. `package.json` and `package-lock.json` are unchanged.

## Verification

- The one test command is `npm test`.
- **Fail before:** after committing the new tests and before touching `src/`, run `npm test`. The new tests in `tests/routes/products.test.js` and `tests/models/product.test.js` must fail because the feature is missing (for example missing `total`, missing `count` export, no 400s), not because of import errors or syntax errors, and the existing suites must still pass. Record the failing output.
- **Pass after:** after implementing the model, route and README, run `npm test` again. All suites pass with no test weakened or removed since the failing commit; confirm with `git diff <failing-tests-commit> -- tests/`.
- CI (`.github/workflows/ci.yml`) runs the same `npm test` on the pushed branch and must be green.
