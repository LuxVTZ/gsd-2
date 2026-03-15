# Plan: Telegram Bot Integration for GSD

**Generated**: 2026-03-15
**Estimated Complexity**: High

## Overview

Add full Telegram bot integration to GSD so the user can remotely:
- Send tasks/messages to the agent
- See real-time progress (tool calls, token usage, errors)
- Approve/reject actions via inline keyboard buttons
- Receive completion notifications with summaries
- Use slash commands (/status, /stop, /approve, /tasks)

**Approach**: Two-layer integration:
1. **TelegramAdapter** — plug into existing `remote-questions` system (for ask_user_questions flow)
2. **telegram extension** — full standalone extension for proactive notifications, command handling, progress streaming, and inline buttons

**Library**: grammy (TypeScript-first, lightweight, actively maintained)
**Auth**: `GSD_TELEGRAM_TOKEN` + `GSD_TELEGRAM_OWNER_ID` env vars
**Security**: Only `OWNER_ID` can interact; all other users ignored

## Prerequisites
- Telegram Bot created via @BotFather (user provides token)
- User's Telegram numeric ID (get via @userinfobot or similar)
- `grammy` npm package

---

## Sprint 1: Core Telegram Client & Remote Questions Adapter

**Goal**: Grammy bot starts with GSD, Telegram adapter works in remote-questions system, basic bidirectional messaging.

**Demo/Validation**:
- Set GSD_TELEGRAM_TOKEN + GSD_TELEGRAM_OWNER_ID
- Run GSD → bot sends "🟢 GSD session started" to owner
- When ask_user_questions fires with no UI → question appears in Telegram with buttons
- Reply in Telegram → GSD receives answer and continues

### Task 1.1: Install grammy dependency
- **Location**: `package.json`
- **Description**: `npm install grammy`
- **Dependencies**: None
- **Acceptance Criteria**: grammy in dependencies, types available
- **Validation**: `import { Bot } from "grammy"` compiles

### Task 1.2: Create Telegram bot client wrapper
- **Location**: `src/resources/extensions/telegram/bot-client.ts`
- **Description**: 
  - Create `TelegramBotClient` class wrapping grammy Bot
  - Constructor takes token + ownerId
  - `start()` / `stop()` lifecycle methods
  - `sendMessage(text, opts?)` — send to owner with Markdown parse mode
  - `sendButtons(text, buttons: InlineButton[][])` — send inline keyboard
  - `onMessage(handler)` — register text message handler (owner-only filter)
  - `onCallback(handler)` — register callback query handler (owner-only filter)
  - Owner-only middleware: ignore all messages from non-owner users
  - Graceful error handling (network failures don't crash GSD)
- **Dependencies**: Task 1.1
- **Acceptance Criteria**: 
  - Bot connects to Telegram API
  - Only responds to owner
  - Handles network errors gracefully
- **Validation**: Unit tests with mocked grammy Bot

### Task 1.3: Create Telegram adapter for remote-questions
- **Location**: `src/resources/extensions/remote-questions/telegram-adapter.ts`
- **Description**:
  - Implement `ChannelAdapter` interface (same as SlackAdapter/DiscordAdapter)
  - `validate()` — call getMe() to verify token
  - `sendPrompt(prompt)` — format questions with inline buttons, send to owner
  - `pollAnswer(prompt, ref)` — check for callback query responses
  - Use grammy's `bot.api` for sending, long-polling for receiving
  - Format questions: header + question text + option buttons (InlineKeyboardButton)
  - For multiple-choice: toggle buttons, "Done" confirm button
  - Store pending callback answers in memory map
- **Dependencies**: Task 1.2
- **Acceptance Criteria**: Implements ChannelAdapter fully
- **Validation**: Unit tests mocking Telegram API responses

### Task 1.4: Register Telegram in remote-questions config
- **Location**: 
  - `src/resources/extensions/remote-questions/types.ts` — add "telegram" to RemoteChannel
  - `src/resources/extensions/remote-questions/config.ts` — add TELEGRAM_BOT_TOKEN env key, chat ID pattern
  - `src/resources/extensions/remote-questions/manager.ts` — add TelegramAdapter to createAdapter()
  - `src/resources/extensions/remote-questions/format.ts` — add formatForTelegram()
- **Description**: Wire TelegramAdapter into the existing remote-questions pipeline
- **Dependencies**: Task 1.3
- **Acceptance Criteria**: 
  - `resolveRemoteConfig()` returns telegram config when GSD_TELEGRAM_TOKEN is set
  - `createAdapter()` creates TelegramAdapter for channel "telegram"
  - Channel ID validation: numeric Telegram chat IDs
- **Validation**: Existing remote-questions tests still pass + new telegram config tests

### Task 1.5: Tests for Sprint 1
- **Location**: `src/tests/telegram-bot.test.ts`
- **Description**:
  - Test TelegramBotClient owner-only filtering
  - Test TelegramAdapter.validate/sendPrompt/pollAnswer with mocked API
  - Test config resolution with GSD_TELEGRAM_TOKEN env
  - Test formatForTelegram output
  - Test graceful error on invalid token
- **Dependencies**: Tasks 1.2-1.4
- **Acceptance Criteria**: ≥12 tests, all pass
- **Validation**: `npm test`

---

## Sprint 2: Full Extension — Notifications & Progress

**Goal**: GSD proactively sends session events, progress updates, and tool execution info to Telegram.

**Demo/Validation**:
- Start GSD with Telegram configured → "🟢 Session started" message
- Agent processes a task → progress messages appear in Telegram
- Tool calls show as "🔧 Running: bash `npm test`"
- Agent completes → "✅ Task complete" with summary
- Error → "❌ Error: ..." notification

### Task 2.1: Create telegram extension skeleton
- **Location**: `src/resources/extensions/telegram/index.ts`
- **Description**:
  - Export default extension factory
  - On load: check GSD_TELEGRAM_TOKEN + GSD_TELEGRAM_OWNER_ID env vars
  - If not set: silently skip (no error, extension just doesn't activate)
  - If set: initialize TelegramBotClient, start long-polling
  - Register `/telegram` slash command (status/disconnect)
  - Clean shutdown on `session_shutdown` event
- **Dependencies**: Sprint 1
- **Acceptance Criteria**: Extension auto-discovers, starts bot if configured
- **Validation**: GSD starts without errors with/without env vars

### Task 2.2: Session lifecycle notifications
- **Location**: `src/resources/extensions/telegram/index.ts`
- **Description**:
  - `session_start` → "🟢 GSD session started\n📂 {workdir}\n🤖 {model}"
  - `session_shutdown` → "🔴 GSD session ended"
  - `session_compact` → "📦 Context compacted ({percent}% used)"
  - `session_switch` → "🔀 Switched session"
  - `agent_start` → "🧠 Agent thinking..."
  - `agent_end` → "✅ Agent finished" or "❌ Agent error: {reason}"
- **Dependencies**: Task 2.1
- **Acceptance Criteria**: All lifecycle events produce Telegram messages
- **Validation**: Manual test + mock event tests

### Task 2.3: Tool execution notifications
- **Location**: `src/resources/extensions/telegram/notifications.ts`
- **Description**:
  - `tool_execution_start` → "🔧 {toolName}: {brief params}"
  - `tool_execution_end` → "✓ {toolName} done" (or "✗ {toolName} failed")
  - Debounce: batch rapid tool calls into single message (500ms window)
  - Truncate long params (max 200 chars per tool)
  - Skip noisy tools (read_file on small files) — configurable filter
  - Format for Telegram Markdown: escape special chars
- **Dependencies**: Task 2.1
- **Acceptance Criteria**: Tool calls appear in Telegram with readable format
- **Validation**: Unit tests for formatting + debouncing

### Task 2.4: Message streaming (agent output summary)
- **Location**: `src/resources/extensions/telegram/notifications.ts`
- **Description**:
  - `message_end` → send last N chars of agent response as summary
  - Truncate to 4096 chars (Telegram limit)
  - Split long messages into multiple if needed
  - Include token usage if available from turn_end
  - Format code blocks with ``` for readability
- **Dependencies**: Task 2.1
- **Acceptance Criteria**: Agent responses summarized in Telegram
- **Validation**: Unit tests for truncation and formatting

### Task 2.5: Tests for Sprint 2
- **Location**: `src/tests/telegram-extension.test.ts`
- **Description**:
  - Test extension activation with/without env vars
  - Test notification formatting (escaping, truncation)
  - Test debouncing of tool notifications
  - Test message splitting for long content
  - Test lifecycle event → message mapping
- **Dependencies**: Tasks 2.1-2.4
- **Acceptance Criteria**: ≥15 tests, all pass
- **Validation**: `npm test`

---

## Sprint 3: Remote Commands & Inline Buttons

**Goal**: User can send commands from Telegram, approve/reject actions with buttons.

**Demo/Validation**:
- Send "/status" in Telegram → get agent status, model, context usage
- Send "/stop" → agent aborts current operation
- When GSD asks a question → Telegram shows inline buttons → user taps → GSD continues
- Send free text → injected as user message into GSD session

### Task 3.1: Telegram command router
- **Location**: `src/resources/extensions/telegram/commands.ts`
- **Description**:
  - Parse incoming messages for commands:
    - `/status` — session name, model, context %, idle/busy, active tools
    - `/stop` — abort current agent operation (ctx.abort())
    - `/compact` — trigger context compaction
    - `/model <name>` — switch model
    - `/tools` — list active tools
    - `/help` — list available commands
  - Free text (no /) → inject as user message via `pi.sendUserMessage(text)`
  - Command responses sent back as Telegram messages
- **Dependencies**: Sprint 2
- **Acceptance Criteria**: All commands work, free text forwarded to agent
- **Validation**: Unit tests for command parsing + response generation

### Task 3.2: Inline keyboard for confirmations
- **Location**: `src/resources/extensions/telegram/inline-actions.ts`
- **Description**:
  - When `tool_call` event fires for sensitive tools → send confirmation to Telegram
  - Inline buttons: [✅ Approve] [❌ Reject] [📋 Details]
  - "Details" button shows full command/params
  - Track pending confirmations with timeout (configurable, default 5min)
  - If user doesn't respond within timeout → auto-reject with notification
  - Callback data format: `approve:{id}`, `reject:{id}`, `details:{id}`
  - Use `pi.on("tool_call", ...)` to intercept and return `{ block: true }` until confirmed
- **Dependencies**: Task 3.1
- **Acceptance Criteria**: Sensitive tool calls require Telegram approval
- **Validation**: Unit tests for approval flow + timeout

### Task 3.3: Configurable sensitivity levels
- **Location**: `src/resources/extensions/telegram/config.ts`
- **Description**:
  - `GSD_TELEGRAM_APPROVE` env var or preferences:
    - `"all"` — approve every tool call (paranoid mode)
    - `"destructive"` (default) — approve: bash write, file deletes, git push
    - `"none"` — no approval needed, only notifications
  - List of tools requiring approval per level
  - User can change via `/approve <level>` Telegram command
- **Dependencies**: Task 3.2
- **Acceptance Criteria**: Three approval levels work correctly
- **Validation**: Unit tests for level filtering

### Task 3.4: Tests for Sprint 3
- **Location**: `src/tests/telegram-commands.test.ts`
- **Description**:
  - Test command routing (/status, /stop, /help, etc.)
  - Test free text → sendUserMessage injection
  - Test inline button creation and callback handling
  - Test approval timeout behavior
  - Test sensitivity level filtering
  - Test concurrent pending approvals
- **Dependencies**: Tasks 3.1-3.3
- **Acceptance Criteria**: ≥18 tests, all pass
- **Validation**: `npm test`

---

## Sprint 4: Polish & Robustness

**Goal**: Production-quality error handling, reconnection, rate limiting, and UX polish.

**Demo/Validation**:
- Network drops → bot reconnects automatically
- Rapid events → batched into single Telegram message
- Bot doesn't exceed Telegram rate limits
- Rich message formatting with status emojis

### Task 4.1: Reconnection & error resilience
- **Location**: `src/resources/extensions/telegram/bot-client.ts`
- **Description**:
  - Auto-reconnect on polling failure (exponential backoff, max 60s)
  - Log reconnection attempts via logger
  - Queue messages during disconnect, flush on reconnect (max 10 queued)
  - Don't crash GSD on Telegram failures — catch all, log, continue
  - Handle 429 Too Many Requests from Telegram API
- **Dependencies**: Sprint 3
- **Acceptance Criteria**: Bot survives network issues
- **Validation**: Tests simulating disconnect/reconnect

### Task 4.2: Rate limiting & message batching
- **Location**: `src/resources/extensions/telegram/rate-limiter.ts`
- **Description**:
  - Telegram limit: 30 messages/second to same chat
  - Implement token bucket rate limiter (20 msg/s with burst)
  - Batch rapid notifications into single message (1s window)
  - Priority queue: commands > approvals > progress > notifications
  - Edit existing message instead of sending new for progress updates
  - Use `bot.api.editMessageText()` for live progress updates
- **Dependencies**: Task 4.1
- **Acceptance Criteria**: No 429 errors under heavy load
- **Validation**: Stress tests + unit tests

### Task 4.3: Rich message formatting
- **Location**: `src/resources/extensions/telegram/formatter.ts`
- **Description**:
  - Telegram MarkdownV2 escaping (special chars: `_*[]()~>#+-=|{}.!`)
  - Code block formatting for tool outputs
  - Progress bar: `[████░░░░░░] 42%`
  - Status cards with emojis
  - Collapsible details (spoiler tags) for long outputs
  - File diff formatting (highlight additions/removals)
- **Dependencies**: Sprint 2
- **Acceptance Criteria**: Messages render correctly in Telegram
- **Validation**: Unit tests for each format function

### Task 4.4: /telegram setup command in GSD
- **Location**: `src/resources/extensions/remote-questions/remote-command.ts`
- **Description**:
  - Add `handleSetupTelegram(ctx)` — similar to handleSetupSlack
  - Prompt for bot token (masked input)
  - Validate via getMe API call
  - Prompt for owner chat ID (or auto-detect from first /start message)
  - Save to preferences + env
  - Send test message to confirm
- **Dependencies**: Sprint 1
- **Acceptance Criteria**: `/gsd remote telegram` sets up the bot interactively
- **Validation**: Manual test flow

### Task 4.5: Final tests & integration
- **Location**: `src/tests/telegram-integration.test.ts`
- **Description**:
  - Test reconnection with mocked failures
  - Test rate limiter under burst
  - Test message batching
  - Test MarkdownV2 escaping edge cases
  - Test progress bar rendering
  - Test /telegram setup flow
  - End-to-end: mock full session lifecycle → verify Telegram messages
- **Dependencies**: Tasks 4.1-4.4
- **Acceptance Criteria**: ≥20 tests, all pass
- **Validation**: `npm test`

---

## Testing Strategy
- **Unit tests**: Each sprint has dedicated test file
- **Mocking**: All Telegram API calls mocked (no real bot needed for tests)
- **Grammy mocking**: Create `MockBot` class that records sent messages
- **Integration**: Verify full event→notification flow with mocked extension context
- **Total target**: ≥65 new tests across 4 files

## File Structure
```
src/resources/extensions/telegram/
├── index.ts              # Extension entry point
├── bot-client.ts         # Grammy wrapper + lifecycle
├── commands.ts           # Command router (/status, /stop, etc.)
├── notifications.ts      # Event→message mapping + debouncing
├── inline-actions.ts     # Approval flow + inline keyboards
├── config.ts             # Env vars, sensitivity levels
├── rate-limiter.ts       # Token bucket + message batching
└── formatter.ts          # MarkdownV2 formatting utilities

src/resources/extensions/remote-questions/
├── telegram-adapter.ts   # ChannelAdapter for remote-questions system
├── types.ts              # + "telegram" to RemoteChannel union
├── config.ts             # + TELEGRAM env key + chat ID pattern
├── manager.ts            # + TelegramAdapter in createAdapter()
└── remote-command.ts     # + handleSetupTelegram()

src/tests/
├── telegram-bot.test.ts        # Sprint 1: client + adapter
├── telegram-extension.test.ts  # Sprint 2: notifications
├── telegram-commands.test.ts   # Sprint 3: commands + approvals
└── telegram-integration.test.ts # Sprint 4: resilience + polish
```

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `GSD_TELEGRAM_TOKEN` | Yes | Bot token from @BotFather |
| `GSD_TELEGRAM_OWNER_ID` | Yes | Numeric Telegram user ID |
| `GSD_TELEGRAM_APPROVE` | No | Approval level: all/destructive/none (default: destructive) |

## Potential Risks & Gotchas
- **Grammy long-polling vs GSD event loop**: Grammy's `bot.start()` runs its own polling loop. Must not block GSD's main thread. Use `bot.start()` without await (fire-and-forget with error handler).
- **Message length**: Telegram max is 4096 chars. Must split or truncate.
- **MarkdownV2 escaping**: Very finicky — must escape `_*[]()~>#+\-=|{}.!` outside of code blocks. Easy to break formatting.
- **Rate limits**: Telegram allows ~30 msg/s per chat. Rapid tool calls could hit this.
- **Token security**: Bot token must never appear in logs, error messages, or LLM context. Use sanitizeError pattern from remote-questions.
- **Graceful degradation**: If Telegram is unreachable, GSD must continue working normally. Extension is purely additive.
- **Import extensions**: Non-test .ts files must use `.js` in imports (NodeNext resolution).

## Rollback Plan
- Remove `src/resources/extensions/telegram/` directory
- Revert changes to remote-questions files (types.ts, config.ts, manager.ts, remote-command.ts)
- Remove grammy from package.json
- Extension auto-discovery means no other files need changes
