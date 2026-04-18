---
name: personal-hooks
description: Structured continuity and follow-up skill for OpenClaw agents. Use when an agent needs to decide whether natural user dialogue should stay as casual chat, become staged memory, or become tracked follow-up with carryover, closure, sleep/rest suppress, traceability, and release-grade frontstage safety guards. This public V2 package covers parked topics, watchful states, delegated tasks, sensitive events, candidate→incident→hook flow, /new carryover, deterministic onboarding/guided settings, and time-aware continuity guards. It does not include always-on idle/social nudging as a default feature.
homepage: https://github.com/redwakame/openclaw-continuity
metadata: {"openclaw":{"os":["darwin","linux"],"requires":{"bins":["python3"]}}}
---

# OpenClaw Continuity

Use this skill as a continuity/follow-up layer on top of an existing OpenClaw agent. Keep the agent's soul/persona intact and let this skill own the structured follow-up mechanics.

Public product name: `OpenClaw Continuity`.
Technical package / slug: `personal-hooks`.
Internal diagnostics may still use `staged-followup-memory` as a status label for continuity state surfaces.

## V2 public scope

- Route turns into `casual_chat`, `staged_memory`, or `tracked_followup`.
- Classify tracked content into:
  - `parked_topic`
  - `watchful_state`
  - `delegated_task`
  - `sensitive_event`
- Maintain `event_chain` summaries with:
  - `context_before`
  - `event_core`
  - `immediate_result`
  - `followup_focus`
- Maintain `causal_memory` as structured continuity state with:
  - `facts`
  - `state`
  - `open_loop`
  - `time_anchor`
  - `followup_focus_code`
  - `writeback_policy`
- Promote `candidate -> incident -> hook`.
- Preserve `/new` carryover from the previous 3-5 turns.
- Keep hook closure, cooldown, dedupe, dispatch cap, and sleep/rest suppress observable.
- Write concise daily-memory traces for staged and tracked items.
- Apply first-run setup facts deterministically from explicit user text.
- Apply supported guided-settings changes deterministically before the model turn
  when the request is clear enough.

## Not in public scope

- Companionship rhythm / nudge as a default feature.
- User-configured idle chat frequency.
- Generic proactive chatting when no tracked continuity exists.
- Host transport/network reliability fixes.

## Trigger conditions

Use this skill when the user is naturally:

- parking a topic for later
- asking the agent to hold/remember/track something
- leaving a watchful emotional or physical state unresolved
- delegating a task for later follow-up
- describing a sensitive event that needs later continuity
- starting a new session that should reattach pending continuity
- asking whether the agent actually staged/tracked/closed something

## Core files

- Script: `scripts/personal_hooks.py`
- Harness: `scripts/followup_skill_harness.py`
- Optional web runner: `scripts/web_live_runner.mjs`
- Config schema: `config.schema.json`
- Sample config: `examples/settings.sample.json`
- Docs:
  - `README.md`
  - `docs/call-flow.md`
  - `docs/harness.md`
  - `docs/live-qa-runbook.md`
  - `docs/v2-blueprint.md`

## Runtime boundaries

- Keep V2 deterministic and state-backed.
- Let the skill/tool layer own staging, promotion, closure, and trace.
- Let frontstage consume structured results; do not rely on the model to invent continuity ad hoc.
- Treat `causal_memory` and `event_chain` as internal structured context, not prewritten frontstage reply text.
- Do not hardwire relationship-specific push wording into the public package; hosts and models should generate their own natural language from structured context.
- Treat rhythm/nudge as experimental and disabled by default.
- Keep language routing explicit. English prompt/guard text should stay English,
  and ordinary user phrases must not be rewritten into mixed-language internal
  artifacts.
- Do not hard-bind generic `UTC/GMT` offsets to a city timezone. Only explicit
  place references such as `Taipei` should resolve to `Asia/Taipei`; generic
  offsets must stay generic fixed offsets such as `UTC+08:00`.
- Prefer language from the current user turn and existing structured state over
  a host default. The public package ships first-party zh-TW / zh-CN / English
  behavior and broad guided-settings entry coverage for a few other common
  languages; it does not claim full prose localization for every language.

The public skill package does **not** automatically provide host-side delivery
plumbing. Keep these boundaries explicit:

- **TG bridge / outbound last-defense**
  - host-side outbound interception before the final channel send
- **gateway hook wiring**
  - host/runtime lifecycle integration for `preagent-sync`, `runtime-context`,
    and `frontstage-guard`
- **voice send addon**
  - optional TTS/media delivery integration
- **live heartbeat host glue**
  - host/runtime heartbeat configuration for safe background follow-up

These are optional host integrations, not part of the portable skill core.

## Entry points

- `build_runtime_context()`
  - Build ordinary-reply continuity context, carryover prompt, schedule context, and guard prompts.
- `intercept_message()`
  - Inspect one user turn and decide whether it should stay casual, become staged, or become tracked.
- `process_candidate_buffer()`
  - Promote staged candidates into incidents/hooks when the evidence is strong enough.
- `due` / `render` / `complete`
  - Drive the hook lifecycle.

Use `README.md` for installation and package usage. Use `docs/harness.md` for reproducible verification. Use `docs/release-acceptance.md` for the publication gate. Use `docs/live-qa-runbook.md` for human TG acceptance. Use `docs/v2-blueprint.md` only for future design discussion.

## Setup & Configuration

### First-time setup
If `SKILL_ONBOARD.md` exists in the workspace root, follow its guided setup flow. Once complete, delete the file.

### Modifying settings after setup
When the user asks to change their schedule, care frequency, quiet hours, or other preferences:

1. Run `setup-check` to see current state:
   ```bash
   python3 scripts/personal_hooks.py setup-check
   ```
2. Apply only the changed fields via `setup-apply`:
   ```bash
   python3 scripts/personal_hooks.py setup-apply --payload-json '{"sleep_time":"00:00","wake_time":"09:00"}'
   ```
   Only include the fields being changed — other fields remain untouched.

### Universal natural-language entry

The public package should support one host-agnostic natural-language entry into
guided settings mode. This is not platform-specific and should work across any
OpenClaw-supported conversation surface.

Recommended entry phrases:

- Traditional Chinese: `幫我調整關心設定`
- Simplified Chinese: `帮我调整关心设置`
- English: `Help me adjust my follow-up settings`
- Japanese: `フォローアップ設定を調整して`
- German: `Hilf mir, meine Follow-up-Einstellungen anzupassen`
- Italian: `Aiutami a regolare le impostazioni di follow-up`
- Spanish: `Ayúdame a ajustar mi configuración de seguimiento`

When the user says one of these or something equivalent:

1. enter guided settings mode
2. run `setup-check`
3. ask which category they want to adjust
4. apply only the changed fields via `setup-apply`

Do not require platform-specific slash commands.

The skill now also treats explicit command-like entries such as `/care setup`
and `/care config` as guided-settings triggers at the runtime-context layer, so
the setup mode can be re-opened consistently across different OpenClaw hosts.

For capability questions, hosts should also expose:

- `/care capability` / `/care 功能` / `/care 能力`
- `/care memory` / `/care 記憶` / `/care 记忆`

These are not separate memory engines. They are explanation entry points for:

- whether `/new` carryover is currently active
- whether the skill writes daily memory only for staged/tracked items
- whether the current conversation is ordinary chat, staged memory, or tracked follow-up

### Guided categories

Keep the guided categories simple and host-agnostic:

- `schedule` / `作息`
- `proactive` / `主動關心`
- `tracking` / `追蹤記憶`
- `tone` / `互動風格`

The user should be able to answer naturally rather than memorize technical keys.
The skill should map those answers into settings/profile changes.

### Deterministic onboarding apply

For first-install onboarding, the skill must not rely only on model-side
classification. When the user explicitly states structured setup facts in normal
conversation, the skill should deterministically extract and apply at least:

- timezone
- sleep_time
- wake_time
- relationship
- use_case

These values should be written into:

- `settings.json` (`routine_schedule`)
- `profile.json` (`care_style.relationship`)
- `USER.md`

This makes the setup contract cross-version safe even when model behavior is
conservative.

The skill also strips the common webchat timestamp prefix
`[Wed 2026-04-15 05:25 GMT+8]` before deterministic parsing so the same setup
text behaves consistently across CLI and web hosts.

### Trigger phrases (detect and act)
When the user says any of the following, run `setup-check` and offer to update:
- `幫我調整關心設定` / `帮我调整关心设置`
- `Help me adjust my follow-up settings`
- `フォローアップ設定を調整して`
- `Hilf mir, meine Follow-up-Einstellungen anzupassen`
- `Aiutami a regolare le impostazioni di follow-up`
- `Ayúdame a ajustar mi configuración de seguimiento`
- "改我的作息" / "修改作息" / "change my schedule"
- "改勿擾時間" / "quiet hours" / "do not disturb"
- "改關心頻率" / "多久關心一次" / "care interval"
- "改時區" / "change timezone"
- "我搬家了" / "我換工作了" (may affect timezone/schedule)

For English natural-language settings requests, the shared skill should also
handle common phrasings such as:

- `turn proactive check-ins on / off`
- `checking in every 2 hours`
- `retrying after 30 minutes`
- `stopping after 2 unanswered check-ins`

### Available fields
| Key | Target | What it configures |
|-----|--------|-------------------|
| timezone | settings | Time calculations |
| sleep_time | settings | Sleep phase start |
| wake_time | settings | Sleep phase end |
| relationship | profile | Tone & interaction style |
| use_case | profile | support / developer / tracking |
| proactive_care | settings | Enable proactive messages |
| proactive_interval_hours | settings | Minimum re-evaluation interval (hours); actual dispatch depends on guard conditions |
| quiet_hours_start | settings | Do-not-disturb start |
| quiet_hours_end | settings | Do-not-disturb end |
| care_tone | profile | warm / neutral / playful |
| emoji_forbidden | profile | Banned emoji list |
| tracking_keywords | profile | Topics to track |
| heartbeat_enabled | settings | Enable heartbeat |

### New-session continuity constraints

- Guided-settings or operator-feedback text must not become the main `/new`
  continuity anchor.
- A bare `hi` immediately after `/new` should be treated as a low-information
  acknowledgement of the selected continuity opener, not as a fresh time-of-day
  small-talk reset.
- Time-state is a tone modifier, not a replacement for the selected continuity
  anchor.
- `/new` capability is part of the public V2 package. If asked directly, the
  skill should answer concretely that it preserves carryover from the previous
  3–5 turns and tries to reattach the most relevant unresolved thread.
- daily memory writeback is also part of the public V2 package, but it is not
  "write every line". Ordinary chat can stay casual-only; staged/tracked items
  write a daily memory trace.

### Policy surface (advanced — via settings.json)
| Key path | Default | What it controls |
|----------|---------|-----------------|
| re_engagement.mode | wait_for_reply | After dispatch without reply: wait or timed retry |
| re_engagement.retry_after_hours | 4 | Hours before retrying a parked hook (timed_retry mode only) |
| re_engagement.max_unanswered_before_park | 2 | Dispatches without reply before parking |
| candidate_ttl_hours.emotion | 24 | Candidate buffer TTL for emotion signals (hours) |
| candidate_ttl_hours.task | 168 | Candidate buffer TTL for task signals (hours) |
| temporal_guard.newer_interaction_minutes | 5 | User interaction recency threshold for blocking dispatch |
| followup.parked_auto_close_hours | 0 | Auto-close parked hooks after N hours (0=disabled) |
| sleep_rest_suppress.auto_clear_hours | 4 | Auto-clear rest-suppress fallback (0=only on resume) |
| causal_memory.summary_max_facts | 3 | Maximum factual clauses preserved in internal causal summaries |
| causal_memory.include_time_anchor | true | Include extracted temporal anchors in internal causal summaries |
| causal_memory.include_state_marker | true | Include neutral state markers in internal causal summaries |
