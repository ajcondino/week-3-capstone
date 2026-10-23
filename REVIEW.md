# REVIEW: pagination for GET /api/products

SPECS pass over `git diff main...HEAD` (branch `feat/products-pagination`) against [SPEC.md](SPEC.md). Evidence: `npm test` (9 suites, 82 tests, all pass) and a probe that sent hostile query strings to the real app with only `config/database` stubbed (the script is not in the repo).

Accepted risks: 4 med, none fixed, all out of scope (see findings)

## Findings
1. [med] [Product.js:23](src/models/Product.js#L23), [:41](src/models/Product.js#L41): no index supports `WHERE is_active = true ORDER BY name, id` or the `COUNT(*)`; only `idx_products_category` exists. Every request sorts and counts all active rows. Migrations are out of scope in SPEC.md.
2. [med] [products.js:50-53](src/routes/products.js#L50-L53): two concurrent queries per request (was one). Pool is `max: 20` with a 2s connect timeout, so ~10 concurrent requests exhaust it and the rest fail with 500.
3. [med] No rate limiting on this public route; `cors()` is open and the per-user limiter in [auth.js:48](src/middleware/auth.js#L48) is not applied here.
4. [med] [errorHandler.js:21-24](src/middleware/errorHandler.js#L21-L24) returns `err.message`, and `err.stack` outside production, to anonymous callers. Pre-existing, but my tests pin it (`expect(res.body.error).toBe("db down")`), so fixing the handler breaks them.
5. [low] `category` is unvalidated; arrays and objects reach `pg`. Pre-existing, but `count` now takes it too.
6. [low] Nested params (`limit[a]=1`) get "must be provided only once", the wrong message for that shape. Known, accepted in SPEC.md (DoD 16).
7. [low] `1e9`, `0x10`, `+5`, `" 5"` and full-width digits are not in the test suite; only the `^\d+$` regex protects them.

## S: Security
**Inputs.** `limit`: absent gives 20; a string matching `^\d+$` and ≥ 1 is clamped to 100. `offset`: absent gives 0; digits only and ≤ `MAX_SAFE_INTEGER`. `category`: passed through unparsed. Express 4.22.1, default `qs` parser. Probe results:

| Query | Status | Result |
|---|---|---|
| `limit=abc` | 400 | `limit must be a positive integer`, no SQL |
| `limit=1e9` | 400 | same, no SQL (`-1`, `0x10`, `+5`, ` 5`, `5\n` behave the same) |
| `limit[a]=1` | 400 | `limit must be provided only once`, no SQL (`limit=1&limit=2` too) |
| `offset=9007199254740991` | 200 | SQL params `[20, 9007199254740991]`; `...992` and 20 digits are 400 |
| `category=a&category=b` | 200 | SQL params `[["a","b"], 20, 0]`; what Postgres does with it is unverified |
| `category='; DROP TABLE products;--` | 200 | arrives as a bound param, nothing in the SQL text |

**SQL injection.** All three are bound parameters, none concatenated: `category` at [Product.js:11-13](src/models/Product.js#L11-L13), `limit` and `offset` at [:25-32](src/models/Product.js#L25-L32). Only `$${params.length}` and fixed keywords are interpolated. The model tests assert SQL text against a mocked `db.query`; they do not prove Postgres accepts it.

**Authorization.** The route is public (`optionalAuth()`) and pagination does not change that; I am intentionally not changing it (out of scope in SPEC.md). `req.user` is not read, and nothing lets a client set `activeOnly`. A valid Bearer token still costs an extra `users` query ([auth.js:294](src/middleware/auth.js#L294)), worsening finding 2.

**DoS.** Max limit 100 is a real improvement over unbounded, but `SELECT *` still returns every column. `COUNT(*)` is a full scan on every request, uncached. A deep offset costs about one full sort of the matching rows, capped by table size, so `offset=2^53-1` is no worse (reasoned, not run). Not fixing: index, rate limit, offset cap (it would not reduce cost), keyset pagination, single-query count (SPEC.md decision 4; `total` can be a row stale).

**Information disclosure.** `total` reveals nothing new: it counts the same active rows, with the same `WHERE`, that the endpoint already lists, and never includes inactive products. Probing `category` strings reveals only what the old unpaginated list showed. What does leak is finding 4.

## P / E / C / S
**Patterns.** SQL stays in the model, parsing and status in the route. Validation sends 400s directly instead of throwing `.status`, matching this route's existing style. `parseLimit` and `parseOffset` are near-duplicates and differ from the buggy orders parsing; I did not unify them.

**Edge cases.** Tests cover defaults, boundaries, clamping, the invalid-input table, repeated/nested params, `MAX_SAFE_INTEGER` ±1, offset past the end, category plus paging, `total` per filter, and 500s. Not covered: concurrent-write drift of `total`, `?category=` (empty means no filter), and stable page order on real data.

**Context.** DoD 1-27 each map to a test (checked by test name); DoD 28 passes; the committed diff touches only the files in DoD 29. Failing-tests-first: I re-ran `npm test` at `6506012`: 35 failed, 45 passed, with both new suites failing on assertions (not import errors) and the 7 existing suites green. `git diff 6506012 -- tests/` shows one file, +30/−2: two `"db down"` assertions, the `GET /:id` 200 and 404 tests, and header comments. Nothing was removed or weakened (the 2 deletions are comment lines). `count` now means items on this page, so a client that read it as the overall total sees a smaller number once there is more than one page (SPEC.md decision 5).

**Simplicity.** Smallest diff that does the job: one shared `buildWhere`, one `count`, two small parsers, no new dependencies. The model's optional `limit`/`offset` path is a second code path that production no longer uses (kept for back-compat, DoD 24).

## Not done / not verified
- No real-Postgres test, `EXPLAIN`, or load test; SQL is checked as text and the pool-exhaustion argument is arithmetic from the config.
- `category` as array or object: Postgres behaviour is expected, not observed.
- No index, rate limit, error-handler fix, `category` validation or `total` caching (findings 1-5).
- Independent review: the specs-reviewer and test-auditor agents ran on this diff in the implementation session. The test-auditor first returned FAIL (no test pinned GET /api/products/:id, DoD 28); the fix was committed in e4ca8e7 (GET /:id tests and 500 body assertions), and both agents then returned PASS (82/82 tests). Their output is in the session export, not in this repo. Afterwards I adapted the agent files to this repo (SPEC.md contract, `git diff main...HEAD`, `npm test`) in a separate commit, so this review was written without re-running them.
- README was updated but not re-read for the empty-`category` case or the 400 on `1e9`-style input.
