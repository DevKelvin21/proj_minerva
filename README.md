# Evidence: Ask AI from comment threads + conversation history (PR feat/ask-ai-threads)

- `walkthrough-ask-ai-history.png`: Playwright on 2d13c5d, `npm run build && npx playwright test e2e/walkthrough-focus.spec.ts` ("Ask AI on a line" test: two exchanges kept in the card, line 18's sparkle lit). Mock universe, `MINERVA_MOCK_AI=1` answers.
- `walkthrough-ask-ai-thread.png`: same run ("Ask AI from a comment thread" test: the quick question asked from the thread on coupon-service.ts:16, the answer confirming the 2-comment thread reached the AI, "Use as reply").

This branch is deleted when the PR closes.
