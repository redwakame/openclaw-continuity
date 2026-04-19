# Publish Copy

Use this page as the source text for GitHub, ClawHub, npm, and release notes.

## Public product name

- `OpenClaw Continuity`

Technical package / slug:

- `personal-hooks`

## One-line summary

- EN: Structured continuity, time-aware care, and event follow-up for OpenClaw agents.
- 中文：為 OpenClaw 補上延續感、時間感、關心與追蹤的結構化技能包。

## What problem it solves

- EN:
  - OpenClaw agents often have chat ability, but not stable continuity.
  - `/new` carryover, staged topics, tracked follow-up, closure, cooldown,
    time-aware wording, and routine-aware writeback are usually fragile unless
    they are backed by explicit state.
  - Users also need a simple way to change care and follow-up behavior without
    editing config files by hand.
  - `OpenClaw Continuity` adds that state-backed middle layer without forcing a
    host-specific personality or transport stack.
- 中文：
  - 很多 OpenClaw agent 會聊天，但沒有穩定的延續感。
  - `/new` 接回、暫存話題、正式追蹤、退場、冷卻、時間感措辭與作息寫回，若沒有結構化狀態支撐，通常很容易漂掉。
  - 使用者也需要能用口語調整關心與追蹤節奏，而不是每次都去改設定檔。
  - `OpenClaw Continuity` 補上的就是這一層，不綁死人格，也不綁死單一平台。

## GitHub repository description

- EN: Time-aware continuity, carryover, care, and follow-up for OpenClaw agents.
- 中文：OpenClaw 的延續感、時間感、關心與追蹤技能包。

## Suggested GitHub topics

- `openclaw`
- `skill`
- `continuity`
- `follow-up`
- `carryover`
- `memory`
- `agent`
- `automation`
- `prompt-engineering`

## GitHub release title

- `OpenClaw Continuity 2.0.3`

## GitHub release notes

### English

#### What it is

`OpenClaw Continuity` is a host-neutral OpenClaw skill package that adds
structured continuity, staged memory, tracked follow-up, `/new` carryover,
closure, cooldown, time-aware wording, and frontstage-safe proactive behavior.

#### What it adds

- routes turns into `casual_chat`, `staged_memory`, or `tracked_followup`
- keeps `/new` carryover attached to the correct topic
- keeps follow-up lifecycle explicit with cooldown, closure, dispatch caps, and rest/sleep suppress
- keeps time sense grounded in elapsed time, day boundary, and routine phase
- lets users change follow-up behavior through natural requests instead of config-only control
- writes concise daily-memory traces from structured continuity state
- ships an optional bridge/addon layer without making the shared core host-specific

#### Why it matters

This package is for agents that should remember, care, and follow up without
turning ordinary conversation into noisy system chatter.

### 中文

#### 這是什麼

`OpenClaw Continuity` 是一個 host-neutral 的 OpenClaw 技能包，替 agent
補上結構化延續感、暫存記憶、正式追蹤、`/new` 接回、退場、冷卻、時間感措辭，
以及前台安全的主動關心／追蹤能力。

#### 它補了什麼

- 把使用者輸入分流成 `casual_chat`、`staged_memory`、`tracked_followup`
- 讓 `/new` 接回對準正確主題
- 讓關心與追蹤有明確 lifecycle：冷卻、退場、dispatch cap、作息抑制
- 讓時間感根據經過多久、是否跨日、是否跨睡眠邊界與作息階段來表達
- 讓使用者可以用口語調整作息、關心與追蹤節奏，而不是只靠設定檔
- 讓 daily memory 寫回來自結構化 continuity state，而不是模型亂猜
- 提供可選 bridge/addon，但 shared core 不綁死單一 host

#### 為什麼重要

這個技能適合那些需要「記得、關心、追蹤」但又不能把正常對話搞亂的 agent。

## ClawHub short description

- EN: Time-aware continuity and follow-up for OpenClaw agents with staged memory, `/new` carryover, tracked events, natural-language setting changes, and frontstage-safe writeback.
- 中文：提供時間感、暫存記憶、正式追蹤、`/new` 接回、口語改設定與前台安全寫回的 OpenClaw 延續技能。

## ClawHub longer description

- EN:
  - Use `OpenClaw Continuity` when an OpenClaw agent needs a reliable continuity layer between ordinary chat, staged memory, and tracked follow-up.
  - The package keeps carryover, closure, cooldown, sleep/rest suppress, time-aware wording, and daily-memory writeback explicit and state-backed, while keeping the shared core host-neutral.
  - It also lets users adjust follow-up behavior through ordinary language instead of rigid config edits.
- 中文：
  - 當 OpenClaw agent 需要在一般對話、暫存記憶與正式追蹤之間建立穩定延續層時，就適合用 `OpenClaw Continuity`。
  - 這個技能把 carryover、退場、冷卻、作息抑制、時間感措辭與 daily memory 寫回都做成明確、可檢查的狀態，而不是讓模型自己猜。
  - 同時也讓使用者能用一般口語調整設定，不需要卡在技術指令上。

## ClawHub recommended positioning

Use **English-first copy** on ClawHub, then put Chinese immediately below it.

Reason:

- ClawHub is not English-only.
- Published skills on ClawHub already contain Chinese and bilingual content.
- The search/discovery surface is still more likely to benefit from a strong English title and first paragraph.

Recommended structure:

1. English one-line value proposition
2. English feature bullets
3. Chinese summary
4. Chinese feature bullets
5. Contact and feedback line

## ClawHub full feature checklist

Do not omit these when preparing the final ClawHub listing or SKILL summary:

- time-aware continuity
- `/new` carryover
- `casual_chat / staged_memory / tracked_followup` routing
- tracked categories:
  - `parked_topic`
  - `watchful_state`
  - `delegated_task`
  - `sensitive_event`
- `candidate -> incident -> hook` promotion flow
- structured `event_chain`
- structured `causal_memory`
- cooldown
- closure
- dedupe
- dispatch cap
- sleep/rest suppress
- daily-memory writeback
- deterministic onboarding
- guided settings
- natural-language settings entry
- host-neutral shared core
- optional bridge/addon layer

## ClawHub long description draft

### English

`OpenClaw Continuity` adds a state-backed continuity layer to OpenClaw agents.

It is built for agents that need:

- detailed time sense based on elapsed time, day boundary, and sleep/wake phase
- `/new` carryover that reconnects the right pending topic
- explicit separation between ordinary chat, staged memory, and tracked follow-up
- tracked categories for parked topics, watchful states, delegated tasks, and sensitive events
- structured `candidate -> incident -> hook` promotion
- explicit closure, cooldown, dedupe, dispatch caps, and rest/sleep suppress
- concise daily-memory writeback from structured continuity state
- deterministic onboarding and guided settings updates
- natural-language settings changes instead of config-only control
- a host-neutral shared core with optional host bridge/addon integration

This skill is designed for agents that should remember, care, and follow up without letting internal state leak into frontstage chat.

Contact: `adarobot666@gmail.com`

If this skill helps and you want to keep updates and maintenance moving,
please star the GitHub repository.

### 中文

`OpenClaw Continuity` 是替 OpenClaw agent 補上結構化延續層的技能包。

它提供：

- 根據經過多久、是否跨日、是否跨睡眠/醒來邊界來表達的細時間感
- `/new` 之後能接回正確待續主題的 carryover
- 把一般對話、暫存記憶、正式追蹤明確分開
- 四種正式追蹤類型：
  - `parked_topic`
  - `watchful_state`
  - `delegated_task`
  - `sensitive_event`
- `candidate -> incident -> hook` 的結構化 promotion 流程
- 明確可檢查的 closure、cooldown、dedupe、dispatch cap 與作息抑制
- 來自 continuity state 的精簡 daily memory 寫回
- 決定性 onboarding 與 guided settings 更新
- 用自然口語改設定，而不是只靠設定檔
- host-neutral 的 shared core，搭配可選 bridge/addon

這個技能適合那些需要「記得、關心、追蹤」，但又不能把正常聊天搞亂的 agent。

聯絡與回饋：`adarobot666@gmail.com`

如果這個技能對你有幫助，而且你也期待它持續優化與維護，歡迎在 GitHub
給一顆星，這會是最直接的支持。

## npm package summary

- Package name: `@redwakame-skill/openclaw-continuity`
- EN: Host-neutral OpenClaw continuity skill with time-aware carryover, staged memory, tracked events, natural-language setting changes, and structured daily-memory writeback.
- 中文：host-neutral 的 OpenClaw 延續技能包，提供時間感、`/new` 接回、暫存記憶、正式追蹤、口語改設定與結構化記憶寫回。

## Contact

Questions, feedback, and implementation discussion:

- `adarobot666@gmail.com`
