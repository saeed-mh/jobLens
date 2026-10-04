import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { SAMPLE_TEXT } from "./test-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({ absWorkingDir: root, entryPoints: ["src/shared/settings.ts", "src/shared/storage.ts", "src/resume/validation.ts", "src/linkedin/readiness.ts", "src/linkedin/extract.ts"],
  outbase: "src", outdir: ".test-artifacts/modules", bundle: true, platform: "node", format: "esm" });
const load = (file) => import(pathToFileURL(path.join(root, ".test-artifacts/modules", file)).href);
const validation = await load("resume/validation.js");
const model = await load("shared/settings.js");
const storage = await load("shared/storage.js");
const { ReadinessTracker } = await load("linkedin/readiness.js");
const { currentRoute, jobIdFromUrl } = await load("linkedin/extract.js");

test("Job URL parsing handles direct postings, slugs, side panels, and excludes other hosts", () => {
  assert.equal(jobIdFromUrl("https://www.linkedin.com/jobs/view/1234/"), "1234");
  assert.equal(jobIdFromUrl("/jobs/view/backend-engineer-1234"), "1234");
  assert.equal(jobIdFromUrl("https://www.linkedin.com/jobs/search/?currentJobId=5678"), "5678");
  assert.equal(jobIdFromUrl("https://example.com/jobs/view/1234"), null);
  assert.equal(jobIdFromUrl("https://www.linkedin.com/jobs/search/?currentJobId=invalid"), null);
  assert.equal(currentRoute("https://www.linkedin.com/feed/").isJobsPage, false);
});

const job = () => ({ jobId: "100", domJobId: "100", title: "Backend Engineer", company: "Example",
  description: `${SAMPLE_TEXT} Build reliable backend services and collaborate with product teams.`,
  descriptionElement: {}, loading: false, collapsed: false });

test("Job readiness requires stable text plus a title, identity, and no loading/collapse signals", () => {
  const tracker = new ReadinessTracker(); tracker.navigate("100");
  const input = job();
  assert.equal(tracker.observe(input, 0).phase, "reading");
  assert.equal(tracker.observe(input, 1199).phase, "reading");
  assert.equal(tracker.observe(input, 1200).phase, "ready");
  for (const changes of [{ loading: true }, { collapsed: true }, { title: "" }, { description: "Loading…" }, { jobId: null }]) {
    assert.equal(tracker.observe({ ...input, ...changes }, 3000).phase, "waiting");
  }
  assert.equal(tracker.canExpand({ ...input, loading: true }), false);
  assert.equal(tracker.observe({ ...input, description: "x".repeat(100001) }, 4000).phase, "unavailable");
});

test("Switching jobs never declares the previous description ready under the new identity", () => {
  const tracker = new ReadinessTracker(); tracker.navigate("100");
  const first = job(); tracker.observe(first, 0); tracker.observe(first, 1200);
  tracker.navigate("200");
  assert.equal(tracker.observe(first, 2000).phase, "waiting");
  const staleDescription = { ...first, jobId: "200", domJobId: "200", title: "Data Engineer" };
  assert.equal(tracker.observe(staleDescription, 4000).phase, "waiting");
  assert.equal(tracker.canExpand(staleDescription), false);
  const newJob = { ...staleDescription, description: `${first.description} New position working on analytics.` };
  assert.equal(tracker.canExpand(newJob), true);
  assert.equal(tracker.observe(newJob, 5000).phase, "reading");
  assert.equal(tracker.observe(staleDescription, 5500).phase, "waiting");
  assert.equal(tracker.observe(newJob, 6000).phase, "reading");
  assert.equal(tracker.observe(newJob, 7200).phase, "ready");
});

test("DOM-only switches and description replacements restart the readiness checks", () => {
  const tracker = new ReadinessTracker();
  const first = job(); tracker.observe(first, 0); tracker.observe(first, 1200);
  const second = { ...first, jobId: "200", domJobId: "200", title: "Data Engineer" };
  assert.equal(tracker.observe(second, 2000).phase, "waiting");
  const replaced = { ...second, descriptionElement: {} };
  assert.equal(tracker.observe(replaced, 3000).phase, "reading");
  assert.equal(tracker.observe(replaced, 4200).phase, "ready");
  tracker.invalidate();
  assert.equal(tracker.observe(replaced, 5000).phase, "reading");
});

test("Changing routing metadata without changing the job does not invalidate its identity", () => {
  const tracker = new ReadinessTracker(); tracker.navigate("100");
  const input = job(); tracker.observe(input, 0); tracker.observe(input, 1200);
  tracker.navigate(null);
  assert.equal(tracker.observe(input, 2000).phase, "reading");
  assert.equal(tracker.observe(input, 3200).phase, "ready");
  tracker.navigate("100");
  assert.equal(tracker.observe(input, 4000).phase, "reading");
  assert.equal(tracker.observe(input, 5200).phase, "ready");
});

test("File validation rejects unsupported, empty, oversized, and mismatched files", () => {
  const file = { name: "resume.pdf", type: "application/pdf", size: 100 };
  assert.equal(validation.validateFile(file), "pdf");
  assert.equal(validation.validateFile({ ...file, type: "" }), "pdf");
  assert.equal(validation.validateFile({ ...file, name: "RESUME.DOCX", type: "application/octet-stream" }), "docx");
  for (const changes of [{ name: "resume.doc" }, { size: 0 }, { size: 5 * 1024 * 1024 + 1 }, { type: "image/png" }]) {
    assert.throws(() => validation.validateFile({ ...file, ...changes }));
  }
  assert.throws(() => validation.validateSignature(new TextEncoder().encode("renamed image"), "pdf"));
  assert.throws(() => validation.validateSignature(new TextEncoder().encode("plain text"), "docx"));
});

test("Missing text, punctuation-only text, and excessive text are not valid resumes", () => {
  for (const text of ["", "short", "!".repeat(100), "x".repeat(100001)]) assert.throws(() => validation.validateResumeText(text));
  assert.equal(validation.validateResumeText(`  ${SAMPLE_TEXT}\r\n  `), SAMPLE_TEXT);
  assert.doesNotThrow(() => validation.validateResumeText("تجربه توسعه نرم افزار با زبان تایپ اسکریپت و پایتون و طراحی سامانه های توزیع شده"));
});

test("Resume replacement changes the version and revokes consent; unchanged text keeps the version", () => {
  const confirmed = model.confirmResume(model.defaultSettings(), SAMPLE_TEXT);
  const enabled = model.updatePreferences({ ...confirmed, apiToken: "synthetic-test-key-01234567890123456789" }, confirmed.preferences, true);
  assert.equal(enabled.consent.automaticAnalysis, true);
  assert.equal(model.confirmResume(enabled, ` ${SAMPLE_TEXT} `).resume.version, confirmed.resume.version);
  const changed = model.confirmResume(enabled, `${SAMPLE_TEXT} Docker and Kubernetes.`);
  assert.notEqual(changed.resume.version, confirmed.resume.version);
  assert.equal(changed.consent.automaticAnalysis, false);
  assert.equal(model.withoutResume(enabled).resume, null);
  assert.equal(model.withoutResume(enabled).consent.automaticAnalysis, false);
});

test("Preferences get an independent version and validate language proficiency", () => {
  const initial = model.defaultSettings();
  assert.throws(() => model.updatePreferences(initial, initial.preferences, true));
  const preferences = { languages: [{ name: " German ", proficiency: "intermediate" }], acceptableCities: ["Berlin"], remoteWork: "hybrid", employmentTypes: ["full-time"] };
  const updated = model.updatePreferences(initial, preferences, false);
  assert.notEqual(updated.preferencesVersion, initial.preferencesVersion);
  assert.equal(updated.preferences.languages[0].name, "German");
  assert.equal(model.updatePreferences(updated, updated.preferences, false).preferencesVersion, updated.preferencesVersion);
  assert.throws(() => model.validatePreferences({ ...preferences, languages: [{ name: "", proficiency: "fluent" }] }));
  assert.throws(() => model.validatePreferences({ ...preferences, remoteWork: "invalid" }));
  assert.throws(() => model.validatePreferences({ ...preferences, languages: [{ name: "German", proficiency: "fluent" }, { name: "german", proficiency: "basic" }] }));
});

test("Working-student preferences save and reload distinctly from part-time without replacing existing settings", () => {
  const initial = model.confirmResume(model.defaultSettings(), SAMPLE_TEXT);
  const legacy = model.updatePreferences(initial, { ...initial.preferences, employmentTypes: ["part-time"] }, false);
  const updated = model.updatePreferences(legacy, { ...legacy.preferences, employmentTypes: ["working-student"] }, false);
  const reloaded = model.parseSettings(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(reloaded.preferences.employmentTypes, ["working-student"]);
  assert.notEqual(updated.preferencesVersion, legacy.preferencesVersion);
  assert.equal(reloaded.resume.version, initial.resume.version);
  assert.deepEqual(model.parseSettings(JSON.parse(JSON.stringify(legacy))).preferences.employmentTypes, ["part-time"]);
  assert.deepEqual(model.validatePreferences({ ...initial.preferences, employmentTypes: [...model.EMPLOYMENT_TYPES] }).employmentTypes, [...model.EMPLOYMENT_TYPES]);
  assert.throws(() => model.validatePreferences({ ...initial.preferences, employmentTypes: ["student-made-up"] }));
});

test("Exact CEFR preferences save and reload without reinterpreting legacy broad levels", () => {
  const initial = model.defaultSettings();
  const legacy = model.updatePreferences(initial, { ...initial.preferences, languages: [{ name: "German", proficiency: "basic" }] }, false);
  assert.equal(model.parseSettings(JSON.parse(JSON.stringify(legacy))).preferences.languages[0].proficiency, "basic");
  for (const proficiency of ["a1", "a2", "b1", "b2", "c1", "c2"]) {
    const updated = model.updatePreferences(legacy, { ...legacy.preferences, languages: [{ name: "German", proficiency }] }, false);
    assert.equal(model.parseSettings(JSON.parse(JSON.stringify(updated))).preferences.languages[0].proficiency, proficiency);
    assert.notEqual(updated.preferencesVersion, legacy.preferencesVersion);
  }
  assert.throws(() => model.validatePreferences({ ...initial.preferences, languages: [{ name: "German", proficiency: "b3" }] }));
});

test("Malformed storage cannot silently enable consent", () => {
  assert.throws(() => model.parseSettings({ schemaVersion: 2 }));
  const state = model.confirmResume(model.defaultSettings(), SAMPLE_TEXT);
  state.consent.automaticAnalysis = true; state.consent.noticeVersion = "old-notice";
  assert.equal(model.parseSettings(state).consent.automaticAnalysis, false);
});

test("Storage is local, restricted, rejects stale saves, and can delete all saved information", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { locks: { request: async (_name, callback) => callback() } }, configurable: true });
  const data = {};
  const sessionData = { "jobLens.analysisCache.v1": [], "jobLens.providerTrace.v1": { resume: "private capture" } };
  let accessLevel;
  globalThis.chrome = { storage: { local: {
    setAccessLevel: async (options) => { accessLevel = options.accessLevel; },
    get: async () => structuredClone(data),
    set: async (values) => Object.assign(data, structuredClone(values)),
    remove: async (key) => { delete data[key]; },
  }, session: { remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionData[key]; } } } };
  const initial = await storage.readSettings();
  const confirmed = model.confirmResume(initial, SAMPLE_TEXT);
  await storage.saveSettings(confirmed, initial.revision);
  assert.equal(accessLevel, "TRUSTED_CONTEXTS");
  assert.equal((await storage.readSettings()).resume.text, SAMPLE_TEXT);
  assert.deepEqual(Object.keys(data[model.SETTINGS_KEY].resume).sort(), ["confirmedAt", "text", "version"]);
  await assert.rejects(storage.saveSettings(confirmed, "outdated"), /another tab/);
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error("Storage unavailable"); };
  await assert.rejects(storage.saveSettings(model.confirmResume(confirmed, `${SAMPLE_TEXT} New content.`), confirmed.revision), /Storage unavailable/);
  assert.equal((await storage.readSettings()).resume.version, confirmed.resume.version);
  chrome.storage.local.set = originalSet;
  await storage.deleteAllSettings();
  assert.deepEqual(data, {});
  assert.deepEqual(sessionData, {});
});
