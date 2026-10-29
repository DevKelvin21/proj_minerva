# Evidence: fix/trans-untrusted-values

Screenshots from the Playwright suite on commit 7fd9e8b (branch `fix/trans-untrusted-values`):

    npm run build && npx playwright test e2e/stacks.spec.ts e2e/home-dashboard.spec.ts e2e/provider-aware.spec.ts

- `e2e/pr-detail-stack-map.png`: "Built on top of #101 (<branch/>)" in the stack map
- `e2e/retarget-preview.png`: the retarget consequence with `<branch/>`
- `e2e/retarget-done-stacks.png`: the retarget note with `<base/>` / `<previous/>`

Delete this branch when the PR closes.
