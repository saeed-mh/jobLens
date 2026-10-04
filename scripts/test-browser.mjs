import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SAMPLE_TEXT, createDocx, writeFixtures } from "./test-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".browser-cache");
const { chromium } = await import("playwright");
const artifacts = path.join(root, ".test-artifacts");
const fixtures = path.join(artifacts, "fixtures");
await writeFixtures(fixtures);
await mkdir(path.join(artifacts, "profiles"), { recursive: true });
const profile = await mkdtemp(path.join(artifacts, "profiles", "stage2-"));
const extensionPath = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors = [];
const externalRequests = [];
context.on("page", (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()); });
});
context.on("request", (request) => {
  if (/^https?:/.test(request.url())) externalRequests.push(request.url());
});

try {
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  const installed = await manager.evaluate(() => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }));
  const extension = installed.find((item) => item.name === "Job Lens");
  assert.ok(extension, "Job Lens must load as an actual extension");
  const baseUrl = `chrome-extension://${extension.id}`;
  await manager.close();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (dialog) => dialog.accept());
  const optionsUrl = `${baseUrl}/options/options.html`;
  await page.goto(optionsUrl);
  const waitText = async (text, selector = "#page-message") => page.waitForFunction(
    ({ text, selector }) => document.querySelector(selector)?.textContent.includes(text), { text, selector });
  const stored = () => page.evaluate(async () => (await chrome.storage.local.get("jobLens.settings.v1"))["jobLens.settings.v1"]);
  const upload = async (name) => {
    await page.locator("#resume-file").setInputFiles(path.join(fixtures, name));
    await page.waitForFunction(() => !document.getElementById("upload-status").textContent.startsWith("Reading "));
  };
  const confirm = async () => {
    await page.locator("#confirm-resume").check();
    await page.locator("#save-resume").click();
    await waitText("Resume confirmed and saved locally");
  };
  await waitText("Settings loaded");
  assert.equal(await page.locator("#automatic-analysis").isEnabled(), false);
  assert.equal(await stored(), undefined);

  await upload("sample-resume.pdf");
  await waitText("Text extracted", "#upload-status");
  assert.equal(await page.locator("#resume-preview").inputValue(), SAMPLE_TEXT);
  assert.equal(await stored(), undefined, "Extracting a file must not save it");
  assert.equal(await page.locator("#save-resume").isEnabled(), false);
  await confirm();
  const first = await stored();
  assert.equal(first.resume.text, SAMPLE_TEXT);
  assert.deepEqual(Object.keys(first.resume).sort(), ["confirmedAt", "text", "version"]);
  console.log("PASS: local PDF extraction, review gate, and confirmed storage");

  await page.locator("#add-language").click();
  await page.locator(".language-name").fill("German");
  await page.locator(".language-level").selectOption("intermediate");
  await page.locator("#acceptable-cities").fill("Berlin\nHamburg");
  await page.locator("#remote-work").selectOption("hybrid");
  await page.locator('input[name="employment"][value="full-time"]').check();
  await page.locator("#automatic-analysis").check();
  await page.locator("#save-preferences").click();
  await waitText("Preferences and consent saved locally");
  const withPreferences = await stored();
  assert.equal(withPreferences.consent.automaticAnalysis, true);
  assert.deepEqual(withPreferences.preferences.acceptableCities, ["Berlin", "Hamburg"]);
  assert.equal(withPreferences.preferences.languages[0].proficiency, "intermediate");
  assert.notEqual(withPreferences.preferencesVersion, first.preferencesVersion);
  await page.reload(); await waitText("Settings loaded");
  assert.equal(await page.locator("#resume-preview").inputValue(), SAMPLE_TEXT);
  assert.equal(await page.locator("#automatic-analysis").isChecked(), true);
  console.log("PASS: preferences and consent survive reload");

  for (const name of ["no-text.pdf", "corrupted.pdf", "corrupted.docx", "too-many-pages.pdf"]) {
    await upload(name);
    assert.equal(await page.locator("#upload-status").getAttribute("class"), "error");
    assert.equal((await stored()).resume.version, first.resume.version);
  }
  await page.locator("#resume-file").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("renamed text") });
  await waitText("not a valid PDF", "#upload-status");
  await page.locator("#resume-file").setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await waitText("too large", "#upload-status");
  assert.equal((await stored()).resume.version, first.resume.version);
  console.log("PASS: no-text, corrupt, disguised, oversized, and over-page-limit files never replace the saved resume");

  await upload("mixed-pages.pdf");
  assert.equal(await page.locator("#upload-warning").isVisible(), true);
  await page.locator("#discard-draft").click();
  await upload("sample-resume.docx");
  await waitText("Text extracted", "#upload-status");
  assert.equal(await page.locator("#resume-preview").inputValue(), SAMPLE_TEXT);
  await page.locator("#resume-preview").fill(`${SAMPLE_TEXT} Docker, Kubernetes, and CI/CD.`);
  assert.equal(await page.locator("#automatic-analysis").isEnabled(), false);
  await confirm();
  const replacement = await stored();
  assert.notEqual(replacement.resume.version, first.resume.version);
  assert.equal(replacement.consent.automaticAnalysis, false);
  assert.deepEqual(replacement.preferences, withPreferences.preferences);
  console.log("PASS: DOCX extraction, editing, mixed-PDF warning, and replacement revoke prior consent");

  await page.locator("#resume-file").setInputFiles({ name: "plain-text.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: createDocx(`${SAMPLE_TEXT} <script>globalThis.injected = true</script> تجربه توسعه نرم افزار`),
  });
  await waitText("Text extracted", "#upload-status");
  assert.ok((await page.locator("#resume-preview").inputValue()).includes("<script>"));
  assert.equal(await page.evaluate(() => globalThis.injected), undefined);
  await page.locator("#discard-draft").click();

  await page.locator("#automatic-analysis").check();
  await page.locator("#save-preferences").click(); await waitText("Preferences and consent saved locally");
  await page.locator("#disable-analysis").click(); await waitText("Automatic analysis preference disabled");
  assert.equal((await stored()).consent.automaticAnalysis, false);
  await page.locator("#delete-resume").click(); await waitText("Saved resume deleted");
  assert.equal((await stored()).resume, null);
  assert.deepEqual((await stored()).preferences, withPreferences.preferences);
  assert.equal(await page.locator("#resume-review").isVisible(), false);
  console.log("PASS: document markup stays plain text, consent can be disabled, and resume deletion preserves preferences");

  await upload("sample-resume.docx"); await confirm();
  const secondTab = await context.newPage();
  secondTab.on("dialog", (dialog) => dialog.accept());
  await secondTab.goto(optionsUrl);
  await secondTab.waitForFunction(() => document.getElementById("page-message").textContent.includes("Settings loaded"));
  await page.locator("#resume-preview").fill(`${SAMPLE_TEXT} Unsaved old draft.`);
  await secondTab.locator("#delete-all").click();
  await waitText("changed in another tab");
  assert.equal(await page.locator("#resume-preview").inputValue(), "");
  assert.equal(await page.locator("#save-resume").isEnabled(), false);
  assert.equal(await stored(), undefined);
  await secondTab.close();
  await page.locator("#reload-settings").click(); await waitText("Settings loaded");
  assert.equal(await page.locator("#acceptable-cities").inputValue(), "");
  console.log("PASS: deleting all data clears another tab's stale resume draft");

  await page.locator("#resume-file").setInputFiles(path.join(fixtures, "sample-resume.pdf"));
  const newerText = `${SAMPLE_TEXT} This is the newer document.`;
  await page.locator("#resume-file").setInputFiles({ name: "newer.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: createDocx(newerText) });
  await waitText("Text extracted", "#upload-status");
  assert.equal(await page.locator("#resume-preview").inputValue(), newerText);
  await confirm();
  const beforeTimeout = await stored();
  await page.clock.install();
  await page.evaluate(() => {
    globalThis.originalWorker = globalThis.Worker;
    globalThis.Worker = class { postMessage() {} terminate() {} };
  });
  await page.locator("#resume-file").setInputFiles(path.join(fixtures, "sample-resume.pdf"));
  await waitText("Reading", "#upload-status");
  await page.clock.fastForward(31_000);
  await waitText("took too long", "#upload-status");
  assert.equal((await stored()).resume.version, beforeTimeout.resume.version);
  await page.evaluate(() => { globalThis.Worker = globalThis.originalWorker; delete globalThis.originalWorker; });
  await page.clock.resume();
  console.log("PASS: switching files keeps the newest draft; extraction timeout preserves the confirmed resume");

  await upload("sample-resume.pdf"); await confirm();
  await page.locator("#add-language").click(); await page.locator(".language-name").fill("English");
  await page.locator("#save-preferences").click(); await waitText("Preferences and consent saved locally");
  await page.screenshot({ path: path.join(artifacts, "settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "settings-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const popup = await context.newPage();
  await popup.goto(`${baseUrl}/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById("resume-status").textContent.includes("Confirmed resume"));
  assert.equal(await popup.locator("#extension-version").textContent(), manifest.version);
  await popup.locator("#open-settings").click();
  console.log("PASS: popup status, settings navigation, and narrow-screen layout");

  assert.deepEqual(errors, [], "The extension must not have script or CSP errors");
  assert.deepEqual(externalRequests, [], "Uploading and saving must not make network requests");
  console.log("PASS: no script/CSP errors and no HTTP requests during stage 2");
} finally {
  await context.close();
}
