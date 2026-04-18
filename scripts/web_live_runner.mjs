#!/usr/bin/env node

import crypto, { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const LIVE_ROOT = process.env.PERSONAL_HOOKS_OPENCLAW_ROOT;
if (!LIVE_ROOT) {
  throw new Error("PERSONAL_HOOKS_OPENCLAW_ROOT is required for web_live_runner.mjs");
}
const LIVE_WORKSPACE = path.join(LIVE_ROOT, "workspace");
const LIVE_DATA_DIR = path.join(LIVE_WORKSPACE, "personal-hooks");
const LIVE_MEMORY_DIR = path.join(LIVE_WORKSPACE, "memory");
const LIVE_OPENCLAW_CONFIG = path.join(LIVE_ROOT, "openclaw.json");
const LIVE_AGENTS_MAIN_AGENT_DIR = path.join(LIVE_ROOT, "agents", "main", "agent");
const LIVE_SCRIPT_PATH = path.join(
  LIVE_WORKSPACE,
  "skills",
  "personal-hooks",
  "scripts",
  "personal_hooks.py",
);
const RUNTIME_ROOT = path.join(LIVE_ROOT, "runtime-src", "openclaw-v2026.3.13");
const DIST_ENTRY = path.join(RUNTIME_ROOT, "dist", "index.js");
const REPORT_DIR = path.join(LIVE_DATA_DIR, "web-live-reports");
const TAIPEI_OFFSET = "+08:00";
const SKILL_HEADINGS = Array.from(
  new Set(
    [
      process.env.PERSONAL_HOOKS_SKILL_HEADING?.trim(),
      "## Skill Context",
      "## V2 公版技能",
    ].filter(Boolean),
  ),
);
const runtimeRequire = createRequire(path.join(RUNTIME_ROOT, "package.json"));
const { WebSocket } = runtimeRequire("ws");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function loadOrCreateDeviceIdentity(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      parsed &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.publicKeyPem === "string" &&
      typeof parsed.privateKeyPem === "string"
    ) {
      return parsed;
    }
  } catch {}
  ensureDir(path.dirname(filePath));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
  const identity = { version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() };
  fs.writeFileSync(filePath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
  return identity;
}

function buildDeviceAuthPayloadV3(params) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    params.platform ?? "",
    params.deviceFamily ?? "",
  ].join("|");
}

function buildDeviceAuth(identityPath, params) {
  const identity = loadOrCreateDeviceIdentity(identityPath);
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs,
    token: params.token,
    nonce: params.nonce,
    platform: params.platform,
    deviceFamily: params.deviceFamily,
  });
  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  return {
    id: identity.deviceId,
    publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
    signature: base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), privateKey)),
    signedAt: signedAtMs,
    nonce: params.nonce,
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function isoLocal(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}${TAIPEI_OFFSET}`;
}

function extractTextFromMessage(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((item) => item && typeof item === "object" && item.type === "text")
      .map((item) => String(item.text || ""))
      .join("\n")
      .trim();
  }
  return "";
}

function listDailyNotes(memoryDir) {
  if (!fs.existsSync(memoryDir)) {
    return [];
  }
  const notes = [];
  for (const fileName of fs.readdirSync(memoryDir)) {
    if (!fileName.endsWith(".md")) {
      continue;
    }
    const text = fs.readFileSync(path.join(memoryDir, fileName), "utf8");
    const marker = SKILL_HEADINGS.find((candidate) => text.includes(candidate));
    if (!marker) {
      continue;
    }
    const section = text.slice(text.indexOf(marker) + marker.length);
    for (const line of section.split("\n")) {
      if (line.startsWith("## ")) {
        break;
      }
      if (line.startsWith("- ")) {
        notes.push(line.slice(2).trim());
      }
    }
  }
  return notes;
}

function aggregateTrace(rows, runId) {
  const filtered = rows.filter((row) => row && row.runId === runId);
  const byPhase = {};
  for (const row of filtered) {
    byPhase[row.phase] = row;
  }
  return {
    rows: filtered,
    byPhase,
    latency: {
      context_build_time_ms: byPhase.context_ready?.context_build_time_ms ?? null,
      model_latency_ms: byPhase.model_end?.model_latency_ms ?? null,
      hook_processing_time_ms: byPhase.context_ready?.hook_processing_time_ms ?? null,
      total_latency_ms: byPhase.dispatch?.total_latency_ms ?? null,
    },
    prompt: {
      prompt_token_estimate: byPhase.context_ready?.prompt_token_estimate ?? null,
      prompt_chars: byPhase.context_ready?.prompt_chars ?? null,
      event_chain_length_avg: byPhase.context_ready?.event_chain_length_avg ?? null,
      staging_count: byPhase.context_ready?.staging_count ?? null,
      incident_count: byPhase.context_ready?.incident_count ?? null,
      active_hook_count: byPhase.context_ready?.active_hook_count ?? null,
      carryover_summary_length: byPhase.context_ready?.carryover_summary_length ?? null,
      pending_topic_count: byPhase.context_ready?.pending_topic_count ?? null,
      pending_topics_prompt_length: byPhase.context_ready?.pending_topics_prompt_length ?? null,
      active_preferences_prompt_length:
        byPhase.context_ready?.active_preferences_prompt_length ?? null,
      schedule_context_prompt_length:
        byPhase.context_ready?.schedule_context_prompt_length ?? null,
      capability_state_prompt_length:
        byPhase.context_ready?.capability_state_prompt_length ?? null,
      pending_memory_guard_length:
        byPhase.context_ready?.pending_memory_guard_length ?? null,
      false_closure_guard_length:
        byPhase.context_ready?.false_closure_guard_length ?? null,
      seed_clarification_prompt_length:
        byPhase.context_ready?.seed_clarification_prompt_length ?? null,
      carryover_prompt_length: byPhase.context_ready?.carryover_prompt_length ?? null,
      prompt_tokens_actual: byPhase.model_end?.prompt_tokens_actual ?? null,
      output_tokens_actual: byPhase.model_end?.output_tokens_actual ?? null,
      total_tokens_actual: byPhase.model_end?.total_tokens_actual ?? null,
      primary_pending_source: byPhase.context_ready?.primary_pending_source ?? null,
      primary_pending_event_kind: byPhase.context_ready?.primary_pending_event_kind ?? null,
      new_session_carryover_applied:
        byPhase.context_ready?.new_session_carryover_applied ?? null,
    },
  };
}

function performanceVerdict(aggregate) {
  const contextMs = aggregate.latency.context_build_time_ms ?? 0;
  const modelMs = aggregate.latency.model_latency_ms ?? 0;
  if (modelMs >= contextMs * 3 && modelMs >= 1500) {
    return "model_latency_primary";
  }
  if (contextMs >= 800) {
    return "context_build_heavy";
  }
  if ((aggregate.latency.hook_processing_time_ms ?? 0) >= 400) {
    return "hook_processing_heavy";
  }
  return "mixed_or_small";
}

async function copyDir(source, target) {
  await fsp.cp(source, target, { recursive: true, force: true });
}

async function removePath(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function buildSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ph-web-live-runner-"));
  return {
    root,
    stateDir: path.join(root, "state"),
    baselineDataDir: path.join(root, "baseline", "personal-hooks"),
    dataDir: path.join(root, "work", "personal-hooks"),
    memoryDir: path.join(root, "work", "memory"),
    jobsPath: path.join(root, "work", "jobs.json"),
    configPath: path.join(root, "state", "openclaw.json"),
    sessionStorePath: path.join(root, "state", "agents", "main", "sessions", "sessions.json"),
    sessionDir: path.join(root, "state", "agents", "main", "sessions"),
    logPath: path.join(root, "gateway.log"),
    errLogPath: path.join(root, "gateway.err.log"),
    performanceTracePath: path.join(root, "work", "personal-hooks", "reply_performance_trace.jsonl"),
  };
}

async function prepareSandbox(sandbox) {
  ensureDir(path.dirname(sandbox.sessionStorePath));
  ensureDir(sandbox.memoryDir);
  ensureDir(path.dirname(sandbox.jobsPath));
  await copyDir(LIVE_DATA_DIR, sandbox.baselineDataDir);
  await fsp.copyFile(LIVE_OPENCLAW_CONFIG, sandbox.configPath);
  await copyDir(LIVE_AGENTS_MAIN_AGENT_DIR, path.join(sandbox.stateDir, "agents", "main", "agent"));
  writeJson(sandbox.jobsPath, { jobs: [] });
  await resetSandboxState(sandbox);
}

async function resetSandboxState(sandbox) {
  await removePath(sandbox.dataDir);
  await copyDir(sandbox.baselineDataDir, sandbox.dataDir);
  await removePath(sandbox.memoryDir);
  ensureDir(sandbox.memoryDir);
  ensureDir(sandbox.sessionDir);
  const candidate = readJson(path.join(sandbox.dataDir, "candidate_buffer.json"), { candidates: [] });
  candidate.candidates = [];
  writeJson(path.join(sandbox.dataDir, "candidate_buffer.json"), candidate);
  const incidents = readJson(path.join(sandbox.dataDir, "incidents.json"), { incidents: [] });
  incidents.incidents = [];
  writeJson(path.join(sandbox.dataDir, "incidents.json"), incidents);
  const hooks = readJson(path.join(sandbox.dataDir, "hooks.json"), { hooks: [] });
  hooks.hooks = [];
  writeJson(path.join(sandbox.dataDir, "hooks.json"), hooks);
  const staging = readJson(path.join(sandbox.dataDir, "session_memory_staging.json"), {
    records: [],
    carryover: {},
  });
  staging.records = [];
  staging.carryover = {};
  writeJson(path.join(sandbox.dataDir, "session_memory_staging.json"), staging);
  const memoryRank = readJson(path.join(sandbox.dataDir, "memory_rank.json"), { records: [] });
  memoryRank.records = [];
  writeJson(path.join(sandbox.dataDir, "memory_rank.json"), memoryRank);
  const emotion = readJson(path.join(sandbox.dataDir, "emotion_state.json"), {});
  emotion.last_interaction_at = null;
  emotion.last_processed_user_at = null;
  emotion.last_rhythm_stage = null;
  emotion.last_rhythm_emitted_at = null;
  writeJson(path.join(sandbox.dataDir, "emotion_state.json"), emotion);
  const persona = readJson(path.join(sandbox.dataDir, "persona_state.json"), {});
  persona.last_text_summary = null;
  writeJson(path.join(sandbox.dataDir, "persona_state.json"), persona);
  for (const fileName of [
    "followup_trace.jsonl",
    "reply_performance_trace.jsonl",
    "candidate_buffer_audit.jsonl",
    "session_memory_staging_audit.jsonl",
    "hook_completion_audit.jsonl",
  ]) {
    const target = path.join(sandbox.dataDir, fileName);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
  for (const entry of fs.readdirSync(sandbox.sessionDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.unlinkSync(path.join(sandbox.sessionDir, entry.name));
    }
  }
  writeJson(sandbox.sessionStorePath, {});
}

function sandboxEnv(sandbox, extra = {}) {
  return {
    ...process.env,
    OPENCLAW_STATE_DIR: sandbox.stateDir,
    OPENCLAW_CONFIG_PATH: sandbox.configPath,
    OPENCLAW_SKIP_CHANNELS: "1",
    OPENCLAW_SKIP_CRON: "1",
    OPENCLAW_SKIP_GMAIL_WATCHER: "1",
    OPENCLAW_SKIP_CANVAS_HOST: "1",
    OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
    PERSONAL_HOOKS_DATA_DIR: sandbox.dataDir,
    PERSONAL_HOOKS_MEMORY_DIR: sandbox.memoryDir,
    PERSONAL_HOOKS_SESSIONS_INDEX_PATH: sandbox.sessionStorePath,
    PERSONAL_HOOKS_JOBS_PATH: sandbox.jobsPath,
    PERSONAL_HOOKS_OPENCLAW_CONFIG_PATH: sandbox.configPath,
    ...extra,
  };
}

function runPersonalHooksJson(sandbox, args) {
  const res = spawnSync("python3", [LIVE_SCRIPT_PATH, ...args], {
    cwd: LIVE_WORKSPACE,
    env: sandboxEnv(sandbox),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`personal_hooks.py ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

async function startStagingGateway(sandbox, port, token) {
  const stdout = fs.openSync(sandbox.logPath, "a");
  const stderr = fs.openSync(sandbox.errLogPath, "a");
  const child = spawn(
    "node",
    [DIST_ENTRY, "gateway", "run", "--port", String(port), "--bind", "loopback", "--token", token, "--allow-unconfigured", "--ws-log", "compact"],
    {
      cwd: RUNTIME_ROOT,
      env: sandboxEnv(sandbox, { OPENCLAW_GATEWAY_TOKEN: token }),
      stdio: ["ignore", stdout, stderr],
    },
  );
  return child;
}

class GatewayWebClient {
  constructor(url, token, deviceIdentityPath) {
    this.url = url;
    this.token = token;
    this.deviceIdentityPath = deviceIdentityPath;
    this.ws = null;
    this.waiters = [];
  }

  async connect(origin) {
    this.ws = new WebSocket(this.url, {
      headers: { origin },
    });
    this.ws.on("message", (buf) => this.onMessage(buf.toString()));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for websocket open")), 10_000);
      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const challenge = await this.waitFor(
      (msg) => msg?.type === "event" && msg?.event === "connect.challenge",
      10_000,
    );
    const connectId = randomUUID();
    this.ws.send(
      JSON.stringify({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "openclaw-control-ui",
            version: "1.0.0",
            platform: "web",
            mode: "webchat",
            instanceId: randomUUID(),
          },
          caps: [],
          role: "operator",
          scopes: ["operator.admin"],
          auth: { token: this.token },
          device: buildDeviceAuth(this.deviceIdentityPath, {
            clientId: "openclaw-control-ui",
            clientMode: "webchat",
            role: "operator",
            scopes: ["operator.admin"],
            token: this.token,
            nonce:
              challenge?.payload && typeof challenge.payload.nonce === "string"
                ? challenge.payload.nonce
                : "",
            platform: "web",
            deviceFamily: "",
          }),
        },
      }),
    );
    const hello = await this.waitFor(
      (msg) => msg?.type === "res" && msg?.id === connectId,
      10_000,
    );
    if (!hello?.ok) {
      throw new Error(`gateway connect failed: ${hello?.error?.message || "unknown error"}`);
    }
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }

  onMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const next = [];
    for (const waiter of this.waiters) {
      try {
        if (waiter.predicate(parsed)) {
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
          continue;
        }
      } catch (err) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
        continue;
      }
      next.push(waiter);
    }
    this.waiters = next;
  }

  waitFor(predicate, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error("timeout waiting for gateway frame"));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  async request(method, params, timeoutMs = 30_000) {
    const id = randomUUID();
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    const res = await this.waitFor((msg) => msg?.type === "res" && msg?.id === id, timeoutMs);
    if (!res?.ok) {
      throw new Error(`gateway request ${method} failed: ${res?.error?.message || "unknown error"}`);
    }
    return res.payload;
  }

  async sendChat(sessionKey, message) {
    const runId = randomUUID();
    await this.request(
      "chat.send",
      {
        sessionKey,
        message,
        idempotencyKey: runId,
      },
      30_000,
    );
    const event = await this.waitFor(
      (msg) =>
        msg?.type === "event" &&
        msg?.event === "chat" &&
        msg?.payload?.runId === runId &&
        (msg?.payload?.state === "final" || msg?.payload?.state === "error"),
      180_000,
    );
    return {
      runId,
      finalEvent: event,
      replyText: extractTextFromMessage(event?.payload?.message),
    };
  }
}

async function waitForGateway(port, token) {
  const url = `ws://127.0.0.1:${port}`;
  const deviceIdentityPath = path.join(os.tmpdir(), "ph-web-live-runner-device.json");
  const deadline = Date.now() + 30_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    const client = new GatewayWebClient(url, token, deviceIdentityPath);
    try {
      await client.connect("https://localhost");
      return client;
    } catch (err) {
      lastErr = err;
      client.close();
      await sleep(500);
    }
  }
  throw lastErr ?? new Error("gateway did not become ready");
}

function sessionKeyFor(caseId, index) {
  return `agent:main:frontstage-web:test-${index}`;
}

function statePaths(sandbox) {
  return {
    candidate: path.join(sandbox.dataDir, "candidate_buffer.json"),
    incidents: path.join(sandbox.dataDir, "incidents.json"),
    hooks: path.join(sandbox.dataDir, "hooks.json"),
    staging: path.join(sandbox.dataDir, "session_memory_staging.json"),
    capability: path.join(sandbox.dataDir, "capability_state.json"),
    trace: path.join(sandbox.dataDir, "followup_trace.jsonl"),
    perf: path.join(sandbox.dataDir, "reply_performance_trace.jsonl"),
  };
}

function loadStateSnapshot(sandbox) {
  const paths = statePaths(sandbox);
  const candidateStore = readJson(paths.candidate, { candidates: [] });
  const incidentStore = readJson(paths.incidents, { incidents: [] });
  const hookStore = readJson(paths.hooks, { hooks: [] });
  const stagingStore = readJson(paths.staging, { records: [], carryover: {} });
  const capabilityState = readJson(paths.capability, {});
  return {
    candidateStore,
    incidentStore,
    hookStore,
    stagingStore,
    capabilityState,
    candidateCount: Array.isArray(candidateStore.candidates) ? candidateStore.candidates.length : 0,
    incidentCount: Array.isArray(incidentStore.incidents) ? incidentStore.incidents.length : 0,
    hookCount: Array.isArray(hookStore.hooks) ? hookStore.hooks.length : 0,
    stagingCount: Array.isArray(stagingStore.records) ? stagingStore.records.length : 0,
    hookCounts: capabilityState.hook_counts || {},
    dailyMemoryNotes: listDailyNotes(sandbox.memoryDir),
    performanceTrace: readJsonl(paths.perf),
    followupTrace: readJsonl(paths.trace),
  };
}

function diffNotes(before, after) {
  return after.filter((note) => !before.includes(note));
}

function eventChainFields(record) {
  const chain = record && typeof record.event_chain === "object" ? record.event_chain : {};
  return ["context_before", "event_core", "immediate_result", "followup_focus"].filter(
    (field) => typeof chain[field] === "string" && chain[field].trim(),
  );
}

function findLatestRecord(snapshot, eventKind) {
  const ordered = [];
  ordered.push(...(snapshot.stagingStore.records || []).slice().reverse());
  ordered.push(...(snapshot.incidentStore.incidents || []).slice().reverse());
  ordered.push(...(snapshot.candidateStore.candidates || []).slice().reverse());
  ordered.push(...(snapshot.hookStore.hooks || []).slice().reverse());
  return ordered.find((record) => !eventKind || record.event_kind === eventKind) || null;
}

function setHooksDueSoon(sandbox, preferredTypes = []) {
  const hooksPath = path.join(sandbox.dataDir, "hooks.json");
  const store = readJson(hooksPath, { hooks: [] });
  const nowIso = isoLocal(new Date(Date.now() - 60_000));
  for (const hook of store.hooks || []) {
    if (hook.status !== "pending") {
      continue;
    }
    if (preferredTypes.length > 0 && !preferredTypes.includes(hook.type)) {
      continue;
    }
    hook.trigger_at = nowIso;
    const payload = hook.payload && typeof hook.payload === "object" ? hook.payload : {};
    payload.test_dispatch_cooldown_minutes = 0;
    payload.test_dispatch_cap = 2;
    payload.test_absence_mode = true;
    hook.payload = payload;
  }
  writeJson(hooksPath, store);
}

async function dispatchDueHook(sandbox, client, sessionKey, preferredTypes = []) {
  const due = runPersonalHooksJson(sandbox, ["due", "--now", isoLocal(), "--limit", "10"]);
  const hooks = Array.isArray(due?.hooks) ? due.hooks : [];
  const hook =
    hooks.find((item) => preferredTypes.length === 0 || preferredTypes.includes(item.type)) ||
    hooks[0];
  if (!hook) {
    return null;
  }
  const rendered = runPersonalHooksJson(sandbox, ["render", "--id", hook.id]);
  await client.request("chat.inject", {
    sessionKey,
    message: rendered.message,
    label: "followup-test",
  });
  return {
    hookId: hook.id,
    hookType: hook.type,
    message: rendered.message,
  };
}

async function sendAndCollect(client, sandbox, sessionKey, message) {
  const before = loadStateSnapshot(sandbox);
  const sent = await client.sendChat(sessionKey, message);
  await sleep(200);
  const after = loadStateSnapshot(sandbox);
  const perf = aggregateTrace(after.performanceTrace, sent.runId);
  return {
    before,
    after,
    runId: sent.runId,
    replyText: sent.replyText,
    finalEvent: sent.finalEvent,
    performance: perf,
  };
}

async function runCaseCasual(client, sandbox, sessionKey) {
  const res = await sendAndCollect(client, sandbox, sessionKey, "好累喔，今天有點忙。");
  const pass =
    Boolean(res.replyText) &&
    res.after.candidateCount === 0 &&
    res.after.incidentCount === 0 &&
    res.after.hookCount === 0 &&
    res.after.stagingCount === 0;
  return {
    case_id: "casual_chat",
    category: "casual_chat",
    reply_text: res.replyText,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    pass,
    failure_reason: pass ? "" : "casual chat should not enter staged/tracked state",
  };
}

async function runCaseParked(client, sandbox, sessionKey) {
  await sendAndCollect(client, sandbox, sessionKey, "我先把這件事放妳這裡，晚點再接，不用現在展開。");
  const res = await sendAndCollect(client, sandbox, sessionKey, "是工作上的，明天我回來再補。");
  const latest = findLatestRecord(res.after, "parked_topic");
  const notes = diffNotes(res.before.dailyMemoryNotes, res.after.dailyMemoryNotes);
  const pass =
    Boolean(res.replyText) &&
    latest?.event_kind === "parked_topic" &&
    notes.length > 0 &&
    eventChainFields(latest).length === 4;
  return {
    case_id: "parked_topic",
    category: "parked_topic",
    reply_text: res.replyText,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    daily_memory_notes: notes,
    event_chain_fields: eventChainFields(latest),
    pass,
    failure_reason: pass ? "" : "parked topic missing staged trace or full event chain",
  };
}

async function runCaseWatchful(client, sandbox, sessionKey) {
  const seed = await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "我現在真的很累，但不想被勸睡，妳先陪我放著。",
  );
  setHooksDueSoon(sandbox, ["emotional_followup", "health_followup"]);
  const followup = await dispatchDueHook(sandbox, client, sessionKey, [
    "emotional_followup",
    "health_followup",
  ]);
  const reply = await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "我還是有點累，但沒有想被勸睡。",
  );
  const latest = findLatestRecord(reply.after, "watchful_state");
  const sleepspeak = ["快去睡", "太晚了還不睡", "先去睡", "早點睡"];
  const pass =
    Boolean(seed.replyText) &&
    !sleepspeak.some((token) => seed.replyText.includes(token)) &&
    Boolean(followup?.message) &&
    Boolean(reply.replyText) &&
    reply.after.hookCounts.hook_count_closed >= 1 &&
    eventChainFields(latest).length === 4;
  return {
    case_id: "watchful_state",
    category: "watchful_state",
    reply_text: reply.replyText,
    dispatched_followup: followup,
    latency: reply.performance.latency,
    prompt: reply.performance.prompt,
    hook_counts: reply.after.hookCounts,
    pass,
    failure_reason: pass ? "" : "watchful_state failed closure, event chain, or anti-sleep-policing",
  };
}

async function runCaseDelegated(client, sandbox, sessionKey) {
  await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "這份資料妳之後先幫我查一下，整理重點再回來接我。",
  );
  setHooksDueSoon(sandbox, ["progress_followup"]);
  const followup = await dispatchDueHook(sandbox, client, sessionKey, ["progress_followup"]);
  const reply = await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "我回來了，先跟我說妳整理到哪裡。",
  );
  const latest = findLatestRecord(reply.after, "delegated_task");
  const notes = diffNotes(reply.before.dailyMemoryNotes, reply.after.dailyMemoryNotes);
  const pass =
    Boolean(followup?.message) &&
    Boolean(reply.replyText) &&
    latest?.event_kind === "delegated_task" &&
    eventChainFields(latest).length === 4 &&
    (notes.length > 0 || reply.after.hookCounts.hook_count_closed >= 1);
  return {
    case_id: "delegated_task",
    category: "delegated_task",
    reply_text: reply.replyText,
    dispatched_followup: followup,
    latency: reply.performance.latency,
    prompt: reply.performance.prompt,
    pass,
    failure_reason: pass ? "" : "delegated_task failed tracked flow or closure",
  };
}

async function runCaseSensitive(client, sandbox, sessionKey) {
  await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "我剛剛去陽台抽煙，邊走邊跟妳聊，回房間時跌倒，腳有點受傷了。",
  );
  setHooksDueSoon(sandbox, ["health_followup"]);
  const followup = await dispatchDueHook(sandbox, client, sessionKey, ["health_followup"]);
  const reply = await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "腳還在痛，但沒有剛剛那麼慌。",
  );
  const latest = findLatestRecord(reply.after, "sensitive_event");
  const followupText = followup?.message || "";
  const pass =
    Boolean(reply.replyText) &&
    latest?.event_kind === "sensitive_event" &&
    eventChainFields(latest).length === 4 &&
    /腳|跌倒|剛剛|回房間/.test(followupText);
  return {
    case_id: "sensitive_event",
    category: "sensitive_event",
    reply_text: reply.replyText,
    dispatched_followup: followup,
    latency: reply.performance.latency,
    prompt: reply.performance.prompt,
    event_chain_fields: eventChainFields(latest),
    pass,
    failure_reason: pass ? "" : "sensitive_event lost chain detail or follow-up continuity",
  };
}

async function runCaseIncremental(client, sandbox, sessionKey) {
  await sendAndCollect(
    client,
    sandbox,
    sessionKey,
    "我今天心情不好，但不想說，妳先陪我放著。",
  );
  await sendAndCollect(client, sandbox, sessionKey, "是因為家裡那件事。");
  const res = await sendAndCollect(client, sandbox, sessionKey, "昨晚延續到現在。");
  const records = [
    ...(res.after.stagingStore.records || []),
    ...(res.after.incidentStore.incidents || []),
  ].filter((item) => item.event_kind === "watchful_state");
  const merged = records.length <= 2;
  const expanded = records.some((item) =>
    JSON.stringify(item.event_chain || {}, undefined, 0).includes("家裡") &&
    JSON.stringify(item.event_chain || {}, undefined, 0).includes("昨晚"),
  );
  const pass = Boolean(res.replyText) && merged && expanded;
  return {
    case_id: "incremental_update",
    category: "incremental_update",
    reply_text: res.replyText,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    merged_record_count: records.length,
    pass,
    failure_reason: pass ? "" : "incremental update produced parallel fragments or failed to enrich event chain",
  };
}

async function runCaseCarryover(client, sandbox, sessionKey) {
  await sendAndCollect(client, sandbox, sessionKey, "我先把技能倉庫那件事放妳這裡，晚點再接。");
  await sendAndCollect(client, sandbox, sessionKey, "另外還有一件比較重要的事想晚點再跟妳談。");
  await client.request("sessions.reset", { key: sessionKey, reason: "new" });
  const res = await sendAndCollect(client, sandbox, sessionKey, "我回來了。");
  const staging = res.after.stagingStore.carryover?.[sessionKey] || {};
  const genericGreeting = ["想聊什麼", "今天要我幫什麼", "有什麼想聊的嗎"];
  const pass =
    Boolean(res.replyText) &&
    staging.new_session_carryover_applied === true &&
    staging.summary_present === true &&
    !genericGreeting.some((token) => res.replyText.includes(token));
  return {
    case_id: "new_session_carryover",
    category: "/new carryover",
    reply_text: res.replyText,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    carryover_flags: {
      new_session_carryover_applied: staging.new_session_carryover_applied ?? false,
      carryover_source: staging.source ?? null,
      carryover_summary_present: staging.summary_present ?? false,
    },
    pass,
    failure_reason: pass ? "" : "carryover flags missing or first reply fell back to generic opener",
  };
}

async function runCaseActiveHookClosure(client, sandbox, sessionKey) {
  await sendAndCollect(client, sandbox, sessionKey, "今天有點忙。");
  const baseNow = new Date();
  for (const [index, summary] of [
    "今天情緒有點悶，我先放著。",
    "晚點幫我查技能倉庫。",
    "剛剛跌倒那件事等一下再接。",
    "關係上的話題我等一下再跟妳談。",
  ].entries()) {
    runPersonalHooksJson(sandbox, [
      "add-hook",
      "--type",
      index === 0 ? "emotional_followup" : index === 1 ? "progress_followup" : index === 2 ? "health_followup" : "tomorrow_check",
      "--trigger-at",
      isoLocal(new Date(baseNow.getTime() - 60_000)),
      "--source-summary",
      summary,
      "--payload-json",
      JSON.stringify({
        test_dispatch_cooldown_minutes: 0,
        test_dispatch_cap: 1,
        event_kind: index === 1 ? "delegated_task" : index === 2 ? "sensitive_event" : "watchful_state",
      }),
    ]);
  }
  const before = loadStateSnapshot(sandbox);
  const followup = await dispatchDueHook(sandbox, client, sessionKey, ["emotional_followup"]);
  const res = await sendAndCollect(client, sandbox, sessionKey, "我回來了，先接剛剛那個情緒上的。");
  const after = loadStateSnapshot(sandbox);
  const closedDelta =
    Number(after.hookCounts.hook_count_closed || 0) - Number(before.hookCounts.hook_count_closed || 0);
  const pass =
    Boolean(followup?.message) &&
    Boolean(res.replyText) &&
    Number(after.hookCounts.hook_count_waiting || 0) >= 3 &&
    closedDelta >= 1;
  return {
    case_id: "active_hook_closure",
    category: "active hook / closure",
    reply_text: res.replyText,
    dispatched_followup: followup,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    hook_counts: after.hookCounts,
    pass,
    failure_reason: pass ? "" : "active hook closure did not preserve other hooks or close replied hook",
  };
}

async function runCaseTimeSense(client, sandbox, sessionKey) {
  const res = await sendAndCollect(client, sandbox, sessionKey, "剛忙完，先陪我一下，不用提醒我睡覺。");
  const sleepPolicing = ["快去睡", "太晚了還不睡", "先去睡", "早點睡"];
  const pass =
    Boolean(res.replyText) &&
    Number(res.performance.prompt.schedule_context_prompt_length || 0) > 0 &&
    !sleepPolicing.some((token) => res.replyText.includes(token));
  return {
    case_id: "time_sense",
    category: "time_sense",
    reply_text: res.replyText,
    latency: res.performance.latency,
    prompt: res.performance.prompt,
    pass,
    failure_reason: pass ? "" : "schedule context missing or reply slipped into generic sleep policing",
  };
}

async function runAllCases(client, sandbox) {
  const cases = [];
  const runners = [
    runCaseCasual,
    runCaseParked,
    runCaseWatchful,
    runCaseDelegated,
    runCaseSensitive,
    runCaseIncremental,
    runCaseCarryover,
    runCaseActiveHookClosure,
    runCaseTimeSense,
  ];
  for (const [index, runner] of runners.entries()) {
    await resetSandboxState(sandbox);
    const sessionKey = sessionKeyFor(runner.name, index);
    const result = await runner(client, sandbox, sessionKey);
    cases.push(result);
  }
  return cases;
}

function buildPerformanceSummary(cases) {
  const byCaseId = Object.fromEntries(cases.map((item) => [item.case_id, item]));
  return {
    casual_chat_baseline: {
      case_id: byCaseId.casual_chat?.case_id ?? null,
      latency: byCaseId.casual_chat?.latency ?? null,
      prompt: byCaseId.casual_chat?.prompt ?? null,
      verdict: byCaseId.casual_chat ? performanceVerdict({ latency: byCaseId.casual_chat.latency, prompt: byCaseId.casual_chat.prompt }) : null,
    },
    active_hook_present: {
      case_id: byCaseId.watchful_state?.case_id ?? null,
      latency: byCaseId.watchful_state?.latency ?? null,
      prompt: byCaseId.watchful_state?.prompt ?? null,
      verdict: byCaseId.watchful_state ? performanceVerdict({ latency: byCaseId.watchful_state.latency, prompt: byCaseId.watchful_state.prompt }) : null,
    },
    multi_event_chain: {
      case_id: byCaseId.active_hook_closure?.case_id ?? null,
      latency: byCaseId.active_hook_closure?.latency ?? null,
      prompt: byCaseId.active_hook_closure?.prompt ?? null,
      verdict: byCaseId.active_hook_closure ? performanceVerdict({ latency: byCaseId.active_hook_closure.latency, prompt: byCaseId.active_hook_closure.prompt }) : null,
    },
    long_session_with_carryover: {
      case_id: byCaseId.new_session_carryover?.case_id ?? null,
      latency: byCaseId.new_session_carryover?.latency ?? null,
      prompt: byCaseId.new_session_carryover?.prompt ?? null,
      verdict: byCaseId.new_session_carryover ? performanceVerdict({ latency: byCaseId.new_session_carryover.latency, prompt: byCaseId.new_session_carryover.prompt }) : null,
    },
  };
}

async function main() {
  ensureDir(REPORT_DIR);
  const sandbox = buildSandbox();
  await prepareSandbox(sandbox);
  const port = await getFreePort();
  const token = `web-live-${randomUUID()}`;
  const gateway = await startStagingGateway(sandbox, port, token);
  let client = null;
  try {
    client = await waitForGateway(port, token);
    const cases = await runAllCases(client, sandbox);
    const passCount = cases.filter((item) => item.pass).length;
    const report = {
      generated_at: isoLocal(),
      report_version: "v1",
      sandbox_root: sandbox.root,
      gateway_port: port,
      gateway_url: `ws://127.0.0.1:${port}`,
      cases,
      pass_count: passCount,
      fail_count: cases.length - passCount,
      performance_summary: buildPerformanceSummary(cases),
      web_vs_channel_adapter: {
        shared_pipeline: [
          "build_runtime_context()",
          "personal_hooks.py",
          "MiniMax/ordinary reply model call",
          "reply assembly",
        ],
        channel_specific: [
          "Channel polling ingest delay",
          "Channel outbound delivery",
          "Channel final send path",
        ],
      },
    };
    const reportPath = path.join(
      REPORT_DIR,
      `web_live_report_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.json`,
    );
    writeJson(reportPath, report);
    console.log(JSON.stringify({ ok: true, report_path: reportPath, pass_count: passCount, fail_count: report.fail_count }, null, 2));
  } finally {
    try {
      client?.close();
    } catch {}
    gateway.kill("SIGTERM");
    await sleep(1000);
    if (!gateway.killed) {
      gateway.kill("SIGKILL");
    }
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exitCode = 1;
});
