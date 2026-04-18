/**
 * Host heartbeat runtime patch template.
 *
 * Purpose:
 * 1. strip heartbeat/internal narration before outbound delivery
 * 2. persist delivered heartbeat text instead of raw pre-sanitize text
 *
 * This is intentionally a template because the concrete target file/path
 * differs by OpenClaw build/version.
 */

function stripHeartbeatInternalNarration(text) {
  if (!text) return "";
  let cleaned = text.replace(/\r\n/g, "\n");
  const narrationPatterns = [
    /(?:^|\n)\s*This is another heartbeat poll[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current time:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current situation:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Looking at the autoseed output:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*The autoseed(?: output)? shows:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*No candidate_actions\.[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Let me run the personal-hooks scripts[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*I should not send another proactive message[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*(?:Still no response|No due hooks|Nothing urgent)[^\n]*(?=\n|$)/giu,
  ];
  for (const pattern of narrationPatterns) cleaned = cleaned.replace(pattern, "\n");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Example insertion point:
 *
 * let deliveredHeartbeatText = normalized.text;
 * await deliverOutboundPayloads({
 *   ...,
 *   onPayload: (payloadSummary) => {
 *     if (typeof payloadSummary?.text === "string" && payloadSummary.text.trim()) {
 *       deliveredHeartbeatText = payloadSummary.text;
 *     }
 *   },
 * });
 *
 * lastHeartbeatText: deliveredHeartbeatText
 */
