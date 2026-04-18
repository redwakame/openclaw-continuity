# Release Acceptance

This document defines the publication gate for the public V2 package.

Pass this matrix before publishing to GitHub release ZIP, ClawHub-style catalog, npm tarball, or any mirrored package feed.

## Scope

This matrix validates the **public package**:

- shared skill
- optional public bridge addon
- package docs / install flow

It does **not** require mutating any live host memory or production session history.

## Test boundaries

- Prefer sandbox / harness runs first.
- Use host smoke checks only after sandbox passes.
- Do not use 60-second live heartbeat or short continuous polling on production hosts.
- Do not leave test carryover or test memory in a live user workspace.

## Required matrix

### 1. Language neutrality

Run at least:

- zh-TW onboarding + zh-TW follow-up flow
- English onboarding + English follow-up flow

Pass if:

- the package follows the current user language naturally
- locale is not forced to English when the host does not provide a locale
- internal prompt fragments do not leak into frontstage text
- ordinary user phrases are not rewritten into mixed-language artifacts

### 2. Timezone / offset neutrality

Run at least:

- explicit IANA timezone: `America/New_York`
- generic offset: `UTC+8` or `GMT+8`

Pass if:

- explicit IANA timezone is preserved as given
- generic offset is stored as a generic fixed offset such as `UTC+08:00`
- generic offsets are not silently converted into a city timezone
- explicit place references such as `Taipei` may still map to `Asia/Taipei`

### 3. Deterministic onboarding writeback

Run at least one onboarding case per primary language path.

Pass if these fields are written without relying on model-only classification:

- `timezone`
- `sleep_time`
- `wake_time`
- `relationship`
- `use_case`

And written destinations are correct:

- `settings.json`
- `profile.json`
- `USER.md`

### 4. Deterministic guided settings writeback

Run at least:

- proactive on/off
- proactive cadence
- quiet hours
- retry-after cadence
- stop-after unanswered count

Pass if the package writes the intended structured settings and does not depend on a host-specific hidden prompt to make the change real.

### 5. `/new` continuity

Run both:

- `/new` or equivalent new-session path
- post-new bare `hi` / `嗨`

Pass if:

- the opener reattaches to a real continuity source
- a bare greeting after `/new` stays thread-led or neutral
- the reply does not collapse into generic time-of-day chatter
- time may support the same thread, but time does not replace the thread

### 6. Frontstage cleanliness

Pass if the user-visible path does not leak:

- heartbeat narration
- runtime-context blocks
- carryover/internal control text
- structured-state labels
- mixed-language contamination created by the package itself

### 7. Host-addon sync

If the optional bridge addon is included in the published package, validate the package as a pair:

- skill version
- bridge version

Pass if:

- the bridge does not force a host language by default
- the bridge forwards `time_modifier_prompt` and low-information continuity guard
- the bridge still blocks internal leakage on outbound delivery

## Minimum release evidence

Ship with:

- one sandbox report covering routing / writeback / `/new`
- one neutrality report covering language and timezone/offset checks
- one addon sync note if the bridge addon is bundled

## Fail policy

Do not publish if any of these fail:

- host language is silently forced by the public package
- generic timezone offset is silently rewritten into a city timezone
- `/new` misanchors or bare `hi` / `嗨` drops the thread
- heartbeat or internal runtime text reaches the user-visible reply
