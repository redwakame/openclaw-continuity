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
  - They also need to be able to say what they want directly in chat, instead
    of memorizing backend-only commands.
  - `OpenClaw Continuity` adds that state-backed middle layer without forcing a
    host-specific personality or transport stack.
- 中文：
  - 很多 OpenClaw agent 會聊天，但沒有穩定的延續感。
  - `/new` 接回、暫存話題、正式追蹤、退場、冷卻、時間感措辭與作息寫回，若沒有結構化狀態支撐，通常很容易漂掉。
  - 使用者也需要能用口語調整關心與追蹤節奏，而不是每次都去改設定檔。
  - 使用者也需要能直接在對話裡說「幫我調整一下」，而不是被迫記一堆後台指令。
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

- `OpenClaw Continuity 2.0.12`

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
- fixes routine-aware sleep handoff for night-owl schedules: when a user goes to
  sleep near `sleep_time` and `wake_time` is still later on the same local day,
  the runtime nudges the model toward a same-day “after you wake” handoff rather
  than a generic next-day goodbye

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
- 修復晚睡型作息的睡前交接：當使用者接近 `sleep_time` 說要睡，而
  `wake_time` 仍在同一本地日期稍晚時，runtime 會引導成「下午見／起床後再接」，
  不再讓模型套用泛用的隔天道別

#### 為什麼重要

這個技能適合那些需要「記得、關心、追蹤」但又不能把正常對話搞亂的 agent。

## ClawHub short description

- EN: Make OpenClaw remember the right thing, reconnect the right topic after `/new`, and follow up naturally without leaking internal continuity logic into chat.
- 中文：讓 OpenClaw 記住對的事、在 `/new` 後接回正確主題，能自然追蹤，也能直接用口語調整功能與節奏，而不把內部 continuity 邏輯漏到前台對話。

## ClawHub longer description

- EN:
  - Use `OpenClaw Continuity` when an OpenClaw agent should remember the right thing, follow up on the right topic, and keep `/new` continuity attached to the correct thread instead of collapsing into generic small talk.
  - The package gives agents a state-backed continuity layer across ordinary chat, staged memory, and tracked follow-up, with explicit closure, cooldown, sleep/rest suppress, dispatch caps, and daily-memory writeback.
  - It also lets users adjust follow-up behavior through ordinary language instead of rigid config edits, while keeping the shared core host-neutral.
- 中文：
  - 當 OpenClaw agent 需要記住對的事、追對的主題、並在 `/new` 之後接回正確脈絡，而不是掉回空泛閒聊時，就適合用 `OpenClaw Continuity`。
  - 這個技能把一般對話、暫存記憶、正式追蹤之間的延續層做成 state-backed 結構，讓 closure、cooldown、作息抑制、dispatch cap、時間感措辭與 daily memory 寫回都可檢查、可驗證。
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

It is for agents that should feel coherent after an interruption, a `/new` turn, or a delayed follow-up — without turning normal chat into noisy system chatter.

It is not just a cron-style message sender. The point is not “send something later.”
The point is to reconnect the right topic, decide whether follow-up is actually
appropriate, and respect routine, quiet hours, sleep/rest suppress, closure,
cooldown, and dispatch caps before anything reaches frontstage chat.

What users get immediately:

- `/new` reconnects the right pending topic instead of collapsing into generic small talk
- “let's talk about it later” can stay staged instead of being forgotten
- follow-up stays explicit with closure, cooldown, dedupe, dispatch caps, and sleep/rest suppress
- time-aware wording uses elapsed time, cross-midnight context, and sleep/wake boundaries instead of vague guessing
- settings can be changed through ordinary language instead of config-only control
- users can ask for quieter nights, slower follow-up, or different care behavior directly in chat
- daily-memory writeback comes from structured continuity state, not model improvisation
- routine-aware sleep handoff respects night-owl sleep/wake boundaries, including same-day afternoon wake-up after early-morning sleep

Install placement:

```text
openclaw-workspace/
  skills/
    personal-hooks/
      SKILL.md
      scripts/
      docs/
      examples/
```

After copying or linking the folder, initialize with:

```bash
python3 openclaw-workspace/skills/personal-hooks/scripts/personal_hooks.py init
```

Different follow-up paths stay different on purpose:

- ordinary chat stays ordinary chat
- something to revisit later can stay staged
- something that truly matters can become tracked follow-up
- routine-aware care can be suppressed or delayed when the user is resting
- quiet-hours and do-not-disturb style behavior are part of the feature set, not an afterthought

What the engine provides under the hood:

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

它適合那些在對話中斷、`/new` 重開、或延後追蹤之後，仍然需要保持前後一致的 agent，而且不能把正常聊天搞成系統訊息噪音。

它不是單純排一個 cron 然後晚點推一句訊息出去。重點不是「之後發一則」，而是：
要不要追、該追哪個主題、現在是不是打擾、是否該進入勿擾/休息抑制、是否已經該退場或冷卻，
都要先根據上下文與因果狀態判斷，再決定前台要不要出現內容。

使用者最直接感受到的是：

- `/new` 之後能接回正確待續主題，而不是掉回空泛寒暄
- 「晚點再聊」可以被穩定暫存，而不是直接遺失
- 關心與追蹤有 closure、cooldown、dedupe、dispatch cap 與作息抑制，不會亂追
- 時間感會看經過多久、是否跨日、是否跨睡眠/醒來邊界，而不是模糊猜測
- 可以用自然口語調整設定，而不是只靠改 config
- 可以直接在對話裡說「幫我調整功能」或「半夜少提醒一點」，不用先背技術指令
- daily memory 寫回來自結構化 continuity state，不靠模型亂編
- 晚睡型作息的睡前交接會尊重睡眠/醒來邊界，例如凌晨睡、同日下午起床時，
  會引導成下午或起床後再接，而不是泛用地說明天見

不同路徑會明確分開，而不是混成一種「晚點提醒」：

- 一般聊天就是一般聊天
- 晚點再聊的事可以先暫存
- 真正重要的事才進正式追蹤
- 作息、勿擾、睡眠/休息抑制本身就是功能，不是附帶條件
- 關心不是亂發，而是根據上下文與因果記憶決定是否該出現

底層能力則包括：

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

放置位置：

```text
openclaw-workspace/
  skills/
    personal-hooks/
      SKILL.md
      scripts/
      docs/
      examples/
```

放好後可先初始化：

```bash
python3 openclaw-workspace/skills/personal-hooks/scripts/personal_hooks.py init
```

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
