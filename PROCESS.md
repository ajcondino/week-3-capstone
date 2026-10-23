# PROCESS: pagination for GET /api/products

Stack: OrderFlow (Node/Express/Jest). Feature: `limit`/`offset` pagination with `total` on `GET /api/products`.
Shape: one main agent for the work, plus the two standing reviewers (`specs-reviewer`, `test-auditor`) run in parallel.

## Prompts that mattered

1. **Explore first, in plan mode ("cite file:line", "what should I NOT touch").** It found the orders route's `parseInt(x) || 50` problems, the SQL injection in `search.js:27`, and that `Product.findAll` has exactly one caller. That kept the diff small and gave the SPEC its decisions.
2. **SPEC with my rulings ("mark anything I might disagree with").** I decided the main decisions (default 20, max 100, clamp, 400 on bad input, `ORDER BY name, id`). Claude listed its own smaller choices as "may disagree", and I turned three of them into Definition-of-Done items before writing tests (MAX_SAFE_INTEGER, `limit=010`, nested params).
3. **Tests first: "for EVERY failing test, say why; if one fails for the wrong reason, fix the test, not src/".** 35 of 36 new tests failed on assertions and the 44 old tests stayed green. Claude flagged the one new test that already passed ("500 when findAll rejects") and said not to count it.
4. **"Fix ONLY these two findings… do not change existing assertions… re-run both agents."** It kept the fix narrow and produced the FAIL → fix → PASS sequence.

## What Claude got wrong

- **The test-auditor found a real gap in the tests Claude wrote.** Nothing pinned `GET /api/products/:id`, although the SPEC promises it is unchanged (DoD 28). I had the fix made in `e4ca8e7` (200 and 404 tests, plus `res.body.error` assertions on both 500 tests).
- **The specs-reviewer made a wrong claim.** It said the project's tests reset mocks in `beforeEach`; `tests/middleware/auth.test.js:35` uses `afterEach(jest.clearAllMocks)`, which is the style I told Claude to follow. I did not change the tests for it.
- **The reviewer repeated the main agent's brief instead of the repo.** It said "SPEC.md says `.env.example` is a pre-existing problem"; SPEC.md says no such thing. Briefing a reviewer with your own context contaminates its verdict.
- **My standing reviewers were not adapted to this repo.** The Day 3 agents were hard-coded to `PLAN.md`, so the main agent had to tell them to use `SPEC.md` (Prompt 7). I adapted the agent files in a later commit.
- **Weaker evidence than it looked.** In the second round the auditor "reasoned through" its mutation checks instead of running them, and the specs-reviewer said it ran `npm test` although its tools were read-only. I treated the main agent's own 82/82 run as the real evidence.
- **I overstated my own review.** I wrote "the fix commit only added tests"; Claude checked and corrected me: it also rewrote one header comment (30 insertions, 2 deletions, no assertion removed).

## Single agent vs orchestra

I used a single main agent for the work and a parallel pair only for review. I think that was the right call. The feature touches one model, one route and two test files, so a fan-out would have cost more coordination than it saved, and the implementation passed 80/80 on the first run. The parallel reviewers did earn their keep, because the auditor found the missing `GET /:id` test. If I did it again I would adapt the reviewer agents before the first review run, not after.

## What changed from the SPEC

- Three extra Definition-of-Done items were added before the tests (MAX_SAFE_INTEGER, `limit=010`, nested `limit[a]`). The SPEC's numbering shifted, and my test prompt still said "DoD 19-22" for the model tests; Claude noticed and used 23-26.
- Claude used a factory mock for `Product` instead of the automock I asked for, because an automock has no `count` yet. It told me why up front.
- The fix commit added tests and two `"db down"` assertions to the existing 500 tests; no test was weakened.

## Left out on purpose

`search.js` SQL injection, the orders parsing bugs, the missing rate limit and index. All noted in REVIEW.md.
