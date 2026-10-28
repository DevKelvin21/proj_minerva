# Evidence: side-panel AI chat (feat/ai-panel-chat)

Screenshots captured by the Playwright suite (`e2e/ai-chat.spec.ts`) against
commit e7dc02a, with `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`:

    npm run build && npx playwright test e2e/ai-chat.spec.ts

- `chat-chips.png`: two lines and a thread stacked as chips in the composer.
- `chat-answer.png`: the sent question with its chips and the streamed answer.
- `chat-switch.png`: the conversation switcher with several conversations.
- `chat-narrow.png`: the narrow (`sm`) tier, where the panel is an overlay.

Delete this branch when the PR closes.
