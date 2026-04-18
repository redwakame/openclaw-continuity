# Runtime Patch Guide

This folder documents the **optional** runtime-side patch used to align
heartbeat persistence with the final outbound text.

Use this only if your host wants both:

1. outbound heartbeat text sanitized before send
2. persisted heartbeat text (for example `lastHeartbeatText`) to match that
   final delivered text

## Not default

This runtime patch is **not** auto-applied by:

- GitHub ZIP download
- GitHub release ZIP
- ClawHub-style skill install

Default install remains **skill only**.

## Target file

For the OpenClaw build currently used in local validation, the target file was:

- `dist/gateway-cli-*.js`

The exact hashed filename may differ by OpenClaw build/version.

## Patch intent

The patch adds two behaviors:

1. strip heartbeat/internal narration from heartbeat text before delivery
2. store the **delivered** heartbeat text, not the raw pre-sanitize text, in
   session persistence such as `lastHeartbeatText`

## Reference logic

### A. Add heartbeat narration stripping

Introduce a helper like:

```js
function stripHeartbeatInternalNarration(text) {
  if (!text) return "";
  let cleaned = text.replace(/\r\n/g, "\n");
  const narrationPatterns = [
    /(?:^|\n)\s*This is another heartbeat poll[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current time:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current situation:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Looking at the autoseed output:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*No candidate_actions\.[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Let me run the personal-hooks scripts[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*I should not send another proactive message[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*(?:Still no response|No due hooks|Nothing urgent)[^\n]*(?=\n|$)/giu,
  ];
  for (const pattern of narrationPatterns) cleaned = cleaned.replace(pattern, "\n");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}
```

Then apply it after heartbeat token/prefix stripping and before outbound send.

### B. Persist delivered text, not raw normalized text

When calling outbound delivery, capture the final payload text:

```js
let deliveredHeartbeatText = normalized.text;
await deliverOutboundPayloads({
  ...,
  onPayload: (payloadSummary) => {
    if (typeof payloadSummary?.text === "string" && payloadSummary.text.trim()) {
      deliveredHeartbeatText = payloadSummary.text;
    }
  },
});
```

Then persist:

```js
lastHeartbeatText: deliveredHeartbeatText
```

instead of:

```js
lastHeartbeatText: normalized.text
```

## Validation

After patching, verify:

1. outbound heartbeat text no longer includes:
   - `<final>`
   - `This is another heartbeat poll...`
   - `Looking at the autoseed output...`
2. `lastHeartbeatText` matches the final delivered text
3. host bridge `message_sending` still fires as the last outbound defense

## Packaging note

This runtime guide is shipped together with the skill package as an
**operator-facing addon**. It is documentation and reference material, not a
claim that the public skill automatically patches gateway runtime code.
