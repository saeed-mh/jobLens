import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { SAMPLE_TEXT } from "./test-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({ absWorkingDir: root, entryPoints: ["src/shared/settings.ts", "src/shared/storage.ts", "src/resume/validation.ts"],
  outbase: "src", outdir: ".test-artifacts/modules", bundle: true, platform: "node", format: "esm" });
const load = (file) => import(pathToFileURL(path.join(root, ".test-artifacts/modules", file)).href);
const validation = await load("resume/validation.js");
const model = await load("shared/settings.js");
const storage = await load("shared/storage.js");

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
  const enabled = model.updatePreferences(confirmed, confirmed.preferences, true);
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

test("Malformed storage cannot silently enable consent", () => {
  assert.throws(() => model.parseSettings({ schemaVersion: 2 }));
  const state = model.confirmResume(model.defaultSettings(), SAMPLE_TEXT);
  state.consent.automaticAnalysis = true; state.consent.noticeVersion = "old-notice";
  assert.equal(model.parseSettings(state).consent.automaticAnalysis, false);
});

test("Storage is local, restricted, rejects stale saves, and can delete all saved information", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { locks: { request: async (_name, callback) => callback() } }, configurable: true });
  const data = {};
  let accessLevel;
  globalThis.chrome = { storage: { local: {
    setAccessLevel: async (options) => { accessLevel = options.accessLevel; },
    get: async () => structuredClone(data),
    set: async (values) => Object.assign(data, structuredClone(values)),
    remove: async (key) => { delete data[key]; },
  } } };
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
});
