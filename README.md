# Visual evidence: the boards stack (#30–#36)

One folder per board. Screenshots come from the Playwright suite (mock SCM +
mock AI, isolated userData) run on each board's branch before it was stacked,
on top of main 650338c. The stacked commits carry the same content.

The whole stack was verified at its top (`feat/board-settings`): `npm run verify`
(1,614 unit tests) and `npm run test:e2e` (102 passed, 1 skipped).
