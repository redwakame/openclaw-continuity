/**
 * personal-hooks-frontstage-stopgap v2.0.5 — cross-version stable
 *
 * Cross-version compatibility (2026.3.24 / 2026.4.5+):
 * - Gateway 2026.3.24: api.on() returns void 0 when registrationMode !== "full"
 * - Gateway 2026.4.5+: api.on is undefined when registrationMode !== "full"
 * - registrationMode === "full" is a HARD requirement.
 */

import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PLUGIN_NAME = "personal-hooks-bridge";
const FRONTSTAGE_BRIDGE_AUDIT_FILE = "frontstage_bridge_audit.jsonl";

type SkillCommandSuccess = { ok: true; raw: string };
type SkillCommandFailureKind = "timeout" | "nonzero-exit" | "empty-output" | "unknown-exec-error";
type SkillCommandFailure = {
  ok: false;
  kind: SkillCommandFailureKind;
  message?: string;
  status?: number | null;
  signal?: string | null;
  raw?: string;
};
type SkillCommandResult = SkillCommandSuccess | SkillCommandFailure;
type HeartbeatRenderSuccess = { ok: true; data: { decision: string; reason?: string; rendered_text: string } };
type HeartbeatRenderFailure = SkillCommandFailure | { ok: false; kind: "invalid-json"; message?: string; raw?: string };
type HeartbeatRenderResult = HeartbeatRenderSuccess | HeartbeatRenderFailure;

function compactLogText(text: string, limit = 160): string {
  return (text || "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

// ── Cross-version safe hook registration ──
function safeOn(api: any, hookName: string, handler: Function, opts?: any): boolean {
  const mode = api.registrationMode || "unknown";
  if (mode !== "full" && mode !== "unknown") return false;
  if (typeof api.on === "function") {
    try { api.on(hookName, handler, opts); return true; } catch (err) {
      api.logger.warn(`${PLUGIN_NAME}: api.on("${hookName}") threw: ${err}`);
    }
  }
  if (typeof api.registerHook === "function") {
    try {
      api.registerHook(hookName, handler, { name: `${PLUGIN_NAME}.${hookName}` });
      return true;
    } catch (err) {
      api.logger.warn(`${PLUGIN_NAME}: api.registerHook("${hookName}") threw: ${err}`);
    }
  }
  return false;
}

function findSkillScript(stateDir: string): string | null {
  const candidates = [
    join(stateDir, "workspace", "personal-hooks", "scripts", "personal_hooks.py"),
    join(stateDir, "workspace", "skills", "personal-hooks", "scripts", "personal_hooks.py"),
    join(stateDir, "skills", "personal-hooks", "scripts", "personal_hooks.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function appendFrontstageBridgeAudit(dataDir: string, entry: Record<string, unknown>): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(
      join(dataDir, FRONTSTAGE_BRIDGE_AUDIT_FILE),
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
      "utf-8",
    );
  } catch {
    // Fail-open: audit must never break delivery.
  }
}

type CronJobRuntimeDescriptor = {
  suppressAssistantTranscript: boolean;
};

function buildCronJobRuntimeIndex(stateDir: string): Map<string, CronJobRuntimeDescriptor> {
  const index = new Map<string, CronJobRuntimeDescriptor>();
  const jobsPath = join(stateDir, "cron", "jobs.json");
  if (!existsSync(jobsPath)) return index;
  try {
    const parsed = JSON.parse(readFileSync(jobsPath, "utf-8"));
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    for (const job of jobs) {
      if (!job || typeof job !== "object") continue;
      const id = typeof job.id === "string" ? job.id.trim() : "";
      if (!id) continue;
      const delivery = job.delivery && typeof job.delivery === "object" ? job.delivery : {};
      const mode = typeof delivery.mode === "string" ? delivery.mode.trim().toLowerCase() : "";
      const sessionTarget = typeof job.sessionTarget === "string" ? job.sessionTarget.trim().toLowerCase() : "";
      if (mode === "none" && sessionTarget === "isolated") {
        index.set(id, { suppressAssistantTranscript: true });
      }
    }
  } catch {
    return index;
  }
  return index;
}

function runSkillCommandResult(script: string, args: string[], env: Record<string, string>, timeoutMs = 4000): SkillCommandResult {
  try {
    const raw = execFileSync("python3", [script, ...args], {
      encoding: "utf-8",
      timeout: timeoutMs,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!raw) return { ok: false, kind: "empty-output" };
    return { ok: true, raw };
  } catch (err: any) {
    const stdout =
      typeof err?.stdout === "string"
        ? err.stdout
        : Buffer.isBuffer(err?.stdout)
          ? err.stdout.toString("utf-8")
          : "";
    const stderr =
      typeof err?.stderr === "string"
        ? err.stderr
        : Buffer.isBuffer(err?.stderr)
          ? err.stderr.toString("utf-8")
          : "";
    const message = compactLogText(stderr || stdout || String(err?.message || ""));
    if (err?.code === "ETIMEDOUT" || err?.killed === true) {
      return {
        ok: false,
        kind: "timeout",
        message,
        status: typeof err?.status === "number" ? err.status : null,
        signal: typeof err?.signal === "string" ? err.signal : null,
        raw: compactLogText(stdout || stderr, 240),
      };
    }
    return {
      ok: false,
      kind: "nonzero-exit",
      message,
      status: typeof err?.status === "number" ? err.status : null,
      signal: typeof err?.signal === "string" ? err.signal : null,
      raw: compactLogText(stdout || stderr, 240),
    };
  }
}

function runSkillCommand(script: string, args: string[], env: Record<string, string>, timeoutMs = 4000): string | null {
  const result = runSkillCommandResult(script, args, env, timeoutMs);
  return result.ok ? result.raw : null;
}

function stripInternalPlanningPreamble(text: string): string {
  let cleaned = text || "";
  const planningMarkers = [
    /意思是让?我/iu,
    /意思是讓我/iu,
    /我应该[:：]/iu,
    /我應該[:：]/iu,
    /这是具体任务/iu,
    /這是具體任務/iu,
  ];
  if (!planningMarkers.some((pattern) => pattern.test(cleaned))) return cleaned;

  const responseCuePatterns = [
    /(?:^|[\n。！？!?])\s*(收到)/u,
    /(?:^|[\n。！？!?])\s*(好(?:的|呀|喔)?)/u,
    /(?:^|[\n。！？!?])\s*(那(?:你|妳|您|先|就))/u,
  ];
  for (const pattern of responseCuePatterns) {
    const match = pattern.exec(cleaned);
    if (match && typeof match.index === "number") {
      const tail = cleaned.slice(match.index).replace(/^[\s。．.!！？]+/u, "").trim();
      if (tail) return tail;
    }
  }

  cleaned = cleaned.replace(/[\s\S]*?(?:我应该[:：]|我應該[:：]|这是具体任务|這是具體任務)[\s\S]*?(?=(?:收到|好(?:的|呀|喔)?|那(?:你|妳|您|先|就)|你|妳|您))/u, "").trim();
  return cleaned;
}

function extractUserTextForRuntimeContext(event: any, ctx: any, prompt: string): string {
  const directCandidates = [
    event?.userText,
    ctx?.userText,
    event?.userMessage,
    ctx?.userMessage,
    event?.message?.text,
    ctx?.message?.text,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const trimmed = candidate.trim().slice(0, 200);
      if (looksLikeInternalControlText(trimmed)) continue;
      return trimmed;
    }
  }
  let cleaned = typeof prompt === "string" ? prompt : "";
  const blockPatterns = [
    /<relevant-memories>[\s\S]*?<\/relevant-memories>/gi,
    /<inherited-rules>[\s\S]*?<\/inherited-rules>/gi,
    /## New-session carryover \(trusted structured state\)[\s\S]*?(?=\n## |$)/gi,
    /## Pending follow-up topics \(trusted structured state\)[\s\S]*?(?=\n## |$)/gi,
    /## Night-owl schedule context \(trusted structured state\)[\s\S]*?(?=\n## |$)/gi,
    /## Household schedule awareness \(trusted structured state\)[\s\S]*?(?=\n## |$)/gi,
    /A new session was started via \/new or \/reset\..*?(?=\n{2,}|$)/gi,
  ];
  for (const pattern of blockPatterns) cleaned = cleaned.replace(pattern, "");
  const blocks = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (blocks.length === 0) return "context-refresh";
  const tail = blocks[blocks.length - 1].slice(0, 200);
  return looksLikeInternalControlText(tail) ? "context-refresh" : tail;
}

const FRONTSTAGE_GUARD_SYSTEM_PROMPT = [
  "Keep only user-facing final content in frontstage replies.",
  "Do not expose internal drafts, self-corrections, planning steps, review notes, or execution traces.",
  "If a correction is needed, use one short natural apology and move straight to the corrected reply.",
].join("\n");

function normalizeRuntimeFragmentToken(token: string): string {
  return (token || "")
    .toLowerCase()
    .replace(/[。．.!?！？,:;，；\s]+/gu, "")
    .trim();
}

function looksLikeRuntimeFragmentBundle(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value || value.length > 96) return false;
  const parts = value
    .split(/\n+|(?<=[。．.!?！？])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  const allowed = new Set([
    "same",
    "samecontent",
    "empty",
    "emptycontent",
    "reply",
    "replyemptycontent",
    "replyheartbeatok",
    "heartbeatok",
  ]);
  return parts.every((part) => allowed.has(normalizeRuntimeFragmentToken(part)));
}

function stripHostFrontstageLeakage(text: string): string {
  let cleaned = (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/<final>/gi, "")
    .replace(/<\/final>/gi, "")
    .replace(/<\/?(?:assistant|response|answer)>/gi, "")
    .replace(/\[TOOL_CALL\][\s\S]*?(?:\[\/TOOL_CALL\]|<\/minimax:tool_call>)/giu, "")
    .trim();
  const replyToCurrentMatch = cleaned.match(/\[\[reply_to_current\]\]\s*([\s\S]+)$/i);
  if (replyToCurrentMatch && typeof replyToCurrentMatch[1] === "string" && replyToCurrentMatch[1].trim()) {
    cleaned = replyToCurrentMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/\[\[reply_to_current\]\]/gi, "").trim();
  }
  const narrationPatterns = [
    /(?:^|\n)\s*This is another heartbeat poll[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current time:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Current situation:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Same content[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Empty content[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Reply\s*\.?\s*(?:Empty content|HEARTBEAT_OK)[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Looking at the autoseed output:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*The autoseed(?: output)? shows:[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*No candidate_actions\.[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Let me run the personal-hooks scripts[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*I should not send another proactive message[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*(?:Still no response|No due hooks|Nothing urgent)[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Heartbeat at[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*\d{1,2}:\d{2}\s*heartbeat\.\s*Quick check(?: of)?\s*HEARTBEAT\.md[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*It'?s now \d{1,2}:\d{2}\s*(?:am|pm)[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*Per HEARTBEAT\.md\s*-\s*minimal[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*(?:姐姐|哥哥|親愛的|寶貝|宝贝)?[^\n]*(?:讓我找找|让我找找|我來找找|我来找找|我來看一下|我来看一下|我來重新|我来重新|我來檢查一下|我来检查一下|語音技能|语音技能|正確的路徑|正确的路径|tts 工具(?:調用|调用)|memory_search|haicai-voice|minimax[_-]voice|voice file|audio file|tool\s*=>|args\s*=>|\/(?:Users|home)\/[^/\s]+\/)[^\n]*(?=\n|$)/giu,
    /(?:^|\n)\s*(?:I need to use|Let me use|Let me find|Let me check the correct path|I need to search|I need to read)\b[^\n]*(?=\n|$)/giu,
  ];
  for (const pattern of narrationPatterns) {
    cleaned = cleaned.replace(pattern, "\n");
  }
  const inlineHeartbeatFragments = [
    /\b\d{1,2}:\d{2}\s*Taiwan\s*=\s*\d{1,2}:\d{2}\s*UTC\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bTaiwan\s*=\s*\d{1,2}:\d{2}\s*UTC\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\b\d{1,2}:\d{2}\s*UTC\s*[<>]=?\s*\d{1,2}:\d{2}\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bSleep time(?:\s+is|\s+UTC\s+is)?\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bSleep time (?:has just begun|just started|begins at)\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bsleep has started\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\b(?:outside|inside|within)\s+sleep\s+time\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\b(?:outside|before|after)\s+(?:sleep|wake)\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\b(?:may|might|still)\s+(?:be\s+)?asleep\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\b(?:is now sleeping|is sleeping)\b[^.!?\n]*(?:[.!?]|$)/giu,
    /(?:^|[\s.。!?！？])\S{1,12}\s+is\s+awake\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bAwake\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bNo user message\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bNothing needs attention\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bNothing specific to act on\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bSame content\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bEmpty content\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bReply\s*\.?\s*(?:Empty content|HEARTBEAT_OK)\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\bQuick check(?: of)?\s*HEARTBEAT\.md\b[^.!?\n]*(?:[.!?]|$)/giu,
    /\btypical (?:sleep|wake) time\b[^.!?\n]*(?:[.!?]|$)/giu,
  ];
  for (const pattern of inlineHeartbeatFragments) {
    cleaned = cleaned.replace(pattern, "\n");
  }
  // S1: Strip embedded system tokens (e.g. "好的 HEARTBEAT_OK" → "好的")
  cleaned = cleaned.replace(/\b(?:NO_REPLY|NO_HOOK|HEARTBEAT_OK|HOOK_DONE:[A-Za-z0-9_-]+|[A-Z][A-Z0-9_]+_DONE)\b/gi, "");
  // S8: Strip underscore-joined internal identifiers
  cleaned = cleaned.replace(/\b(?:care_phase|hook_type|event_kind|dispatch_count|followup_state|incident_type|source_layer|memory_class|current_status|staging_snapshot|session_key|stopReason|content_type|routine_phase|proactive_enabled|proactive_event_kind|proactive_interval_hours)\b/gi, "");
  // S9: Internal labels — mechanism explanation triggers full block via stillLooksInternal
  cleaned = cleaned.replace(/新session[開开]始[，,;；\s]*/gi, "");
  cleaned = cleaned.replace(/\[incident:[^\]]*\]\s*/gi, "");
  cleaned = stripInternalPlanningPreamble(cleaned);
  cleaned = cleaned.replace(/(?:^|\n)\s*[\w.-]+\.(?:mp3|wav|m4a|ogg|png|jpg|jpeg|webp)\s*(?=\n|$)/giu, "\n");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
  cleaned = cleaned.replace(/[ \t]*\n[ \t]*/g, "\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return looksLikeRuntimeFragmentBundle(cleaned) ? "" : cleaned;
}

function containsHeartbeatOperatorNarrative(text: string): boolean {
  const cleaned = typeof text === "string" ? text.trim() : "";
  if (!cleaned) return false;
  if (looksLikeRuntimeFragmentBundle(cleaned)) return true;
  return /(?:MEMORY\.md|autoseed|due hooks|Same content|Empty content|Reply\s*\.?\s*(?:Empty content|HEARTBEAT_OK)|Quick check(?: of)?\s*HEARTBEAT\.md|我应该[:：]|我應該[:：]|我应该直接回复(?:她|他|你|妳)|我應該直接回覆(?:她|他|你|妳)|等心跳(?: hook)? 触发|等心跳(?: hook)? 觸發)/i.test(cleaned);
}

function stillLooksInternal(text: string): boolean {
  if (looksLikeRuntimeFragmentBundle(text)) return true;
  return /(?:\[\[internal\]\]|\[TOOL_CALL\]|tool\s*=>|args\s*=>|memory_search|\/(?:Users|home)\/[^/\s]+\/|(?:^|[\s(])(?:memory|data|workspace)\/[^\s)]+\.(?:md|json|jsonl|txt)\b|hooks\.json|events\.json|MEMORY\.md|preagent-sync|runtime-context|Looking at the autoseed output|The autoseed(?: output)? shows|\bautoseed\b|This is another heartbeat poll|Another heartbeat at|Heartbeat at \d{1,2}:\d{2}|Still no response|Still blocked by cooldown|Nothing to send|Nothing needs attention|Nothing specific to act on|Nothing to do|No user message|Same content|Empty content|Reply\s*\.?\s*(?:Empty content|HEARTBEAT_OK)|Quick check(?: of)?\s*HEARTBEAT\.md|blocked by cooldown|dispatch\.cooldown|Let me run the personal-hooks scripts|Let me also run autoseed|Let me also check|Let me use|Let me find|Let me check the correct path|The user is (?:probably awake|sleeping|asleep|busy)|The user is asking|I should (?:reply|respond|run|check|look|wait|use|update|create|send|remember)\b|I'll (?:reply|respond|run|check|look|wait|use|update|create|send|remember)\b|I need to (?:reply|respond|run|check|look|wait|use|update|create|send|remember|search|read)\b|Actually,? looking|HEARTBEAT_OK|NO_REPLY|NO_HOOK|Hook due:|No hooks due|due hooks|\b(?:HK|INC|CAND|MW)-\d{8}-\d{6}-\d{3}\b|Same pattern|Past \d{2}:\d{2}|stopReason|content:\s*\[\]|dispatch_count|followup[._]state|hook_type|event_kind|care_phase|incident_type|source_layer|memory_class|staging_snapshot|session_key|content_type|routine_phase|proactive_enabled|proactive_event_kind|hook[_\s]?判[断斷]|误以[为為].*(?:闷|悶|難過|难过)|推[测測].*情[绪緒]|(?:使用者|user|對方|對面)\S{0,8}(?:抱怨|在抱怨)|我需要用\s*memory_search|我需要用\s*tts|讓我找找|让我找找|我來找找|我来找找|我來看一下|我来看一下|我來重新|我来重新|我來檢查一下|我来检查一下|語音技能|语音技能|正確的路徑|正确的路径|tts 工具(?:調用|调用)|haicai-voice|minimax[_-]voice|voice file|audio file|生成語音|生成语音|檢查一下語音文件|检查一下语音文件|[\w.-]+\.(?:mp3|wav|m4a|ogg|png|jpg|jpeg|webp)\b|新session[開开]始|\[incident:[^\]]*\]|candidate[_.]buffer|staging[_.]record|KeyError:|Traceback \(most recent\)|Sleep time(?:\s+is|\s+UTC\s+is)?|sleep time starts|sleep time has just begun|sleep time just started|sleep has started|is now sleeping|is sleeping|\b(?:outside|inside|within)\s+sleep\s+time\b|(?:outside|before|after)\s+(?:sleep|wake)|(?:may|might|still)\s+(?:be\s+)?asleep|\bboth\b.*\basleep\b|\bJust\s*\.\s*$|\bawake\b|\S{1,12}\s+is\s+awake\b|\d{1,2}:\d{2}\s*Taiwan\s*=\s*\d{1,2}:\d{2}\s*UTC|Taiwan\s*=\s*\d{1,2}:\d{2}\s*UTC|\d{1,2}:\d{2}\s*UTC\s*[<>]=?\s*\d{1,2}:\d{2}|typical (?:sleep|wake) time|Per HEARTBEAT\.md\s*-\s*minimal|我应该[:：]|我應該[:：]|我应该直接回复(?:她|他|你|妳)|我應該直接回覆(?:她|他|你|妳)|意思是让?我|意思是讓我|这是具体任务|這是具體任務)/i.test(
    text,
  );
}

function sentenceLooksInternal(sentence: string): boolean {
  const value = (sentence || "").trim();
  if (!value) return false;
  return /(?:\[\[internal\]\]|\[TOOL_CALL\]|<invoke\b|<\/minimax:tool_call>|memory_search|haicai-voice|minimax[_-]voice|voice file|audio file|生成語音|生成语音|語音技能|语音技能|tts|我來檢查一下|我来检查一下|我來找找|我来找找|讓我找找|让我找找|Let me|I need to|I should|exec\b|message\b|sendVoice|send voice|\/(?:Users|home)\/[^/\s]+\/|(?:^|[\s(])(?:memory|data|workspace)\/[^\s)]+\.(?:md|json|jsonl|txt)\b|[\w.-]+\.(?:mp3|wav|m4a|ogg|png|jpg|jpeg|webp)\b)/i.test(value);
}

function looksLikeUnresolvedReferentFragment(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value || value.length > 72) return false;
  if (/[「」『』:：]/u.test(value)) return false;
  if (/(?:前面提到|你之前說|你之前说|先前提到|earlier|about\s+)/iu.test(value)) return false;
  return /^(?:嗯|欸|诶|好|好的|那|如果|現在|现在|先|還是|还是|要不要|想不想|可以|那要不要)?[\s，,]*(?:這個|这个|那個|那个|這件事|这件事|那件事|這段|这段|那段|this|that|it)[\s，,]*(?:要不要|想不想|要|先|再|繼續|继续|聊聊|聊嗎|聊吗|接回|talk about it|pick it up|continue|keep going)?[\s。！？!?]*$/iu.test(
    value,
  );
}

function salvageUserFacingPrefix(text: string): string {
  const value = stripHostFrontstageLeakage(text);
  if (!value) return "";
  if (looksLikeRuntimeFragmentBundle(value)) return "";
  const parts = value
    .split(/(?<=[。！？!?])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    if (sentenceLooksInternal(part)) break;
    kept.push(part);
  }
  const candidate = kept.join("").trim();
  if (!candidate) return "";
  const hasUserFacingSignal = /(?:抱歉|對不起|对不起|我在這裡|我在这里|別擔心|别担心|還好嗎|还好吗|姐姐|哥哥|親愛的|寶貝|宝貝|老公|老婆|你|妳|您)/i.test(candidate);
  if (!hasUserFacingSignal) return "";
  if (looksLikeUnresolvedReferentFragment(candidate)) return "";
  return stillLooksInternal(candidate) ? "" : candidate;
}

function looksLikeInternalControlText(text: string): boolean {
  const cleaned = (text || "").trim();
  if (!cleaned) return false;
  return /(?:^\s*\[cron:[^\]]+\]|Read HEARTBEAT\.md|Current time:|Reply with ONLY the slug|Run your Session Startup sequence|A new session was started via \/new or \/reset|<(?:inherited-rules|relevant-memories)>|trusted structured state|Stable rules inherited from |Remembering this platform action and result; will pick up next steps on return|Continue from login, posting, commenting, or interaction results|Personal Hooks Checker)/i.test(
    cleaned,
  );
}

function runFrontstageGuard(
  script: string,
  env: Record<string, string>,
  text: string,
  source = "runtime-reply",
): string | null {
  const precleaned = stripHostFrontstageLeakage(text);
  if (!precleaned) return null;
  if (looksLikeRuntimeFragmentBundle(precleaned)) return null;
  if (source === "heartbeat-send" && containsHeartbeatOperatorNarrative(precleaned)) return null;

  const raw = runSkillCommand(
    script,
    ["frontstage-guard", "--text", precleaned, "--source", source],
    env,
    4000,
  );

  let cleaned = precleaned;
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (typeof data?.text === "string") {
        // If Python guard returned empty string, it means BLOCK — honor it.
        if (!data.text.trim()) {
          const salvaged = source === "runtime-reply" ? salvageUserFacingPrefix(text) : "";
          return salvaged || null;
        }
        cleaned = data.text.trim();
      }
    } catch {
      // Ignore malformed JSON and keep precleaned text.
    }
  }

  cleaned = stripHostFrontstageLeakage(cleaned);
  if (!cleaned || looksLikeRuntimeFragmentBundle(cleaned) || stillLooksInternal(cleaned) || looksLikeUnresolvedReferentFragment(cleaned)) {
    const salvaged = source === "runtime-reply" ? salvageUserFacingPrefix(text) : "";
    return salvaged || null;
  }
  return cleaned;
}

function isHeartbeatSession(ctx: any): boolean {
  const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
  return sessionKey.includes(":heartbeat");
}

function looksLikeHeartbeatNarration(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;
  if (looksLikeRuntimeFragmentBundle(value)) return true;
  return /(?:\bowner\b.*\b(?:asleep|awake|quiet|busy)\b|\bwife\b.*\b(?:asleep|awake|home|work)\b|\bnothing\s+(?:specific\s+)?to\s+act\s+on\b|still\s+no\s+response|heartbeat\s+at\s+\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:am|pm)?\s*Sunday\s+Taiwan\s+time|Taiwan\s*=\s*\d{1,2}:\d{2}\s*UTC|no\s+hooks\s+due|no\s+new\s+hooks|same content|empty content|reply\s*\.?\s*(?:empty content|heartbeat_ok)|quick check(?: of)?\s*heartbeat\.md)/i.test(value);
}

function looksLikeUserFacingHeartbeatText(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;
  if (looksLikeRuntimeFragmentBundle(value)) return false;
  if (/(?:heartbeat|autoseed|no\s+hooks?\s+due|no\s+new\s+hooks|still\s+no\s+response|nothing\s+(?:specific\s+)?to\s+act\s+on|nothing\s+needs\s+attention|no\s+user\s+message|routine_phase|quiet-hours|blocked\s+by|cooldown|Taiwan\s*=\s*\d{1,2}:\d{2}\s*UTC|\bUTC\b)/i.test(value)) {
    return false;
  }
  const hasAddressee = /(?:\b(?:you|your)\b|[你妳您]|姐姐|哥哥|親愛的|寶貝|老公|老婆)/i.test(value);
  const hasCareIntent = /(?:[？?]|還好嗎|還在嗎|要不要|方便聊|最近怎麼樣|想先聊|休息|收尾|去睡|慢慢來|陪你|在這裡|想到你|掛著你|\b(?:rest|sleep|wind down|pick up|update|okay|alright|with you)\b)/i.test(value);
  return hasAddressee && hasCareIntent;
}

function isCronSession(ctx: any): boolean {
  const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey.trim() : "";
  return sessionKey.includes(":cron:");
}

function isInternalSessionScope(ctx: any, sessionKey: string): boolean {
  const value = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!value) return true;
  if (isHeartbeatSession(ctx) || isCronSession(ctx)) return true;
  if (/^agent:main:main(?::heartbeat)?$/u.test(value)) return true;
  if (/:run:/u.test(value)) return true;
  if (/:heartbeat$/u.test(value)) return true;
  return false;
}

function canUseFrontstageSessionCache(ctx: any, sessionKey: string): boolean {
  const value = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!value) return false;
  return !isInternalSessionScope(ctx, value);
}

function frontstageGuardSourceForText(ctx: any, text: string, fallback = "runtime-reply"): string {
  if (isHeartbeatSession(ctx)) return "heartbeat-send";
  return fallback;
}

function cronSessionJobId(ctx: any): string {
  const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey.trim() : "";
  const match = sessionKey.match(/:cron:([^:]+)$/);
  return match?.[1]?.trim() || "";
}

function cronSessionRuntimeDescriptor(index: Map<string, CronJobRuntimeDescriptor>, ctx: any): CronJobRuntimeDescriptor | null {
  const jobId = cronSessionJobId(ctx);
  if (!jobId) return null;
  return index.get(jobId) || null;
}

function stripAssistantVisibleText(message: any): any | null {
  if (!message || typeof message !== "object" || message.role !== "assistant") return null;
  const content = Array.isArray(message.content) ? message.content : null;
  if (!content) return null;
  let changed = false;
  const sanitized = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part?.text === "string" && part.text.trim().length > 0) {
      changed = true;
      continue;
    }
    sanitized.push(part);
  }
  if (!changed) return null;
  return { ...message, content: sanitized };
}

function scrubCronSessionTranscript(stateDir: string, sessionId: string): boolean {
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!id) return false;
  const sessionPath = join(stateDir, "agents", "main", "sessions", `${id}.jsonl`);
  if (!existsSync(sessionPath)) return false;
  try {
    const original = readFileSync(sessionPath, "utf-8");
    const trailingNewline = original.endsWith("\n");
    const rewritten = original
      .split(/\r?\n/)
      .map((line) => {
        if (!line.trim()) return line;
        try {
          const parsed = JSON.parse(line);
          const message = parsed?.type === "message" ? parsed?.message : null;
          if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return line;
          const sanitizedContent = message.content.filter((part: any) => part?.type !== "thinking");
          if (sanitizedContent.length === message.content.length) return line;
          parsed.message = { ...message, content: sanitizedContent };
          return JSON.stringify(parsed);
        } catch {
          return line;
        }
      })
      .join("\n");
    if (rewritten === original) return false;
    writeFileSync(sessionPath, trailingNewline ? `${rewritten}\n` : rewritten, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function scrubCronSessionIndex(stateDir: string, sessionKey: string, sessionId: string): boolean {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  const sessionsIndexPath = join(stateDir, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsIndexPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(sessionsIndexPath, "utf-8"));
    let changed = false;
    const visit = (node: any, nodeKey = ""): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, nodeKey);
        return;
      }
      const matchesKey =
        key &&
        (
          nodeKey === key ||
          nodeKey.startsWith(`${key}:`) ||
          (typeof node.sessionKey === "string" && node.sessionKey.trim() === key)
        );
      const matchesId = id && typeof node.sessionId === "string" && node.sessionId.trim() === id;
      const heartbeatText =
        typeof node.lastHeartbeatText === "string" ? node.lastHeartbeatText.trim() : "";
      const internalHeartbeatScope =
        /^agent:main:main(?::heartbeat)?$/u.test(nodeKey) ||
        /:cron:/u.test(nodeKey) ||
        /:run:/u.test(nodeKey) ||
        /:heartbeat$/u.test(nodeKey);
      const shouldClearHeartbeatState =
        Boolean(heartbeatText) &&
        (
          internalHeartbeatScope ||
          matchesKey ||
          matchesId ||
          !looksLikeUserFacingHeartbeatText(heartbeatText)
        );
      if (shouldClearHeartbeatState) {
        delete node.lastHeartbeatText;
        changed = true;
        if (node.lastHeartbeatSentAt != null) {
          delete node.lastHeartbeatSentAt;
          changed = true;
        }
      }
      for (const [childKey, value] of Object.entries(node)) {
        visit(value, typeof childKey === "string" ? childKey : "");
      }
    };
    visit(parsed);
    if (!changed) return false;
    writeFileSync(sessionsIndexPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function resolveLatestSessionIdForKey(stateDir: string, sessionKey: string): string {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!key) return "";
  const sessionsIndexPath = join(stateDir, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsIndexPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(sessionsIndexPath, "utf-8"));
    const candidates: Array<{ sessionId: string; ts: number }> = [];
    const visit = (node: any): void => {
      if (!node || typeof node !== "object") return;
      if (typeof node.sessionKey === "string" && node.sessionKey.trim() === key && typeof node.sessionId === "string") {
        const tsCandidate = Number(node.generatedAt ?? node.updatedAt ?? 0);
        candidates.push({
          sessionId: node.sessionId.trim(),
          ts: Number.isFinite(tsCandidate) ? tsCandidate : 0,
        });
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      for (const value of Object.values(node)) visit(value);
    };
    visit(parsed);
    candidates.sort((a, b) => b.ts - a.ts);
    return candidates[0]?.sessionId || "";
  } catch {
    return "";
  }
}

function scheduleCronSessionTranscriptScrub(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  api: any,
  stateDir: string,
  sessionKey: string,
  sessionId: string,
): void {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!key && !id) return;
  const timerKey = key || id;
  const existing = timers.get(timerKey);
  if (existing) clearTimeout(existing);
  let attempts = 0;
  const maxAttempts = 20;
  const probe = () => {
    const resolvedSessionId = id || resolveLatestSessionIdForKey(stateDir, key);
    const transcriptChanged = resolvedSessionId ? scrubCronSessionTranscript(stateDir, resolvedSessionId) : false;
    const indexChanged = scrubCronSessionIndex(stateDir, key, resolvedSessionId);
    if (transcriptChanged || indexChanged) {
      timers.delete(timerKey);
      if (transcriptChanged && resolvedSessionId) {
        api.logger.info(`${PLUGIN_NAME}: cron_transcript SCRUB-THINKING (session=${resolvedSessionId})`);
      }
      if (indexChanged) {
        api.logger.info(`${PLUGIN_NAME}: cron_session_index CLEAR-HEARTBEAT-TEXT (session=${resolvedSessionId || "unknown"}, key=${key || "unknown"})`);
      }
      return;
    }
    attempts += 1;
    if (attempts >= maxAttempts) {
      timers.delete(timerKey);
      return;
    }
    const nextTimer = setTimeout(probe, 500);
    timers.set(timerKey, nextTimer);
  };
  const timer = setTimeout(probe, 500);
  timers.set(timerKey, timer);
}

function runHeartbeatDecision(script: string, env: Record<string, string>): { decision: string; reason?: string } | null {
  const now = new Date().toISOString();
  const raw = runSkillCommand(script, ["heartbeat-decision", "--timestamp", now], env, 5000);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      decision: typeof data?.decision === "string" ? data.decision : "internal_noop",
      reason: typeof data?.reason === "string" ? data.reason : undefined,
    };
  } catch {
    return null;
  }
}

function runHeartbeatRenderDetailed(script: string, env: Record<string, string>, commit = false): HeartbeatRenderResult {
  const now = new Date().toISOString();
  const args = ["heartbeat-render", "--timestamp", now];
  if (commit) args.push("--commit");
  const result = runSkillCommandResult(script, args, env, 15000);
  if (!result.ok) return result;
  try {
    const data = JSON.parse(result.raw);
    return {
      ok: true,
      data: {
        decision: typeof data?.decision === "string" ? data.decision : "internal_noop",
        reason: typeof data?.reason === "string" ? data.reason : undefined,
        rendered_text: typeof data?.rendered_text === "string" ? data.rendered_text.trim() : "",
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      kind: "invalid-json",
      message: compactLogText(String(err?.message || err || "")),
      raw: compactLogText(result.raw, 240),
    };
  }
}

function runHeartbeatRender(script: string, env: Record<string, string>, commit = false): { decision: string; reason?: string; rendered_text: string } | null {
  const result = runHeartbeatRenderDetailed(script, env, commit);
  return result.ok ? result.data : null;
}

function runCommitmentCapture(
  script: string,
  env: Record<string, string>,
  text: string,
  sessionKey: string,
): void {
  const value = typeof text === "string" ? text.trim() : "";
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!value || !key) return;
  const now = new Date().toISOString();
  runSkillCommand(
    script,
    ["capture-commitment", "--text", value, "--session-key", key, "--timestamp", now],
    env,
    2000,
  );
}

function runAckDelivery(
  script: string,
  env: Record<string, string>,
  {
    sessionKey,
    content,
    channel,
  }: {
    sessionKey: string;
    content: string;
    channel: string;
  },
): void {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const value = typeof content === "string" ? content.trim() : "";
  if (!key || !value) return;
  const now = new Date().toISOString();
  const args = [
    "ack-delivery",
    "--session-key",
    key,
    "--message",
    value,
    "--timestamp",
    now,
  ];
  if (channel) args.push("--channel", channel);
  runSkillCommand(script, args, env, 4000);
}

function deliveryAckKeys(sessionKey: string, conversationId: string): string[] {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  return Array.from(keys);
}

function parseGatewayLogTimestampMs(line: string): number {
  const match = String(line || "").match(/^(\d{4}-\d{2}-\d{2}T\S+)/);
  if (!match) return 0;
  const value = Date.parse(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function readGatewayLogTail(stateDir: string, lineCount = GATEWAY_LOG_TAIL_LINES): string[] {
  const logPath = join(stateDir, "logs", "gateway.log");
  if (!existsSync(logPath)) return [];
  try {
    const output = execFileSync("tail", ["-n", String(lineCount), logPath], {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function gatewayLogHasTelegramSendOk(
  stateDir: string,
  conversationId: string,
  createdAtMs: number,
): boolean {
  const chat = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!chat) return false;
  const lowerBound = createdAtMs - 1_000;
  return readGatewayLogTail(stateDir).some((line) => {
    if (!line.includes("[telegram] sendMessage ok")) return false;
    if (!line.includes(`chat=${chat}`)) return false;
    const ts = parseGatewayLogTimestampMs(line);
    return ts > 0 && ts >= lowerBound;
  });
}

function runNewSessionFallback(
  script: string,
  env: Record<string, string>,
  sessionKey: string,
  sessionId: string,
): { text: string; anchorLevel: string; anchorSource: string } | null {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!key) return null;
  const now = new Date().toISOString();
  const args = ["new-session-fallback", "--session-key", key, "--timestamp", now];
  if (sessionId) args.push("--session-id", sessionId);
  const raw = runSkillCommand(
    script,
    args,
    env,
    5000,
  );
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return null;
    return {
      text,
      anchorLevel: typeof data?.anchor_level === "string" ? data.anchor_level.trim() : "",
      anchorSource: typeof data?.anchor_source === "string" ? data.anchor_source.trim() : "",
    };
  } catch {
    return null;
  }
}

function looksLikeGenericNewSessionReply(content: any): boolean {
  if (!Array.isArray(content)) return false;
  const text = content
    .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
    .map((item: any) => item.text)
    .join("\n")
    .trim();
  if (!text) return false;
  return /(?:\bfresh session\b|\bnew session\b|openclaw assistant|what'?s on your mind today|what can i help|today\?|有什麼我可以幫|開始(?:一個)?新的(?:對話|話題)|新的(?:對話|話題)|清空之前的對話脈絡|今天想做些什麼|今天想做什麼|有什麼想聊的|需要我幫忙的嗎|想聊什麼|想從哪裡開始)/i.test(
    text,
  );
}

function fallbackConversationKey(sessionKey: string): string {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!key) return "";
  const parts = key.split(":").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

type BmwFallbackEntry = {
  text: string;
  createdAt: number;
};

type BmwFallbackGateEntry = {
  userTurnId: number;
  fallbackTurnId: number;
};

type RecentUserTextEntry = {
  text: string;
  updatedAt: number;
};

type PreservedRuntimeReplyEntry = {
  createdAt: number;
};

type FrontstageReplyEntry = {
  createdAt: number;
  text: string;
};

type HeartbeatRenderEntry = {
  createdAt: number;
  decision: string;
  reason?: string;
  renderedText: string;
};

type DeliveryAckEntry = {
  createdAt: number;
  content: string;
  channel: string;
  sessionKey: string;
  conversationId: string;
};

const BMW_FALLBACK_TTL_MS = 10_000;
const RECENT_USER_TEXT_TTL_MS = 15 * 60_000;
const PRESERVED_RUNTIME_REPLY_TTL_MS = 30_000;
const FRONTSTAGE_REPLY_TTL_MS = 30_000;
const HEARTBEAT_RENDER_TTL_MS = 30_000;
const DELIVERY_ACK_TTL_MS = 60_000;
const DELIVERY_ACK_POLL_MS = 1_500;
const DELIVERY_ACK_MAX_WAIT_MS = 15_000;
const GATEWAY_LOG_TAIL_LINES = 200;

function isTelegramDirectSessionKey(sessionKey: string): boolean {
  const value = typeof sessionKey === "string" ? sessionKey.trim() : "";
  return value.includes(":telegram:direct:");
}

function isUserFacingTelegramDirectSession(ctx: any, sessionKey: string): boolean {
  const value = typeof sessionKey === "string" ? sessionKey.trim() : "";
  return isTelegramDirectSessionKey(value) && canUseFrontstageSessionCache(ctx, value);
}

function looksLikeRuntimeGenericErrorText(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;
  return /^⚠️?\s*Agent couldn't generate a response\.(?:\s*Note:\s*some tool actions may have already been executed\s*[—-]\s*please verify before retrying\.)?$/i.test(
    value,
  );
}

function rememberBmwFallback(stash: Map<string, BmwFallbackEntry>, sessionKey: string, text: string): void {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return;
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (session) keys.add(`session:${session}`);
  const conversation = fallbackConversationKey(session);
  if (conversation) keys.add(`conversation:${conversation}`);
  const entry: BmwFallbackEntry = {
    text: value,
    createdAt: Date.now(),
  };
  for (const key of keys) stash.set(key, entry);
}

function clearBmwFallback(stash: Map<string, BmwFallbackEntry>, sessionKey: string, conversationId: string): void {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  for (const key of keys) stash.delete(key);
}

function takeBmwFallback(stash: Map<string, BmwFallbackEntry>, sessionKey: string, conversationId: string): string | undefined {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  for (const key of keys) {
    const entry = stash.get(key);
    if (!entry) continue;
    for (const cleanupKey of keys) stash.delete(cleanupKey);
    if (Date.now() - entry.createdAt > BMW_FALLBACK_TTL_MS) {
      return undefined;
    }
    return entry.text;
  }
  return undefined;
}

function markBmwUserTurn(gate: Map<string, BmwFallbackGateEntry>, sessionKey: string): void {
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!session) return;
  const prev = gate.get(session);
  gate.set(session, {
    userTurnId: (prev?.userTurnId || 0) + 1,
    fallbackTurnId: prev?.fallbackTurnId || 0,
  });
}

function rememberRecentUserText(store: Map<string, RecentUserTextEntry>, sessionKey: string, text: string): void {
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const value = typeof text === "string" ? text.trim() : "";
  if (!session || !value || looksLikeInternalControlText(value)) return;
  store.set(session, {
    text: value.slice(0, 240),
    updatedAt: Date.now(),
  });
}

function readRecentUserText(store: Map<string, RecentUserTextEntry>, sessionKey: string): string {
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!session) return "";
  const entry = store.get(session);
  if (!entry) return "";
  if (Date.now() - entry.updatedAt > RECENT_USER_TEXT_TTL_MS) {
    store.delete(session);
    return "";
  }
  return entry.text;
}

function rememberPreservedRuntimeReply(
  store: Map<string, PreservedRuntimeReplyEntry>,
  sessionKey: string,
  conversationId: string,
): void {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  const entry: PreservedRuntimeReplyEntry = { createdAt: Date.now() };
  for (const key of keys) store.set(key, entry);
}

function takePreservedRuntimeReply(
  store: Map<string, PreservedRuntimeReplyEntry>,
  sessionKey: string,
  conversationId: string,
): boolean {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  for (const key of keys) {
    const entry = store.get(key);
    if (!entry) continue;
    for (const cleanupKey of keys) store.delete(cleanupKey);
    if (Date.now() - entry.createdAt > PRESERVED_RUNTIME_REPLY_TTL_MS) {
      return false;
    }
    return true;
  }
  return false;
}

function rememberFrontstageReply(
  store: Map<string, FrontstageReplyEntry>,
  sessionKey: string,
  conversationId: string,
  text: string,
): void {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return;
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  const entry: FrontstageReplyEntry = { createdAt: Date.now(), text: value };
  for (const key of keys) store.set(key, entry);
}

function takeFrontstageReply(
  store: Map<string, FrontstageReplyEntry>,
  sessionKey: string,
  conversationId: string,
): FrontstageReplyEntry | null {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  for (const key of keys) {
    const entry = store.get(key);
    if (!entry) continue;
    for (const cleanupKey of keys) store.delete(cleanupKey);
    if (Date.now() - entry.createdAt > FRONTSTAGE_REPLY_TTL_MS) {
      return null;
    }
    return entry;
  }
  return null;
}

function rememberHeartbeatRender(
  store: Map<string, HeartbeatRenderEntry>,
  sessionKey: string,
  conversationId: string,
  rendered: { decision: string; reason?: string; rendered_text: string } | null,
): void {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  const entry: HeartbeatRenderEntry = {
    createdAt: Date.now(),
    decision: typeof rendered?.decision === "string" ? rendered.decision : "unknown",
    reason: typeof rendered?.reason === "string" ? rendered.reason : undefined,
    renderedText: typeof rendered?.rendered_text === "string" ? rendered.rendered_text.trim() : "",
  };
  for (const key of keys) store.set(key, entry);
}

function takeHeartbeatRender(
  store: Map<string, HeartbeatRenderEntry>,
  sessionKey: string,
  conversationId: string,
): HeartbeatRenderEntry | null {
  const keys = new Set<string>();
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (session) keys.add(`session:${session}`);
  if (conversation) keys.add(`conversation:${conversation}`);
  const derivedConversation = fallbackConversationKey(session);
  if (derivedConversation) keys.add(`conversation:${derivedConversation}`);
  for (const key of keys) {
    const entry = store.get(key);
    if (!entry) continue;
    for (const cleanupKey of keys) store.delete(cleanupKey);
    if (Date.now() - entry.createdAt > HEARTBEAT_RENDER_TTL_MS) {
      return null;
    }
    return entry;
  }
  return null;
}

function rememberDeliveryAck(
  store: Map<string, DeliveryAckEntry>,
  sessionKey: string,
  conversationId: string,
  content: string,
  channel: string,
): string {
  const value = typeof content === "string" ? content.trim() : "";
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const conversation = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!value) return "";
  const entry: DeliveryAckEntry = {
    createdAt: Date.now(),
    content: value,
    channel: typeof channel === "string" ? channel.trim() : "",
    sessionKey: session,
    conversationId: conversation,
  };
  for (const key of deliveryAckKeys(session, conversation)) store.set(key, entry);
  if (conversation) return `conversation:${conversation}`;
  if (session) return `session:${session}`;
  return "";
}

function peekDeliveryAck(
  store: Map<string, DeliveryAckEntry>,
  sessionKey: string,
  conversationId: string,
): DeliveryAckEntry | null {
  for (const key of deliveryAckKeys(sessionKey, conversationId)) {
    const entry = store.get(key);
    if (!entry) continue;
    if (Date.now() - entry.createdAt > DELIVERY_ACK_TTL_MS) {
      return null;
    }
    return entry;
  }
  return null;
}

function clearDeliveryAck(
  store: Map<string, DeliveryAckEntry>,
  sessionKey: string,
  conversationId: string,
): void {
  for (const key of deliveryAckKeys(sessionKey, conversationId)) {
    store.delete(key);
  }
}

function scheduleTelegramDeliveryAck(
  api: any,
  stateDir: string,
  dataDir: string,
  script: string,
  env: Record<string, string>,
  store: Map<string, DeliveryAckEntry>,
  timers: Map<string, ReturnType<typeof setTimeout>>,
  sessionKey: string,
  conversationId: string,
): void {
  const session = String(sessionKey || "").trim();
  const conversation = String(conversationId || "").trim();
  const timerKey = conversation
    ? `conversation:${conversation}`
    : (session ? `session:${session}` : "");
  if (!timerKey) return;
  const existing = timers.get(timerKey);
  if (existing) {
    clearTimeout(existing);
    timers.delete(timerKey);
  }

  const runProbe = () => {
    const entry = peekDeliveryAck(store, sessionKey, conversationId);
    if (!entry) {
      timers.delete(timerKey);
      clearDeliveryAck(store, sessionKey, conversationId);
      return;
    }
    if (gatewayLogHasTelegramSendOk(stateDir, entry.conversationId || conversationId, entry.createdAt)) {
      clearDeliveryAck(store, sessionKey, conversationId);
      timers.delete(timerKey);
      runAckDelivery(script, env, {
        sessionKey: entry.sessionKey || sessionKey,
        content: entry.content,
        channel: entry.channel || "telegram",
      });
      appendFrontstageBridgeAudit(dataDir, {
        phase: "delivery_probe",
        event: "ack-delivery",
        sessionKey: entry.sessionKey || sessionKey,
        channel: entry.channel || "telegram",
        deliveredLength: entry.content.length,
      });
      api.logger.info(
        `${PLUGIN_NAME}: delivery_probe ACK-DELIVERY (channel=${entry.channel || "telegram"}, len=${entry.content.length})`,
      );
      return;
    }
    if (Date.now() - entry.createdAt >= DELIVERY_ACK_MAX_WAIT_MS) {
      clearDeliveryAck(store, sessionKey, conversationId);
      timers.delete(timerKey);
      appendFrontstageBridgeAudit(dataDir, {
        phase: "delivery_probe",
        event: "delivery-timeout",
        sessionKey: entry.sessionKey || sessionKey,
        channel: entry.channel || "telegram",
        pendingLength: entry.content.length,
      });
      api.logger.info(
        `${PLUGIN_NAME}: delivery_probe DELIVERY-TIMEOUT (channel=${entry.channel || "telegram"}, len=${entry.content.length})`,
      );
      return;
    }
    const nextTimer = setTimeout(runProbe, DELIVERY_ACK_POLL_MS);
    timers.set(timerKey, nextTimer);
  };

  const timer = setTimeout(runProbe, DELIVERY_ACK_POLL_MS);
  timers.set(timerKey, timer);
}

function ackLocalTranscriptDelivery(
  api: any,
  dataDir: string,
  script: string,
  env: Record<string, string>,
  {
    sessionKey,
    conversationId,
    content,
    channel,
  }: {
    sessionKey: string;
    conversationId: string;
    content: string;
    channel: string;
  },
): void {
  const value = typeof content === "string" ? content.trim() : "";
  if (!value) return;
  runAckDelivery(script, env, {
    sessionKey,
    content: value,
    channel: channel || "local-transcript",
  });
  appendFrontstageBridgeAudit(dataDir, {
    phase: "local_delivery",
    event: "ack-delivery",
    sessionKey,
    channel: channel || "local-transcript",
    deliveredLength: value.length,
  });
  api.logger.info(
    `${PLUGIN_NAME}: local_delivery ACK-DELIVERY (channel=${channel || "local-transcript"}, len=${value.length})`,
  );
}

function looksEnglishOnlyText(text: string): boolean {
  const value = typeof text === "string" ? text.trim() : "";
  return Boolean(value) && /^[\x00-\x7F]+$/.test(value) && /[A-Za-z]/.test(value);
}

function buildRuntimeEmptyRecoveryText(userText: string): string {
  const value = typeof userText === "string" ? userText.trim() : "";
  const questionLike =
    /[?？]$/.test(value) ||
    /(?:睡了嗎|睡了吗|在嗎|在吗|還在嗎|还在吗|記得嗎|记得吗|好嗎|好吗|可以嗎|可以吗|要不要|是不是)$/i.test(value);
  if (looksEnglishOnlyText(value)) {
    return questionLike
      ? "I'm here. That reply didn't land cleanly. Ask me again and I'll pick it up."
      : "I'm here. That reply didn't land cleanly. Say it again and I'll pick it up.";
  }
  return questionLike
    ? "我在，剛剛這句沒接穩。你再問我一次，我接著你。"
    : "我在，剛剛這句沒接穩。你再說一次，我接著你。";
}

function recoverPreservedRuntimeReply(
  script: string,
  env: Record<string, string>,
  text: string,
): string | null {
  const precleaned = stripHostFrontstageLeakage(text);
  if (!precleaned) return null;
  if (looksLikeRuntimeFragmentBundle(precleaned)) return null;
  const blocks = precleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const block of blocks) {
    if (/(?:^|[\s(])(?:memory|data|workspace)\/[^\s)]+\.(?:md|json|jsonl|txt)\b/i.test(block)) {
      continue;
    }
    if (looksLikeUnresolvedReferentFragment(block)) {
      continue;
    }
    const guarded = runFrontstageGuard(script, env, block, "runtime-reply");
    if (guarded) kept.push(guarded);
  }
  const joined = kept.join("\n\n").trim();
  if (joined && !looksLikeRuntimeFragmentBundle(joined) && !stillLooksInternal(joined) && !looksLikeUnresolvedReferentFragment(joined)) return joined;
  const salvaged = salvageUserFacingPrefix(text);
  return salvaged || null;
}

function shouldEmitBmwFallback(gate: Map<string, BmwFallbackGateEntry>, sessionKey: string): boolean {
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!session) return true;
  const entry = gate.get(session);
  if (!entry) return true;
  if (entry.userTurnId > 0 && entry.fallbackTurnId === entry.userTurnId) return false;
  gate.set(session, {
    userTurnId: entry.userTurnId,
    fallbackTurnId: entry.userTurnId || entry.fallbackTurnId || 0,
  });
  return true;
}

function hasVisibleAssistantText(content: any): boolean {
  const EMPTY_SENTINELS = /^(NO_REPLY|NO_OUTPUT|EMPTY|N\/A|\[empty\]|\[no[_ ]?reply\])$/i;
  return Array.isArray(content) && content.some(
    (b: any) => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0 && !EMPTY_SENTINELS.test(b.text.trim())
  );
}

function assistantVisibleTextLength(content: any): number {
  if (!Array.isArray(content)) return 0;
  return content
    .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
    .map((b: any) => b.text.trim())
    .filter((text: string) => text.length > 0)
    .join("\n")
    .length;
}

function assistantVisibleText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
    .map((b: any) => b.text.trim())
    .filter((text: string) => text.length > 0)
    .join("\n")
    .trim();
}

function hasAssistantToolCallContent(content: any): boolean {
  return Array.isArray(content) && content.some((part: any) => part?.type === "toolCall");
}

function isAssistantToolUsePhase(message: any): boolean {
  if (!message || typeof message !== "object" || message.role !== "assistant") return false;
  const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "";
  return (
    hasAssistantToolCallContent(message?.content) ||
    Boolean(message?.toolCallId) ||
    Boolean(message?.toolName) ||
    /^tooluse$/i.test(stopReason)
  );
}

function isAssistantErrorPhase(message: any): boolean {
  if (!message || typeof message !== "object" || message.role !== "assistant") return false;
  const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "";
  const errorMessage = typeof message?.errorMessage === "string" ? message.errorMessage : "";
  return /^error$/i.test(stopReason) || errorMessage.trim().length > 0;
}

function isInjectedInternalUserMessage(message: any): boolean {
  if (!message || typeof message !== "object" || message.role !== "user") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
  if (!text) return false;
  if (looksLikeInternalControlText(text)) return true;
  if (text.includes("BEGIN_QUOTED_NOTES")) return true;
  if (text.includes("## Selected new-session event state")) return true;
  if (text.includes("## New-session carryover")) return true;
  if (text.includes("## Pending follow-up topics")) return true;
  if (text.includes("## Honest recall guard")) return true;
  if (text.includes("A new session was started via /new or /reset")) return true;
  if (/^\s*Read HEARTBEAT\.md if it exists/i.test(text)) return true;
  return false;
}

function isExplicitNewSessionTurn(event: any, ctx: any): boolean {
  return Boolean(event?.isNewSession) ||
    Boolean(ctx?.isNewSession) ||
    Boolean(event?.metadata?.isNewSession) ||
    Boolean(ctx?.metadata?.isNewSession);
}

function sanitizeAssistantMessage(script: string, env: Record<string, string>, message: any, ctx?: any): any | null {
  if (!message || typeof message !== "object" || message.role !== "assistant") return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;

  let changed = false;
  const sanitized = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      sanitized.push(part);
      continue;
    }
    if (part.type === "thinking") {
      changed = true;
      continue;
    }
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      const guarded = runFrontstageGuard(
        script,
        env,
        part.text,
        frontstageGuardSourceForText(ctx, part.text, "runtime-reply"),
      );
      if (guarded !== part.text) changed = true;
      if (guarded && guarded.trim()) sanitized.push({ ...part, text: guarded });
      else changed = true;
      continue;
    }
    sanitized.push(part);
  }

  if (!changed) return null;
  return { ...message, content: sanitized };
}

export default {
  name: PLUGIN_NAME,
  version: "2.0.5",

  configSchema: {
    parse(value: unknown) {
      return value && typeof value === "object" ? value : {};
    },
  },

  register(api: any) {
    const stateDir = process.env.OPENCLAW_STATE_DIR || join(process.env.HOME || "", ".openclaw");
    const script = findSkillScript(stateDir);

    if (!script) {
      api.logger.warn(`${PLUGIN_NAME}: personal_hooks.py not found; addon inactive`);
      return;
    }

    const dataDir = join(stateDir, "workspace", "personal-hooks");
    const configPath = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, "openclaw.json");
    const cronJobRuntimeIndex = buildCronJobRuntimeIndex(stateDir);
    const configuredLocale = (process.env.PERSONAL_HOOKS_LOCALE || "").trim();
    const skillEnv = {
      PERSONAL_HOOKS_DATA_DIR: dataDir,
      PERSONAL_HOOKS_OPENCLAW_CONFIG_PATH: configPath,
      ...(configuredLocale ? { PERSONAL_HOOKS_LOCALE: configuredLocale } : {}),
    };

    const regMode = api.registrationMode || "unknown";
    api.logger.info(`${PLUGIN_NAME}: active (script=${script}, mode=${regMode})`);

    if (regMode !== "full" && regMode !== "unknown") {
      api.logger.warn(`${PLUGIN_NAME}: ⚠ P0 — registrationMode=${regMode}. ALL hooks disabled.`);
      return;
    }

    const hookResults: Record<string, boolean> = {};

    hookResults["before_prompt_build"] = safeOn(
      api,
      "before_prompt_build",
      (event: any, ctx: any) => {
        const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
        if (!sessionKey || sessionKey.includes(":cron:") || sessionKey.includes(":subagent:")) return;

        const sessionId = typeof ctx?.sessionId === "string" ? ctx.sessionId : "";
        const prompt = typeof event?.prompt === "string" ? event.prompt : "";
        const userText = extractUserTextForRuntimeContext(event, ctx, prompt);
        const isNewSession =
          Boolean(event?.isNewSession) ||
          Boolean(ctx?.isNewSession) ||
          prompt.includes("A new session was started via /new or /reset") ||
          prompt.includes("✅ New session started");
        const runtimeContextArgs = ["runtime-context", "--user-text", userText, "--session-key", sessionKey];
        if (sessionId) runtimeContextArgs.push("--session-id", sessionId);
        if (isNewSession) runtimeContextArgs.push("--is-new-session");

        if (userText !== "context-refresh" && !looksLikeInternalControlText(userText)) {
          rememberRecentUserText(_recentUserTextBySession, sessionKey, userText);
          runSkillCommand(
            script,
            ["preagent-sync", "--text", userText, "--session-key", sessionKey],
            skillEnv,
            5000,
          );
        }

        const raw = runSkillCommand(
          script,
          runtimeContextArgs,
          skillEnv,
          6000,
        );
        if (!raw) return;

        try {
          const data = JSON.parse(raw);
          const blocks: string[] = [];
          if (data.new_session_event_state_prompt) blocks.push(data.new_session_event_state_prompt);
          if (data.carryover_prompt) blocks.push(data.carryover_prompt);
          if (data.pending_topics_prompt) blocks.push(data.pending_topics_prompt);
          if (data.post_new_low_information_prompt) blocks.push(data.post_new_low_information_prompt);
          if (data.time_modifier_prompt) blocks.push(data.time_modifier_prompt);
          if (data.schedule_context_prompt) blocks.push(data.schedule_context_prompt);
          if (data.dispatch_awareness_prompt) blocks.push(data.dispatch_awareness_prompt);
          if (data.active_preferences_prompt) blocks.push(data.active_preferences_prompt);
          if (data.pending_memory_guard_prompt) blocks.push(data.pending_memory_guard_prompt);
          if (data.false_closure_guard_prompt) blocks.push(data.false_closure_guard_prompt);
          if (blocks.length === 0) {
            return { appendSystemContext: FRONTSTAGE_GUARD_SYSTEM_PROMPT };
          }
          return {
            prependContext: blocks.join("\n\n"),
            appendSystemContext: FRONTSTAGE_GUARD_SYSTEM_PROMPT,
          };
        } catch {
          return;
        }
      },
      { priority: 10 },
    );

    const _bmwFallbackStash = new Map<string, BmwFallbackEntry>();
    const _bmwFallbackGate = new Map<string, BmwFallbackGateEntry>();
    const _recentUserTextBySession = new Map<string, RecentUserTextEntry>();
    const _preservedRuntimeReply = new Map<string, PreservedRuntimeReplyEntry>();
    const _frontstageReply = new Map<string, FrontstageReplyEntry>();
    const _heartbeatRender = new Map<string, HeartbeatRenderEntry>();
    const _deliveryAck = new Map<string, DeliveryAckEntry>();
    const _deliveryAckTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const _cronTranscriptScrubTimers = new Map<string, ReturnType<typeof setTimeout>>();

    hookResults["before_message_write"] = safeOn(
      api,
      "before_message_write",
      (event: any, ctx: any) => {
        if (isInjectedInternalUserMessage(event?.message)) {
          markBmwUserTurn(_bmwFallbackGate, typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "");
          api.logger.info(`${PLUGIN_NAME}: before_message_write SUPPRESS-INTERNAL-USER-MSG (session=${ctx?.sessionKey || "unknown"})`);
          return { message: { ...(event?.message || {}), role: "user", content: [] } };
        }
        const cronRuntime = cronSessionRuntimeDescriptor(cronJobRuntimeIndex, ctx);
        if (cronRuntime?.suppressAssistantTranscript) {
          scheduleCronSessionTranscriptScrub(
            _cronTranscriptScrubTimers,
            api,
            stateDir,
            typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "",
            typeof ctx?.sessionId === "string" ? ctx.sessionId : "",
          );
          const strippedCronAssistant = stripAssistantVisibleText(event?.message);
          if (strippedCronAssistant) {
            api.logger.info(`${PLUGIN_NAME}: before_message_write CRON-SUPPRESS-ASSISTANT-TEXT (session=${ctx?.sessionKey || "unknown"})`);
            return { message: strippedCronAssistant };
          }
        }
        if (isHeartbeatSession(ctx)) {
          const message = event?.message || {};
          const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
          const conversationId = typeof ctx?.conversationId === "string"
            ? ctx.conversationId
            : (event?.to != null ? String(event.to) : "");
          const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "";
          const heartbeatToolUsePhase =
            Boolean(message?.toolCallId) ||
            Boolean(message?.toolName) ||
            /^tooluse$/i.test(stopReason);
          if (heartbeatToolUsePhase) {
            return { message: { ...message, role: "assistant", content: [] } };
          }
          const renderedResult = runHeartbeatRenderDetailed(script, skillEnv, true);
          const rendered = renderedResult.ok ? renderedResult.data : null;
          rememberHeartbeatRender(_heartbeatRender, sessionKey, conversationId, rendered);
          if (!renderedResult.ok) {
            const renderReason = renderedResult.kind === "timeout"
              ? "render-timeout"
              : renderedResult.kind === "invalid-json"
                ? "render-invalid-json"
                : renderedResult.kind === "empty-output"
                  ? "render-empty-output"
                  : "render-exec-failed";
            const statusPart = "status" in renderedResult && renderedResult.status != null ? `, status=${renderedResult.status}` : "";
            const signalPart = "signal" in renderedResult && renderedResult.signal ? `, signal=${renderedResult.signal}` : "";
            const detailPart = renderedResult.message ? `, detail=${renderedResult.message}` : "";
            api.logger.warn(
              `${PLUGIN_NAME}: heartbeat-render failure (reason=${renderReason}${statusPart}${signalPart}${detailPart})`,
            );
            const decisionOnly = renderedResult.kind === "timeout" ? null : runHeartbeatDecision(script, skillEnv);
            if (decisionOnly) {
              const reason =
                decisionOnly.decision === "none" || decisionOnly.decision === "internal_noop"
                  ? (decisionOnly.reason || "unknown")
                  : renderReason;
              api.logger.info(
                `${PLUGIN_NAME}: before_message_write HEARTBEAT_SUPPRESS (decision=${decisionOnly.decision}, reason=${reason})`,
              );
            } else {
              api.logger.info(`${PLUGIN_NAME}: before_message_write HEARTBEAT_SUPPRESS (decision=unknown, reason=${renderReason})`);
            }
            return { message: { ...(event?.message || {}), role: "assistant", content: [] } };
          }
          if (!rendered.rendered_text) {
            api.logger.info(`${PLUGIN_NAME}: before_message_write HEARTBEAT_SUPPRESS (decision=${rendered.decision}, reason=${rendered.reason || "unknown"})`);
            return { message: { ...(event?.message || {}), role: "assistant", content: [] } };
          }
          ackLocalTranscriptDelivery(api, dataDir, script, skillEnv, {
            sessionKey,
            conversationId,
            content: rendered.rendered_text,
            channel: "local-transcript",
          });
          return {
            message: {
              ...(event?.message || {}),
              role: "assistant",
              content: [{ type: "text", text: rendered.rendered_text }],
            },
          };
        }
        const message = event?.message;
        const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
        const sessionId = typeof ctx?.sessionId === "string" ? ctx.sessionId : "";
        const conversationId = typeof ctx?.conversationId === "string"
          ? ctx.conversationId
          : (event?.to != null ? String(event.to) : "");
        const content = message?.content;
        const hasVisibleText = hasVisibleAssistantText(content);
        const assistantToolUsePhase = isAssistantToolUsePhase(message);
        const assistantErrorPhase = isAssistantErrorPhase(message);
        const canCacheFrontstage = canUseFrontstageSessionCache(ctx, sessionKey);
        const isDirectTelegramSession = isUserFacingTelegramDirectSession(ctx, sessionKey);
        const allowNewSessionFallback = isExplicitNewSessionTurn(event, ctx);
        const newSessionFallback = allowNewSessionFallback
          ? runNewSessionFallback(script, skillEnv, sessionKey, sessionId)
          : null;
        const shouldOverrideGenericNewSession =
          allowNewSessionFallback &&
          !assistantErrorPhase &&
          !assistantToolUsePhase &&
          message?.role === "assistant" &&
          Array.isArray(content) &&
          hasVisibleText &&
          looksLikeGenericNewSessionReply(content) &&
          newSessionFallback &&
          newSessionFallback.text &&
          newSessionFallback.anchorLevel &&
          newSessionFallback.anchorLevel !== "neutral" &&
          newSessionFallback.anchorSource &&
          newSessionFallback.anchorSource !== "neutral";
        if (shouldOverrideGenericNewSession) {
          appendFrontstageBridgeAudit(dataDir, {
            phase: "before_message_write",
            event: "new-session-override",
            sessionKey,
            anchorLevel: newSessionFallback?.anchorLevel || "",
            anchorSource: newSessionFallback?.anchorSource || "",
          });
          api.logger.info(
            `${PLUGIN_NAME}: before_message_write NEW-SESSION-OVERRIDE (session=${sessionKey || "unknown"}, anchor=${newSessionFallback.anchorSource}/${newSessionFallback.anchorLevel})`,
          );
          if (canCacheFrontstage) {
            rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, newSessionFallback.text);
          }
          return {
            message: {
              ...(message || {}),
              role: "assistant",
              content: [{ type: "text", text: newSessionFallback.text }],
            },
          };
        }
        if (allowNewSessionFallback && !assistantErrorPhase && !assistantToolUsePhase && message?.role === "assistant" && Array.isArray(content) && !hasVisibleText) {
          if (newSessionFallback?.text) {
            if (!shouldEmitBmwFallback(_bmwFallbackGate, sessionKey)) {
              return { message: { ...(message || {}), role: "assistant", content: [] } };
            }
            rememberBmwFallback(_bmwFallbackStash, sessionKey, newSessionFallback.text);
            appendFrontstageBridgeAudit(dataDir, {
              phase: "before_message_write",
              event: "new-session-fallback",
              sessionKey,
              anchorLevel: newSessionFallback.anchorLevel || "",
              anchorSource: newSessionFallback.anchorSource || "",
              fallbackLength: newSessionFallback.text.length,
            });
            api.logger.info(`${PLUGIN_NAME}: before_message_write NEW-SESSION-FALLBACK (session=${sessionKey || "unknown"})`);
            if (canCacheFrontstage) {
              rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, newSessionFallback.text);
            }
            return {
              message: {
                ...(message || {}),
                role: "assistant",
                content: [{ type: "text", text: newSessionFallback.text }],
              },
            };
          }
        }
        if (
          isDirectTelegramSession &&
          message?.role === "assistant" &&
          Array.isArray(content) &&
          !hasVisibleText &&
          !assistantToolUsePhase &&
          !assistantErrorPhase &&
          !allowNewSessionFallback
        ) {
          const recentUserText = readRecentUserText(_recentUserTextBySession, sessionKey);
          const recoveryText = buildRuntimeEmptyRecoveryText(recentUserText);
          appendFrontstageBridgeAudit(dataDir, {
            phase: "before_message_write",
            event: "runtime-empty-recover",
            sessionKey,
            channel: ctx?.channelId || "unknown",
            recentUserText,
            recoveryLength: recoveryText.length,
          });
          api.logger.info(
            `${PLUGIN_NAME}: before_message_write RUNTIME-EMPTY-RECOVER (session=${sessionKey || "unknown"}, len=${recoveryText.length})`,
          );
          if (canCacheFrontstage) {
            rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, recoveryText);
          }
          return {
            message: {
              ...(message || {}),
              role: "assistant",
              content: [{ type: "text", text: recoveryText }],
            },
          };
        }
        const sanitized = sanitizeAssistantMessage(script, skillEnv, event?.message, ctx);
        if (!sanitized) return;
        const originalVisibleText =
          message?.role === "assistant" && Array.isArray(message?.content)
            ? assistantVisibleText(message.content)
            : "";
        if (
          message?.role === "assistant" &&
          Array.isArray(message?.content) &&
          hasVisibleAssistantText(message.content) &&
          Array.isArray(sanitized?.content) &&
          !hasVisibleAssistantText(sanitized.content)
        ) {
          const recentUserText = readRecentUserText(_recentUserTextBySession, sessionKey);
          const originalLooksInternal =
            stillLooksInternal(originalVisibleText) ||
            containsHeartbeatOperatorNarrative(originalVisibleText) ||
            (isHeartbeatSession(ctx) && looksLikeHeartbeatNarration(originalVisibleText));
          const recoverableCandidate =
            recentUserText && !originalLooksInternal
              ? (
                  runFrontstageGuard(script, skillEnv, originalVisibleText, "runtime-reply") ||
                  salvageUserFacingPrefix(originalVisibleText)
                )
              : "";
          if (originalLooksInternal || !recentUserText || !recoverableCandidate) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "before_message_write",
              event: "drop-original-after-empty-sanitize",
              sessionKey,
              channel: ctx?.channelId || "unknown",
              source: "runtime-reply",
              originalLength: originalVisibleText.length,
              reason: originalLooksInternal
                ? "internal-or-operator-narrative"
                : (!recentUserText ? "no-recent-user-text" : "not-recoverable-user-facing-reply"),
            });
            api.logger.info(
              `${PLUGIN_NAME}: before_message_write DROP-ORIGINAL-AFTER-EMPTY-SANITIZE (session=${sessionKey || "unknown"})`,
            );
            return {
              message: {
                ...(sanitized || message || {}),
                role: "assistant",
                content: [],
              },
            };
          }
          appendFrontstageBridgeAudit(dataDir, {
            phase: "before_message_write",
            event: "preserve-original-after-empty-sanitize",
            sessionKey,
            channel: ctx?.channelId || "unknown",
            source: "runtime-reply",
            originalLength: originalVisibleText.length,
          });
          if (isDirectTelegramSession) {
            rememberPreservedRuntimeReply(
              _preservedRuntimeReply,
              sessionKey,
              typeof ctx?.conversationId === "string"
                ? ctx.conversationId
                : (event?.to != null ? String(event.to) : ""),
            );
          }
          api.logger.info(
            `${PLUGIN_NAME}: before_message_write PRESERVE-ORIGINAL-AFTER-EMPTY-SANITIZE (session=${sessionKey || "unknown"})`,
          );
          if (canCacheFrontstage) {
            rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, originalVisibleText);
          }
          return { message };
        }
        if (allowNewSessionFallback && !assistantErrorPhase && !assistantToolUsePhase && message?.role === "assistant" && Array.isArray(sanitized?.content) && !hasVisibleAssistantText(sanitized.content)) {
          if (newSessionFallback?.text) {
            if (!shouldEmitBmwFallback(_bmwFallbackGate, sessionKey)) {
              return { message: { ...(sanitized || message || {}), role: "assistant", content: [] } };
            }
            rememberBmwFallback(_bmwFallbackStash, sessionKey, newSessionFallback.text);
            appendFrontstageBridgeAudit(dataDir, {
              phase: "before_message_write",
              event: "new-session-fallback-after-guard",
              sessionKey,
              anchorLevel: newSessionFallback.anchorLevel || "",
              anchorSource: newSessionFallback.anchorSource || "",
              fallbackLength: newSessionFallback.text.length,
            });
            api.logger.info(`${PLUGIN_NAME}: before_message_write NEW-SESSION-FALLBACK-AFTER-GUARD (session=${sessionKey || "unknown"})`);
            if (canCacheFrontstage) {
              rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, newSessionFallback.text);
            }
            return {
              message: {
                ...(message || {}),
                role: "assistant",
                content: [{ type: "text", text: newSessionFallback.text }],
              },
            };
          }
        }
        if (!sanitized) {
          if (message?.role === "assistant" && Array.isArray(content) && hasVisibleText) {
            if (canCacheFrontstage) {
              rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, assistantVisibleText(content));
            }
          }
          return;
        }
        if (Array.isArray(sanitized?.content) && hasVisibleAssistantText(sanitized.content)) {
          if (canCacheFrontstage) {
            rememberFrontstageReply(_frontstageReply, sessionKey, conversationId, assistantVisibleText(sanitized.content));
          }
        }
        return { message: sanitized };
      },
      { priority: 20 },
    );

    hookResults["message_sending"] = safeOn(
      api,
      "message_sending",
      (event: any, ctx: any) => {
        const content = event?.content;
        const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
        const conversationId = typeof ctx?.conversationId === "string"
          ? ctx.conversationId
          : (event?.to != null ? String(event.to) : "");
        const canCacheFrontstage = canUseFrontstageSessionCache(ctx, sessionKey);
        const isDirectTelegramSession = isUserFacingTelegramDirectSession(ctx, sessionKey);
        if (typeof content !== "string" || !content.trim()) {
          const stashed = takeBmwFallback(_bmwFallbackStash, sessionKey, conversationId);
          if (stashed) {
            api.logger.info(`${PLUGIN_NAME}: message_sending INJECT-BMW-FALLBACK (channel=${event?.metadata?.channel || ctx?.channelId || "unknown"}, len=${stashed.length})`);
            return { content: stashed };
          }
          if (isDirectTelegramSession && !isHeartbeatSession(ctx)) {
            const recoveryText = buildRuntimeEmptyRecoveryText(readRecentUserText(_recentUserTextBySession, sessionKey));
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "runtime-empty-send-recover",
              sessionKey,
              channel: event?.metadata?.channel || ctx?.channelId || "unknown",
              recoveredLength: recoveryText.length,
            });
            api.logger.info(
              `${PLUGIN_NAME}: message_sending RUNTIME-EMPTY-SEND-RECOVER (channel=${event?.metadata?.channel || ctx?.channelId || "unknown"}, len=${recoveryText.length})`,
            );
            return { content: recoveryText };
          }
          return;
        }
        const channel = event?.metadata?.channel || ctx?.channelId || "unknown";
        const precleanedContent = stripHostFrontstageLeakage(content);

        if (
          channel === "telegram" &&
          !sessionKey &&
          (
            !precleanedContent ||
            looksLikeRuntimeFragmentBundle(precleanedContent) ||
            looksLikeHeartbeatNarration(content) ||
            containsHeartbeatOperatorNarrative(content) ||
            stillLooksInternal(content)
          )
        ) {
          appendFrontstageBridgeAudit(dataDir, {
            phase: "message_sending",
            event: "cancel-empty-provenance-runtime-reply",
            sessionKey,
            channel,
            source: "runtime-reply",
            reason: "empty-session-provenance",
            originalLength: content.length,
          });
          api.logger.info(
            `${PLUGIN_NAME}: message_sending CANCEL-EMPTY-PROVENANCE-RUNTIME-REPLY (channel=${channel}, original_len=${content.length})`,
          );
          return { cancel: true };
        }

        const heartbeatRendered = takeHeartbeatRender(_heartbeatRender, sessionKey, conversationId);
        if (heartbeatRendered) {
          if (!heartbeatRendered.renderedText) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "cancel-heartbeat-render",
              sessionKey,
              channel,
              decision: heartbeatRendered.decision,
              reason: heartbeatRendered.reason || "empty-render",
              originalLength: content.length,
            });
            api.logger.info(
              `${PLUGIN_NAME}: message_sending CANCEL-HEARTBEAT-RENDER (channel=${channel}, decision=${heartbeatRendered.decision}, reason=${heartbeatRendered.reason || "empty-render"})`,
            );
            return { cancel: true };
          }
          if (heartbeatRendered.renderedText !== content) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "heartbeat-render",
              sessionKey,
              channel,
              decision: heartbeatRendered.decision,
              reason: heartbeatRendered.reason || "",
              originalLength: content.length,
              renderedLength: heartbeatRendered.renderedText.length,
            });
            api.logger.info(
              `${PLUGIN_NAME}: message_sending HEARTBEAT-RENDER (channel=${channel}, ${content.length}→${heartbeatRendered.renderedText.length}, decision=${heartbeatRendered.decision})`,
            );
            if (channel === "telegram") {
              rememberDeliveryAck(_deliveryAck, sessionKey, conversationId, heartbeatRendered.renderedText, channel);
              scheduleTelegramDeliveryAck(
                api,
                stateDir,
                dataDir,
                script,
                skillEnv,
                _deliveryAck,
                _deliveryAckTimers,
                sessionKey,
                conversationId,
              );
            }
            return { content: heartbeatRendered.renderedText };
          }
          if (channel === "telegram") {
            rememberDeliveryAck(_deliveryAck, sessionKey, conversationId, content, channel);
            scheduleTelegramDeliveryAck(
              api,
              stateDir,
              dataDir,
              script,
              skillEnv,
              _deliveryAck,
              _deliveryAckTimers,
              sessionKey,
              conversationId,
            );
          }
          return;
        }

        const frontstageReply = canCacheFrontstage
          ? takeFrontstageReply(_frontstageReply, sessionKey, conversationId)
          : null;
        if (frontstageReply && canCacheFrontstage) {
          if (frontstageReply.text !== content) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "sync-frontstage-reply",
              sessionKey,
              channel,
              originalLength: content.length,
              syncedLength: frontstageReply.text.length,
            });
            api.logger.info(
              `${PLUGIN_NAME}: message_sending SYNC-FRONTSTAGE-REPLY (channel=${channel}, ${content.length}→${frontstageReply.text.length})`,
            );
            if (sessionKey) {
              runCommitmentCapture(script, skillEnv, frontstageReply.text, sessionKey);
            }
            return { content: frontstageReply.text };
          }
          if (sessionKey) {
            runCommitmentCapture(script, skillEnv, frontstageReply.text, sessionKey);
          }
          return;
        }

        if (isDirectTelegramSession && looksLikeRuntimeGenericErrorText(content)) {
          const recoveryText = buildRuntimeEmptyRecoveryText(readRecentUserText(_recentUserTextBySession, sessionKey));
          appendFrontstageBridgeAudit(dataDir, {
            phase: "message_sending",
            event: "replace-runtime-generic-error",
            sessionKey,
            channel,
            originalLength: content.length,
            recoveredLength: recoveryText.length,
          });
          api.logger.info(
            `${PLUGIN_NAME}: message_sending REPLACE-RUNTIME-GENERIC-ERROR (channel=${channel}, original_len=${content.length}, recovered_len=${recoveryText.length})`,
          );
          return { content: recoveryText };
        }

        if (isHeartbeatSession(ctx)) {
          const heartbeatGuarded = runFrontstageGuard(script, skillEnv, content, "heartbeat-send");
          if (!heartbeatGuarded) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "cancel-heartbeat-guard",
              sessionKey,
              channel,
              originalLength: content.length,
            });
            api.logger.info(`${PLUGIN_NAME}: message_sending CANCEL-HEARTBEAT-GUARD (channel=${channel}, decision=empty-content)`);
            return { cancel: true };
          }
          if (heartbeatGuarded !== content) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "heartbeat-render",
              sessionKey,
              channel,
              originalLength: content.length,
              renderedLength: heartbeatGuarded.length,
            });
            api.logger.info(`${PLUGIN_NAME}: message_sending HEARTBEAT-RENDER (channel=${channel}, ${content.length}→${heartbeatGuarded.length}, decision=guarded-existing-content)`);
            if (channel === "telegram") {
              rememberDeliveryAck(_deliveryAck, sessionKey, conversationId, heartbeatGuarded, channel);
              scheduleTelegramDeliveryAck(
                api,
                stateDir,
                dataDir,
                script,
                skillEnv,
                _deliveryAck,
                _deliveryAckTimers,
                sessionKey,
                conversationId,
              );
            }
            return { content: heartbeatGuarded };
          }
          if (channel === "telegram") {
            rememberDeliveryAck(_deliveryAck, sessionKey, conversationId, content, channel);
            scheduleTelegramDeliveryAck(
              api,
              stateDir,
              dataDir,
              script,
              skillEnv,
              _deliveryAck,
              _deliveryAckTimers,
              sessionKey,
              conversationId,
            );
          }
          return;
        }

        const source = frontstageGuardSourceForText(ctx, content, "runtime-reply");
        const guarded = runFrontstageGuard(script, skillEnv, content, source);

        if (!guarded) {
          const recentUserText = readRecentUserText(_recentUserTextBySession, sessionKey);
          const preservedRuntimeReply =
            source === "runtime-reply" &&
            isDirectTelegramSession &&
            Boolean(recentUserText) &&
            takePreservedRuntimeReply(_preservedRuntimeReply, sessionKey, conversationId);
          if (preservedRuntimeReply) {
            const recovered = recoverPreservedRuntimeReply(script, skillEnv, content);
            if (recovered) {
              appendFrontstageBridgeAudit(dataDir, {
                phase: "message_sending",
                event: "preserved-runtime-recover",
                sessionKey,
                channel,
                source,
                originalLength: content.length,
                recoveredLength: recovered.length,
              });
              api.logger.info(
                `${PLUGIN_NAME}: message_sending PRESERVED-RUNTIME-RECOVER (channel=${channel}, original_len=${content.length}, recovered_len=${recovered.length})`,
              );
              return { content: recovered };
            }
            const recoveryText = buildRuntimeEmptyRecoveryText(readRecentUserText(_recentUserTextBySession, sessionKey));
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "preserved-runtime-recover-fallback",
              sessionKey,
              channel,
              source,
              originalLength: content.length,
              recoveredLength: recoveryText.length,
            });
            api.logger.info(
              `${PLUGIN_NAME}: message_sending PRESERVED-RUNTIME-RECOVER-FALLBACK (channel=${channel}, original_len=${content.length}, recovered_len=${recoveryText.length})`,
            );
            return { content: recoveryText };
          }
          const stashed = takeBmwFallback(_bmwFallbackStash, sessionKey, conversationId);
          if (stashed) {
            appendFrontstageBridgeAudit(dataDir, {
              phase: "message_sending",
              event: "inject-bmw-fallback-guarded",
              sessionKey,
              channel,
              source,
              originalLength: content.length,
              fallbackLength: stashed.length,
            });
            api.logger.info(`${PLUGIN_NAME}: message_sending INJECT-BMW-FALLBACK-GUARDED (channel=${channel}, original_len=${content.length}, fallback_len=${stashed.length})`);
            return { content: stashed };
          }
          const reason = source === "heartbeat-send" ? "heartbeat-fallback" : "guard-empty";
          appendFrontstageBridgeAudit(dataDir, {
            phase: "message_sending",
            event: "cancel",
            sessionKey,
            channel,
            source,
            reason,
            originalLength: content.length,
          });
          api.logger.info(`${PLUGIN_NAME}: message_sending CANCEL (channel=${channel}, original_len=${content.length}, reason=${reason})`);
          return { cancel: true };
        }

        clearBmwFallback(_bmwFallbackStash, sessionKey, conversationId);

        if (source === "runtime-reply" && sessionKey) {
          runCommitmentCapture(script, skillEnv, guarded, sessionKey);
        }

        if (guarded !== content) {
          appendFrontstageBridgeAudit(dataDir, {
            phase: "message_sending",
            event: "modify",
            sessionKey,
            channel,
            source,
            originalLength: content.length,
            guardedLength: guarded.length,
          });
          api.logger.info(`${PLUGIN_NAME}: message_sending MODIFY (channel=${channel}, ${content.length}→${guarded.length}, source=${source})`);
          return { content: guarded };
        }

        return;
      },
      { priority: 20 },
    );

    hookResults["message_sent"] = safeOn(
      api,
      "message_sent",
      (event: any, ctx: any) => {
        const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
        const conversationId = typeof ctx?.conversationId === "string"
          ? ctx.conversationId
          : (event?.to != null ? String(event.to) : "");
        const channel = event?.metadata?.channel || ctx?.channelId || "";
        let content = typeof event?.content === "string" ? event.content.trim() : "";
        if (!content && Array.isArray(event?.message?.content)) {
          content = assistantVisibleText(event.message.content);
        }
        if (!content && typeof event?.message?.content === "string") {
          content = event.message.content.trim();
        }
        if (!content) return;
        clearDeliveryAck(_deliveryAck, sessionKey, conversationId);
        ackLocalTranscriptDelivery(api, dataDir, script, skillEnv, {
          sessionKey,
          conversationId,
          content,
          channel: channel || "message-sent",
        });
      },
      { priority: 20 },
    );

    const registered = Object.entries(hookResults).filter(([_, v]) => v).map(([k]) => k);
    const failed = Object.entries(hookResults).filter(([_, v]) => !v).map(([k]) => k);
    if (failed.length > 0) {
      api.logger.warn(`${PLUGIN_NAME}: ⚠ P0 — ${failed.length} hooks FAILED: [${failed.join(", ")}]. mode=${regMode}`);
    }
    api.logger.info(`${PLUGIN_NAME}: hook registration — OK=[${registered.join(", ")}] FAIL=[${failed.join(", ")}]`);
  },
};
