import { API_ORIGIN, API_VERSION, ASSESSMENT_VERSION, RUBRIC_VERSION, CACHE_KEY, SCORING_VERSION, parseAnalysisResult, type AnalysisResult, type AnalysisState, type JobInput } from "../shared/analysis.js";
import { readSettings } from "../shared/storage.js";
import { SETTINGS_KEY, type Settings } from "../shared/settings.js";
import { currentRoute } from "../linkedin/extract.js";
import { PROVIDER_TRACE_KEY } from "../shared/provider-trace.js";

interface Session { port: chrome.runtime.Port; generation: number; flight?: Flight; closed: boolean }
interface Flight { abort: AbortController; clients: Set<Session>; promise: Promise<{ result: AnalysisResult; elapsedMs: number }> }
interface CacheEntry { key: string; at: number; result: AnalysisResult }
const sessions = new Set<Session>();
const flights = new Map<string, Flight>();
let epoch = 0;
let cacheWrites = Promise.resolve();

function send(session: Session, requestId: string, state: AnalysisState): void {
  if (!session.closed) try { session.port.postMessage({ type: "state", requestId, state }); } catch { detach(session); }
}
function detach(session: Session): void {
  if (session.flight) {
    session.flight.clients.delete(session);
    if (!session.flight.clients.size) session.flight.abort.abort();
    session.flight = undefined;
  }
}
function cancel(session: Session): void { session.generation++; detach(session); }
function cacheMutation(operation: () => Promise<void>): Promise<void> {
  cacheWrites = cacheWrites.catch(() => {}).then(operation);
  return cacheWrites;
}
async function beginCapture(): Promise<string | null> {
  let captureId: string | null = null;
  await cacheMutation(async () => {
    const stored = (await chrome.storage.session.get(PROVIDER_TRACE_KEY))[PROVIDER_TRACE_KEY];
    if (stored?.phase !== "armed" || typeof stored.captureId !== "string" || stored.expiresAt <= Date.now()) return;
    captureId = stored.captureId;
    await chrome.storage.session.set({ [PROVIDER_TRACE_KEY]: { ...stored, phase: "capturing", message: "Capturing the actual request and provider response…" } });
  });
  return captureId;
}
async function saveCapture(captureId: string, value: object): Promise<void> {
  await cacheMutation(async () => {
    const stored = (await chrome.storage.session.get(PROVIDER_TRACE_KEY))[PROVIDER_TRACE_KEY];
    if (stored?.captureId === captureId) await chrome.storage.session.set({ [PROVIDER_TRACE_KEY]: { ...value, captureId } });
  });
}
async function cached(key: string): Promise<AnalysisResult | null> {
  await cacheWrites;
  const value = (await chrome.storage.session.get(CACHE_KEY))[CACHE_KEY];
  if (!Array.isArray(value)) return null;
  const entry = value.find((entry: CacheEntry) => entry?.key === key && Number.isFinite(entry.at)
    && entry.at <= Date.now() && Date.now() - entry.at < 6 * 60 * 60 * 1000);
  if (!entry) return null;
  try { return parseAnalysisResult(entry.result); } catch { return null; }
}
async function cache(key: string, result: AnalysisResult, startedEpoch: number, abort: AbortController): Promise<void> {
  await cacheMutation(async () => {
    if (epoch !== startedEpoch || abort.signal.aborted) return;
    const stored = (await chrome.storage.session.get(CACHE_KEY))[CACHE_KEY];
    const previous = Array.isArray(stored) ? stored.filter((e: CacheEntry) => e?.key !== key && Date.now() - e.at < 6 * 60 * 60 * 1000).slice(-29) : [];
    if (epoch === startedEpoch && !abort.signal.aborted) await chrome.storage.session.set({ [CACHE_KEY]: [...previous, { key, at: Date.now(), result }] });
  });
}
function jobInput(value: unknown, url: unknown): JobInput {
  const job = value as JobInput;
  if (typeof url !== "string") throw new Error("Invalid job page.");
  const route = currentRoute(url);
  if (!route.isJobsPage || !job || !/^\d{1,30}$/.test(job.id) || (route.jobId && route.jobId !== job.id)
    || typeof job.title !== "string" || !job.title.trim() || job.title.length > 300
    || typeof job.company !== "string" || job.company.length > 300
    || typeof job.description !== "string" || job.description.trim().length < 120 || job.description.length > 100_000) {
    throw new Error("The opened job is incomplete. Wait for its full description.");
  }
  return { id: job.id, title: job.title, company: job.company, description: job.description };
}
async function fingerprint(job: JobInput, settings: Settings): Promise<string> {
  const data = JSON.stringify({ job, resume: settings.resume, preferences: settings.preferences,
    preferencesVersion: settings.preferencesVersion, apiVersion: API_VERSION, rubricVersion: RUBRIC_VERSION,
    scoringVersion: SCORING_VERSION, assessmentVersion: ASSESSMENT_VERSION });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
}
async function infer(job: JobInput, settings: Settings, key: string, startedEpoch: number, abort: AbortController) {
  const started = performance.now();
  const requestId = crypto.randomUUID();
  const captureId = await beginCapture();
  const extensionRequest = { schemaVersion: 1, requestId, resume: { text: settings.resume!.text, version: settings.resume!.version },
    preferences: settings.preferences, preferencesVersion: settings.preferencesVersion, job,
    consent: { granted: true, noticeVersion: settings.consent.noticeVersion } };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 25_000);
  try {
    const response = await fetch(`${API_ORIGIN}/analyze`, {
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: abort.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiToken}`,
        ...(captureId ? { "X-Job-Lens-Debug": "requirements-v1" } : {}) },
      body: JSON.stringify(extensionRequest),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "The API rejected the text or consent. Review settings and the job description.",
        401: "The personal testing API key is invalid. Update it in settings.",
        413: "The complete analysis request exceeds the input budget. Resume text, posting text, preferences, and assessment instructions all count. Review the saved text for duplicates or unnecessary content, then retry.",
        429: "The API usage limit was reached. Wait a minute, then retry.",
        502: "The AI result was invalid or unavailable. Check the Workers AI quota, then retry later.",
        503: "The Worker is missing its AI binding or testing secret.",
        504: "The model took too long to respond. Retry later.",
      };
      throw new Error(messages[response.status] ?? "The API request failed. Check your connection and Worker deployment.");
    }
    const text = await response.text();
    if (text.length > (captureId ? 512_000 : 32_000)) throw new Error("The API returned an oversized response.");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error("The API returned invalid JSON. Update the Worker and retry."); }
    const result = parseAnalysisResult(json);
    if (result.requestId !== requestId || result.jobId !== job.id || result.resumeVersion !== settings.resume!.version
      || result.preferencesVersion !== settings.preferencesVersion) throw new Error("An outdated API response was discarded. Retry.");
    if (abort.signal.aborted || epoch !== startedEpoch || (await readSettings()).revision !== settings.revision) throw new Error("Settings changed during analysis.");
    if (captureId) {
      const raw = json as { debug?: { format?: string; request?: unknown; rawResponse?: unknown; work?: { request?: unknown; rawResponse?: unknown } } };
      const debug = raw.debug;
      await saveCapture(captureId, debug?.format === "job-lens-provider-trace-v2" && debug.request && debug.rawResponse && debug.work?.request && debug.work.rawResponse
        ? { format: "job-lens-extension-provider-trace-v1", extensionVersion: chrome.runtime.getManifest().version,
          createdAt: new Date().toISOString(), extensionRequest, debug: { format: debug.format, request: debug.request, rawResponse: debug.rawResponse, work: debug.work }, result }
        : { phase: "error", message: "The Worker did not return a provider trace. Deploy the current Worker debug endpoint, then capture again." });
    }
    await cache(key, result, startedEpoch, abort);
    return { result, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (captureId) await saveCapture(captureId, { phase: "error", message: "Capture failed. Check the job's analysis error, then capture another fresh analysis." });
    if (timedOut) throw new Error("Analysis timed out. Retry later; the server may still consume AI usage.");
    if (error instanceof TypeError) throw new Error("Could not reach the API. Check your connection and retry.");
    throw error;
  } finally { clearTimeout(timer); }
}
async function analyze(session: Session, message: { requestId: string; job: unknown; url: unknown; refresh?: boolean }): Promise<void> {
  cancel(session);
  const generation = session.generation, startedEpoch = epoch;
  const current = () => !session.closed && generation === session.generation && epoch === startedEpoch;
  try {
    const job = jobInput(message.job, message.url);
    const settings = await readSettings();
    if (!current()) return;
    if (!settings.resume || !settings.apiToken || !settings.consent.automaticAnalysis) {
      send(session, message.requestId, { phase: "blocked", message: "Open settings to confirm your resume, add your testing API key, and consent to AI matching." }); return;
    }
    const key = await fingerprint(job, settings);
    if (!current()) return;
    if (message.refresh) await cacheMutation(async () => {
      if (!current()) return;
      const stored = (await chrome.storage.session.get(CACHE_KEY))[CACHE_KEY];
      if (current() && Array.isArray(stored)) {
        await chrome.storage.session.set({ [CACHE_KEY]: stored.filter((entry: CacheEntry) => entry?.key !== key) });
      }
    });
    const hit = message.refresh ? null : await cached(key);
    if (!current()) return;
    if (hit) { send(session, message.requestId, { phase: "complete", result: hit, cached: true, elapsedMs: 0 }); return; }
    send(session, message.requestId, { phase: "analyzing", message: "Analyzing with AI…" });
    let flight = flights.get(key);
    if (!flight || flight.abort.signal.aborted) {
      const abort = new AbortController();
      flight = { abort, clients: new Set(), promise: infer(job, settings, key, startedEpoch, abort) };
      flights.set(key, flight);
    }
    session.flight = flight; flight.clients.add(session);
    try {
      const answer = await flight.promise;
      if (current()) send(session, message.requestId, { phase: "complete", ...answer, cached: false });
    } finally {
      if (flights.get(key) === flight) flights.delete(key);
      if (session.flight === flight) detach(session);
    }
  } catch (error) {
    if (current()) send(session, message.requestId, { phase: "error", message: error instanceof Error ? error.message : "Analysis failed. Retry later." });
  }
}

chrome.runtime.onConnect.addListener(port => {
  const sender = port.sender;
  if (port.name !== "jobLens.analysis" || sender?.id !== chrome.runtime.id || sender.frameId !== 0
    || sender.tab?.id === undefined || !sender.url || !currentRoute(sender.url).isJobsPage) { port.disconnect(); return; }
  const session: Session = { port, generation: 0, closed: false }; sessions.add(session);
  port.onMessage.addListener((message: unknown) => {
    const input = message as { type?: string; requestId: string; job: unknown; url: unknown; refresh?: boolean };
    if (!input || typeof input !== "object") return;
    if (input.type === "cancel") { cancel(session); return; }
    if (input.type === "analyze" && typeof input.requestId === "string" && /^[\w-]{1,100}$/.test(input.requestId)
      && (input.refresh === undefined || typeof input.refresh === "boolean")) void analyze(session, input);
  });
  port.onDisconnect.addListener(() => { session.closed = true; cancel(session); sessions.delete(session); });
});
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const type = (message as { type?: string })?.type;
  if (type === "jobLens.armProviderCapture" || type === "jobLens.clearProviderCapture") {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("options/options.html")) return;
    void (async () => {
      if (type === "jobLens.clearProviderCapture") { await cacheMutation(() => chrome.storage.session.remove(PROVIDER_TRACE_KEY)); return; }
      const settings = await readSettings();
      if (!settings.resume || !settings.apiToken || !settings.consent.automaticAnalysis) throw new Error("Save your reviewed CV, API key and matching consent first.");
      await cacheMutation(() => chrome.storage.session.set({ [PROVIDER_TRACE_KEY]: {
        phase: "armed", captureId: crypto.randomUUID(), expiresAt: Date.now() + 5 * 60 * 1000,
        message: "Ready for the next fresh analysis. Return to the job and click Re-analyze within five minutes.",
      } }));
    })().then(() => respond({ ok: true }), error => respond({ ok: false, message: error instanceof Error ? error.message : "Could not prepare the capture." }));
    return true;
  }
  if ((message as { type?: string })?.type !== "jobLens.openSettings" || sender.id !== chrome.runtime.id
    || !sender.url || !currentRoute(sender.url).isJobsPage) return;
  void chrome.runtime.openOptionsPage().then(() => respond({ ok: true }), () => respond({ ok: false }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  epoch++;
  for (const session of sessions) {
    cancel(session);
    try { session.port.postMessage({ type: "invalidate" }); } catch { session.closed = true; }
  }
  void cacheMutation(() => chrome.storage.session.remove([CACHE_KEY, PROVIDER_TRACE_KEY]));
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
