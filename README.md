# Visual evidence: the shared-pieces stack (#24–#29)

One folder per PR. Screenshots come from the Playwright suite (mock SCM + mock
AI) run on each branch before it was stacked (`npm run build`, then the specs
named in each PR), with the same content as the stacked commits:

| Folder | Branch | Stacked commit |
| --- | --- | --- |
| states | feat/ui-states | 9866c5a |
| callout-chip | feat/ui-callout-chip | 7f04ba7 |
| forms | feat/ui-forms | 08b1198 |
| cards | feat/ui-cards | fd49758 |
| dialogs | feat/ui-dialogs | 7c32a7c |
| buttons | feat/ui-buttons | 5bcdf1b |

The whole stack was verified at 5bcdf1b: `npm run verify` and `npm run test:e2e`
(96 passed, 2 skipped).

Delete this branch when the last PR of the stack closes.
