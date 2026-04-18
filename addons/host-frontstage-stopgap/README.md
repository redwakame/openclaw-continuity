# Host Frontstage Stopgap Addon

This addon packages the **host-side stopgap** for two classes of leakage that
the public `personal-hooks` skill cannot fully guarantee by itself:

1. `<final> ... </final>` wrappers leaking into user-visible output
2. heartbeat/internal narration leaking into final outbound delivery

It also documents one critical startup rule for hosts that support `/new` or
`/reset`:

- do **not** fabricate a fake user utterance during session startup
- bootstrap with trusted carryover/pending state first
- wait for the first real human message before `preagent-sync`
- keep `/new` bootstrap internal-only until that first real human message

This addon is **optional**.

- Default GitHub ZIP / release ZIP / ClawHub skill install:
  - installs the skill package only
  - does **not** auto-apply this addon
- If a host wants the stopgap, the host/operator must opt in and apply it
  explicitly.

## Included

- `bridge/`
  - a generic OpenClaw plugin template that adds a final frontstage guard at:
    - `before_message_write`
    - `message_sending`
- `runtime/`
  - a real heartbeat config sample (`openclaw.heartbeat.sample.json`)
  - a real runtime patch template (`heartbeat_runtime_patch.template.js`)
  - guidance for the optional heartbeat/runtime persistence patch so that
    `lastHeartbeatText` matches the final delivered text
- `install_telegram_host_addon.sh`
  - copies the bridge files into a host plugin tree and points the operator to
    the included runtime templates

## When to use this addon

Use it when a host wants stronger protection against:

- `<final>` tag leakage
- heartbeat narration such as:
  - `This is another heartbeat poll...`
  - `Looking at the autoseed output...`
  - `Still no response...`

## What this addon is not

- It is not part of the portable skill core.
- It is not required for browser/local reply-pipeline-first usage.
- It is not a promise that every host/channel/runtime combination will be fully
  sanitized without host testing.

## Installation modes

### Default package mode

Use only the skill package under `skills/personal-hooks/`.

This is the default mode for:

- GitHub ZIP download
- GitHub release ZIP
- ClawHub-style skill package use

### Optional host addon mode

If your host needs the stopgap:

1. copy `bridge/` into the host plugin tree
2. follow `runtime/README.md` if you also want heartbeat persistence to align
   with the sanitized outbound text
3. or run `install_telegram_host_addon.sh /path/to/openclaw-state-dir`

The installer is overwrite-oriented for the destination plugin directory. Back
up any existing plugin with the same target name before running it.

## Safety note

This addon is intentionally shipped as **opt-in**.

It should not be silently applied during ordinary package installation because:

- different hosts have different plugin trees
- runtime files may differ by OpenClaw build/version
- some users may want the skill only, without host-side interception

## `/new` startup safety

If the host starts a fresh session, do not synthesize text such as
`晚安`, `早安`, `我回來了`, or any other guessed opener and feed it into
`preagent-sync` / `runtime-context`.

Use the trusted startup path instead:

1. run `runtime-context --user-text "/new" --is-new-session`
2. let the model read trusted carryover / pending topics as internal bootstrap context only
3. if the runtime injects `A new session was started...`, `## New-session carryover ...`, or pending-topic bootstrap text as a pseudo-`user` turn, still treat it as internal bootstrap context only
4. do **not** turn bootstrap context into fake user input
5. the model may still open from trusted carryover / pending-topic / tracked-followup / schedule context when appropriate
6. wait for the first real human message before any event capture

Otherwise the host can accidentally turn a model-generated opener into fake
user input, which breaks continuity and may trigger the wrong rest/work branch.
