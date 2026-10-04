import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import path from "node:path";
import { assessments as makeAssessments, provider, providerForQuestions } from "./fixtures/score-fixtures.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const extensionManifest = JSON.parse(await readFile(path.join(root, "dist/manifest.json"), "utf8"));
const languageSample = JSON.parse(await readFile(path.join(root, "backend/sample-language-request.json"), "utf8"));
const requirementsSample = JSON.parse(await readFile(path.join(root, "backend/sample-requirements-request.json"), "utf8"));
const languageSettingsSample = JSON.parse(await readFile(path.join(root, "backend/sample-language-settings-request.json"), "utf8"));
const { default: backendWorker } = await import(pathToFileURL(path.join(root, "backend/dist/worker.js")));
await build({ absWorkingDir: root, entryPoints: ["src/shared/analysis.ts"], outfile: ".test-artifacts/analysis/shared.js", bundle: true, platform: "node", format: "esm" });
const { scoreAssessments, RUBRIC } = await import(pathToFileURL(path.join(root, ".test-artifacts/analysis/shared.js")));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".browser-cache");
const { chromium } = await import("playwright");
const artifacts = path.join(root, ".test-artifacts"); await mkdir(path.join(artifacts, "profiles"), { recursive: true });
const profile = await mkdtemp(path.join(artifacts, "profiles", "matching-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${path.join(root, "dist")}`, `--load-extension=${path.join(root, "dist")}`],
});
const requests = [], errors = [], requirementModelCalls = [];
let mode = "matching", delayedResolve, delayedEntered;
const requirementsBody = requirementsSample.job.description.split("About the job\n")[1];
assert.ok(requirementsBody && !requirementsBody.includes("Paderborn") && !requirementsBody.includes("Hybrid"));
const description = id => id === "960" ? requirementsBody : id === "950" ? languageSample.job.description : `Backend Engineer posting ${id}. We require Python, SQL, REST API development, and three years of relevant professional experience. Fluent English is required. This is a remote full-time position based in Berlin. You will build and maintain reliable backend services.`;
const requirementsHeader = '<div class="job-details-jobs-unified-top-card__primary-description-container">Paderborn, North Rhine-Westphalia, Germany</div><div class="job-details-jobs-unified-top-card__job-insight"><button>Hybrid</button></div><div class="job-details-jobs-unified-top-card__job-insight"><button>Full-time</button></div>';
const html = id => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;background:#f3f2ef}main{max-width:800px;margin:32px auto}.jobs-search__job-details--container{padding:24px;background:white}</style></head><body><main><section class="jobs-search__job-details--container" data-job-id="${id}"><div class="job-details-jobs-unified-top-card__job-title"><h1><a href="/jobs/view/${id}/">Backend Engineer ${id}</a></h1></div>${id === "960" ? requirementsHeader : ""}<div class="jobs-description"><div id="job-details"><p>${description(id)}</p></div></div></section></main></body></html>`;
context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
await context.route("https://www.linkedin.com/**", route => {
  const url = new URL(route.request().url());
  return route.fulfill({ contentType: "text/html", body: html(url.searchParams.get("currentJobId") ?? "100") });
});
await context.route("https://job-lens-api.saeedmohh10.workers.dev/**", async route => {
  const input = route.request().postDataJSON();
  requests.push({ input, headers: route.request().headers() });
  const currentMode = mode;
  if (currentMode === "requirements" || currentMode === "working-student") {
    const raw = provider(makeAssessments(currentMode === "working-student" ? {} : { skills: { score: 2.821 }, experience: { status: "not_required" },
      language: { status: "not_required" }, location: { status: "not_required" }, employment: { status: "not_required" } }), RUBRIC);
    raw.privateField = "PRIVATE_PROVIDER_TEXT";
    const response = await backendWorker.fetch(new Request("https://worker.example/analyze", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: route.request().headers().authorization,
        ...(route.request().headers()["x-job-lens-debug"] ? { "X-Job-Lens-Debug": route.request().headers()["x-job-lens-debug"] } : {}) }, body: JSON.stringify(input) }),
    { JOB_LENS_API_TOKEN: "synthetic-matching-key-01234567890123456789", AI: { run: async (...args) => { requirementModelCalls.push(args); return providerForQuestions(raw, args[1].questions); } } });
    await route.fulfill({ status: response.status, json: await response.json() }); return;
  }
  if (currentMode === "delayed") { delayedEntered?.(); await new Promise(resolve => { delayedResolve = resolve; }); }
  if (currentMode === "timeout") await new Promise(resolve => setTimeout(resolve, 26_000));
  if (currentMode === "401") { await route.fulfill({ status: 401, json: { error: { code: "unauthorized" } } }); return; }
  if (currentMode === "413") { await route.fulfill({ status: 413, json: { error: { code: "text_too_large", message: "PRIVATE_PROVIDER_TEXT" } } }); return; }
  if (currentMode === "429") { await route.fulfill({ status: 429, json: { error: { code: "rate_limited" } } }); return; }
  if (currentMode === "bad-json") { await route.fulfill({ contentType: "application/json", body: "PRIVATE_PROVIDER_TEXT invalid-json" }); return; }
  const overrides = currentMode === "unknown" ? { skills: { status: "unknown" }, experience: { status: "unknown" }, language: { status: "unknown" } }
    : currentMode === "conflict" ? { skills: { score: 3.7, conflict: "conflict" }, employment: { score: 2, conflict: "conflict" } }
    : currentMode === "uncertain" ? { skills: { status: "unknown" }, experience: { score: 3.7 }, language: { status: "unknown" }, location: { status: "unknown" }, employment: { status: "unknown" } }
    : currentMode === "reported" ? { skills: { score: 3.7 }, experience: { score: 4.2 }, language: { status: "not_required" }, location: { status: "unknown" }, employment: { status: "unknown" } }
    : currentMode === "zero" ? Object.fromEntries(["skills", "experience", "language", "location", "employment"].map(d => [d, { score: 0 }])) : {};
  const assessments = makeAssessments(overrides);
  const result = { apiVersion: "job-lens-analysis-v2", assessmentVersion: "clef-score-v9", scoringVersion: "weighted-clef-score-v1", rubricVersion: "alignment-0-5-v1",
    model: "@cf/cloudflare/clef-flash", requestId: input.requestId, jobId: input.job.id,
    resumeVersion: input.resume.version, preferencesVersion: input.preferencesVersion,
    assessments, score: scoreAssessments(assessments), durationMs: 120, privateField: "must-not-reach-page" };
  if (currentMode === "outdated") result.scoringVersion = "weighted-evidence-v1";
  if (currentMode === "outdated-assessment") result.assessmentVersion = "clef-score-v7";
  try { await route.fulfill({ json: result }); } catch { /* A job switch may abort this intercepted request. */ }
});
try {
  const manager = await context.newPage(); await manager.goto("chrome://extensions");
  const info = await manager.evaluate(() => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }));
  const extension = info.find(e => e.name === "Job Lens"); assert.ok(extension); await manager.close();
  const options = await context.newPage(); options.on("dialog", d => d.accept());
  await options.goto(`chrome-extension://${extension.id}/options/options.html`);
  const sample = { schemaVersion: 1, revision: "fixture-1", resume: { text: "Backend engineer with five years of professional Python and SQL experience. Built REST APIs and worked with PostgreSQL. English proficiency: fluent.", version: "resume-v1", confirmedAt: new Date().toISOString() },
    preferences: { languages: [{ name: "English", proficiency: "fluent" }], acceptableCities: ["Berlin"], remoteWork: "remote", employmentTypes: ["full-time"] },
    preferencesVersion: "preferences-v1", apiToken: "synthetic-matching-key-01234567890123456789",
    consent: { automaticAnalysis: true, noticeVersion: "stage2-local-setup-v1", updatedAt: new Date().toISOString() } };
  await options.evaluate(async settings => chrome.storage.local.set({ "jobLens.settings.v1": settings }), sample);
  await options.reload(); await options.waitForFunction(() => document.getElementById("page-message").textContent.includes("Settings loaded"));
  assert.equal(await options.locator("#automatic-analysis").isChecked(), false);
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=100");
  const status = page.locator("#job-lens-status-bar-v1").locator("[data-match-status]");
  const waitStatus = text => page.waitForFunction(text => document.querySelector("#job-lens-status-bar-v1")?.shadowRoot.querySelector("[data-match-status]")?.textContent.includes(text), text);
  await waitStatus("consent"); assert.equal(requests.length, 0);
  console.log("PASS: old consent is revoked and no API call occurs before explicit new consent");
  await options.locator("#automatic-analysis").check(); await options.locator("#save-preferences").click();
  await waitStatus("Match: 100/100"); assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, `Bearer ${sample.apiToken}`);
  assert.equal(requests[0].input.resume.text, sample.resume.text);
  assert.equal(requests[0].input.job.description, description("100"));
  assert.equal(requests[0].input.consent.noticeVersion, "job-lens-cloudflare-v1");
  assert.equal(requests[0].input.resume.file, undefined);
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  const barText = () => page.locator("#job-lens-status-bar-v1").evaluate(e => e.shadowRoot.textContent);
  assert.ok((await barText()).includes("40%"));
  assert.ok(!(await barText()).includes(sample.apiToken));
  assert.ok(!(await barText()).includes("must-not-reach-page"));
  await page.screenshot({ path: path.join(artifacts, "matching-details.png") });
  console.log("PASS: real extension background request, sanitized results, score/details, and no secret in page UI");
  await page.reload(); await waitStatus("Cached"); assert.equal(requests.length, 1);
  // Concurrent tabs share one in-flight inference; results remain scoped to the current job.
  mode = "delayed";
  const entered = new Promise(resolve => { delayedEntered = resolve; });
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=200"); await entered;
  const second = await context.newPage(); await second.goto("https://www.linkedin.com/jobs/search/?currentJobId=200");
  await second.waitForFunction(() => document.querySelector("#job-lens-status-bar-v1")?.shadowRoot.textContent.includes("Analyzing with AI"));
  assert.equal(requests.length, 2);
  mode = "conflict";
  await page.evaluate(newDescription => {
    history.pushState({}, "", "/jobs/search/?currentJobId=300");
    const root = document.querySelector(".jobs-search__job-details--container"); root.dataset.jobId = "300";
    const link = root.querySelector("h1 a"); link.href = "/jobs/view/300/"; link.textContent = "Backend Engineer 300";
    root.querySelector("#job-details p").textContent = newDescription;
  }, description("300"));
  await waitStatus("Match: 86.6/100");
  delayedResolve();
  await second.waitForFunction(() => document.querySelector("#job-lens-status-bar-v1")?.shadowRoot.textContent.includes("Match: 100/100"));
  assert.ok((await status.textContent()).includes("86.6/100"));
  await second.close();
  console.log("PASS: cache survives reload, concurrent requests deduplicate, and late previous-job results never overwrite the current job");
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  assert.ok((await barText()).includes("qualification conflicts: Skills"));
  mode = "unknown";
  await options.locator("#remote-work").selectOption("hybrid"); await options.locator("#save-preferences").click();
  await waitStatus("Provisional match: 10–100/100");
  assert.equal(requests.length, 4);
  console.log("PASS: preferences invalidate the cache; missing professional evidence gives a provisional range and no precise score");
  mode = "uncertain";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=350"); await waitStatus("Provisional match: 22.2–92.2/100");
  const diagnosticRequests = requests.length;
  await page.reload(); await waitStatus("Cached");
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  assert.ok((await barText()).includes("Unknown — comparison unresolved"));
  assert.ok((await barText()).includes("Weighted average of assessed criteria: 74/100 (incomplete assessment)"));
  assert.ok((await barText()).includes("Criteria assessed: 30%"));
  assert.ok(!(await barText()).includes("qualification conflicts: Language"));
  await page.locator("#job-lens-status-bar-v1").getByText("Troubleshoot this assessment", { exact: true }).click();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://www.linkedin.com" });
  const copy = page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Copy matching diagnostics", exact: true });
  await copy.click();
  await page.waitForFunction(() => {
    const root = document.querySelector("#job-lens-status-bar-v1")?.shadowRoot;
    return [...(root?.querySelectorAll("button") ?? [])].some(b => b.textContent.includes("paste it in this conversation") || b.textContent.includes("Select the report below"));
  });
  const fallback = page.locator("#job-lens-status-bar-v1").getByRole("textbox", { name: "Matching diagnostics; select and copy this report", includeHidden: true });
  const diagnosticText = await fallback.isVisible() ? await fallback.inputValue() : await page.evaluate(() => navigator.clipboard.readText());
  const report = JSON.parse(diagnosticText);
  assert.equal(report.format, "job-lens-match-diagnostics-v2"); assert.equal(report.extensionVersion, extensionManifest.version);
  assert.equal(report.cached, true); assert.equal(report.score.coverage, 30);
  assert.equal(report.assessments.skills.status.decision, "unknown"); assert.equal(report.assessments.skills.rating, null);
  assert.equal(report.assessments.experience.rating.score, 3.7);
  assert.equal(report.score.breakdown.find(row => row.dimension === "experience").points, 74);
  for (const privateText of [sample.apiToken, sample.resume.text, description("350"), "must-not-reach-page", requests.at(-1).input.requestId, requests.at(-1).input.resume.version, requests.at(-1).input.preferencesVersion]) {
    assert.ok(!diagnosticText.includes(privateText));
  }
  assert.equal(requests.length, diagnosticRequests);
  await page.screenshot({ path: path.join(artifacts, "matching-unresolved.png") });
  console.log("PASS: unknown criteria remain unscored and cached numeric diagnostics exclude private input without another AI request");
  mode = "reported";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=360"); await waitStatus("Provisional match: 68.5–81/100");
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  const skillsRow = page.locator("#job-lens-status-bar-v1").getByRole("row").filter({ hasText: "Skills" });
  assert.deepEqual(await skillsRow.getByRole("cell").allTextContents(), ["Skills", "50%", "Assessed", "3.7", "74"]);
  assert.ok((await barText()).includes("Weighted average of assessed criteria: 78.3/100 (incomplete assessment)"));
  assert.ok((await barText()).includes("Criteria assessed: 88%"));
  assert.ok((await barText()).includes("Unresolved requirements: Location / work arrangement, Employment type"));
  assert.ok((await barText()).includes("not a statistical confidence interval"));
  const reportedRequests = requests.length;
  await page.screenshot({ path: path.join(artifacts, "matching-score.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const tableRegion = page.locator("#job-lens-status-bar-v1").getByRole("region", { name: "Criterion score table" });
  assert.ok(await tableRegion.evaluate(e => e.scrollWidth > e.clientWidth));
  const geometry = await page.locator("#job-lens-status-bar-v1").evaluate(e => ({ host: e.clientWidth, bar: e.shadowRoot.querySelector(".bar").scrollWidth }));
  assert.ok(geometry.bar <= geometry.host);
  await page.screenshot({ path: path.join(artifacts, "matching-score-narrow.png") });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.reload(); await waitStatus("Provisional match: 68.5–81/100"); await waitStatus("Cached");
  assert.equal(requests.length, reportedRequests);
  console.log("PASS: fractional 3.7/5 displays 74/100, excluded language normalizes weights, and unknown work criteria preserve an incomplete weighted average and range");
  await options.evaluate(async () => {
    const key = "jobLens.analysisCache.v1";
    const entries = (await chrome.storage.session.get(key))[key];
    for (const entry of entries) entry.result.scoringVersion = "weighted-evidence-v1";
    await chrome.storage.session.set({ [key]: entries });
  });
  await page.reload(); await waitStatus("Provisional match: 68.5–81/100");
  assert.equal(requests.length, reportedRequests + 1);
  assert.ok(!(await status.textContent()).includes("Cached"));
  console.log("PASS: cached results from the old scoring policy are rejected and replaced by a current assessment");
  await options.evaluate(async () => {
    const key = "jobLens.analysisCache.v1";
    const entries = (await chrome.storage.session.get(key))[key];
    for (const entry of entries) entry.result.assessmentVersion = "clef-score-v4";
    await chrome.storage.session.set({ [key]: entries });
  });
  await page.reload(); await waitStatus("Provisional match: 68.5–81/100");
  assert.equal(requests.length, reportedRequests + 2);
  assert.ok(!(await status.textContent()).includes("Cached"));
  mode = "outdated-assessment";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=370"); await waitStatus("outdated result");
  assert.ok(!(await status.textContent()).includes("match:"));
  console.log("PASS: old assessment prompts are rejected for cache entries and new API responses");
  mode = "zero";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=380"); await waitStatus("Match: 0/100");
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  assert.ok((await barText()).includes("Weighted average of assessed criteria: 0/100"));
  console.log("PASS: an assessable zero rating displays zero instead of becoming an unknown result");
  mode = "413";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=390"); await waitStatus("complete analysis request exceeds the input budget");
  assert.ok((await status.textContent()).includes("assessment instructions all count"));
  assert.ok(!(await barText()).includes("PRIVATE_PROVIDER_TEXT"));
  assert.ok(!(await status.textContent()).includes("Match:"));
  console.log("PASS: oversized requests explain the complete budget without exposing provider text or fabricating scores");
  mode = "401";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=400"); await waitStatus("key is invalid");
  assert.equal(await page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Copy matching diagnostics", exact: true }).count(), 0);
  assert.ok(!(await status.textContent()).includes("Match:"));
  mode = "matching";
  await page.locator("#job-lens-status-bar-v1").getByText("Retry analysis", { exact: true }).click(); await waitStatus("Match: 100/100");
  mode = "outdated";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=500"); await waitStatus("outdated result");
  assert.ok(!(await status.textContent()).includes("Match:"));
  console.log("PASS: unauthorized and outdated APIs display errors without scores; retry recovers");
  mode = "429";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=600"); await waitStatus("usage limit");
  assert.ok(!(await status.textContent()).includes("Match:"));
  mode = "bad-json";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=700"); await waitStatus("invalid JSON");
  assert.ok(!(await barText()).includes("PRIVATE_PROVIDER_TEXT"));
  mode = "timeout"; page.setDefaultTimeout(35_000);
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=800"); await waitStatus("timed out");
  assert.ok(!(await status.textContent()).includes("Match:"));
  console.log("PASS: quota errors, malformed private provider output, and actual request timeouts never fabricate scores");
  mode = "delayed";
  const replacementEntered = new Promise(resolve => { delayedEntered = resolve; });
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=900"); await replacementEntered;
  await options.locator("#resume-preview").fill(`${sample.resume.text} Revised professional evidence.`);
  await options.locator("#confirm-resume").check(); await options.locator("#save-resume").click();
  await waitStatus("consent"); delayedResolve();
  assert.ok(!(await status.textContent()).includes("Match:"));
  mode = "matching";
  await options.locator("#automatic-analysis").check(); await options.locator("#save-preferences").click();
  await waitStatus("Match: 100/100");
  assert.notEqual(requests.at(-1).input.resume.version, sample.resume.version);
  assert.equal(requests.at(-1).input.resume.text, `${sample.resume.text} Revised professional evidence.`);
  console.log("PASS: replacing a resume cancels its pending analysis, revokes consent, and uses the new version only after renewed consent");
  await options.locator("#resume-preview").fill(languageSample.resume.text);
  await options.locator("#confirm-resume").check(); await options.locator("#save-resume").click();
  await waitStatus("consent");
  await options.getByRole("button", { name: "Remove language", exact: true }).click();
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=950"); await waitStatus("consent");
  await options.locator("#automatic-analysis").check(); await options.locator("#save-preferences").click();
  await waitStatus("Match: 100/100");
  assert.equal(requests.at(-1).input.resume.text, languageSample.resume.text);
  assert.deepEqual(requests.at(-1).input.preferences.languages, []);
  assert.ok(requests.at(-1).input.job.description.includes("Deutsch und Englisch sehr gut in Wort und Schrift"));
  console.log("PASS: confirmed CV-only German and English levels reach the API with an empty saved language list and the full German requirement");
  mode = "requirements";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=960"); await waitStatus("Provisional match: 22.6–82.6/100");
  await page.locator("#job-lens-status-bar-v1").getByText("Match criteria and requirements", { exact: true }).click();
  assert.equal(requirementModelCalls.length, 2);
  const expectedPosting = `LinkedIn posting details:\nPaderborn, North Rhine-Westphalia, Germany\nHybrid\nFull-time\n\nAbout the job:\n${requirementsBody}`;
  assert.equal(requirementModelCalls[0][1].state.job.description, expectedPosting);
  assert.equal(requests.at(-1).input.job.description, expectedPosting);
  assert.equal(await page.locator("#job-lens-status-bar-v1").locator("pre").textContent(), expectedPosting);
  assert.ok((await barText()).includes("unsupported model answers remain unresolved"));
  assert.ok(!(await barText()).includes("No active requirement"));
  assert.ok(!(await barText()).includes("PRIVATE_PROVIDER_TEXT"));
  await page.locator("#job-lens-status-bar-v1").getByText("Troubleshoot this assessment", { exact: true }).click();
  await page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Copy matching diagnostics", exact: true }).click();
  const repairedReport = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(repairedReport.assessments.language.reportedStatus.decision, "not_required");
  assert.equal(repairedReport.assessments.language.status.decision, "unknown");
  assert.equal(repairedReport.assessments.language.status.probabilities, null);
  assert.ok(repairedReport.assessments.language.issues.includes("unsupported_exclusion"));
  assert.deepEqual(repairedReport.score.excluded, []);
  assert.equal(repairedReport.score.coverage, 40);
  assert.ok(!JSON.stringify(repairedReport).includes("Werkstudenten >= B1"));
  console.log("PASS: supplied posting passes through the real extension and Worker parser; erroneous raw exclusions stay unresolved, with private diagnostics and unchanged grades");
  const beforeCapture = requests.length;
  // Even another trusted extension UI cannot arm a capture: only options can.
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extension.id}/popup/popup.html`);
  const deniedCapture = await popup.evaluate(async () => {
    try { return await chrome.runtime.sendMessage({ type: "jobLens.armProviderCapture" }); } catch { return null; }
  });
  assert.ok(!deniedCapture?.ok);
  assert.equal(await options.evaluate(async () => (await chrome.storage.session.get("jobLens.providerTrace.v1"))["jobLens.providerTrace.v1"]), undefined);
  await popup.close();
  await options.locator("#capture-provider").click();
  await options.waitForFunction(() => document.getElementById("provider-status").textContent.includes("next fresh analysis"));
  assert.equal(requests.length, beforeCapture);
  await page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Re-analyze", exact: true }).click();
  await options.waitForFunction(() => document.getElementById("provider-status").textContent.includes("Captured the actual extension request"));
  await waitStatus("Provisional match: 22.6–82.6/100");
  assert.equal(requests.length, beforeCapture + 1);
  assert.equal(requests.at(-1).headers["x-job-lens-debug"], "requirements-v1");
  const providerTrace = await options.evaluate(async () => (await chrome.storage.session.get("jobLens.providerTrace.v1"))["jobLens.providerTrace.v1"]);
  assert.deepEqual(providerTrace.extensionRequest, requests.at(-1).input);
  assert.deepEqual(providerTrace.debug.request, requirementModelCalls.at(-2)[1]);
  assert.equal(providerTrace.debug.work.rawResponse.answers.location_status.choice, "not_required");
  assert.equal(providerTrace.result.assessments.location.status.decision, "unknown");
  assert.ok(providerTrace.result.assessments.location.issues.includes("unsupported_exclusion"));
  assert.ok(!JSON.stringify(providerTrace).includes(sample.apiToken));
  const [traceDownload] = await Promise.all([options.waitForEvent("download"), options.locator("#download-provider").click()]);
  assert.equal(traceDownload.suggestedFilename(), "job-lens-provider-trace.json");
  assert.deepEqual(JSON.parse(await readFile(await traceDownload.path(), "utf8")), providerTrace);
  const safeWorkReport = await options.locator("#work-provider-diagnostics").inputValue();
  assert.ok(!safeWorkReport.includes(languageSample.resume.text) && !safeWorkReport.includes(sample.apiToken) && !safeWorkReport.includes("PRIVATE_PROVIDER_TEXT"));
  assert.equal(JSON.parse(safeWorkReport).assessments.location.rawStatus.choice, "not_required");
  assert.ok(!(await barText()).includes("PRIVATE_PROVIDER_TEXT") && !(await barText()).includes('"state"'));
  const privateCache = await options.evaluate(async () => (await chrome.storage.session.get("jobLens.analysisCache.v1"))["jobLens.analysisCache.v1"]);
  assert.ok(!JSON.stringify(privateCache).includes("PRIVATE_PROVIDER_TEXT"));
  await options.locator("#clear-provider").click();
  await options.waitForFunction(() => document.getElementById("provider-status").textContent.includes("No provider capture"));
  assert.equal(await options.locator("#work-provider-diagnostics").isVisible(), false);
  assert.equal(await options.locator("#download-provider").isDisabled(), true);
  console.log("PASS: an explicit capture adds no extra model calls; the exact extension/model request and raw response stay in trusted storage, while work diagnostics omit private data");
  await options.locator("#capture-provider").click();
  await options.waitForFunction(() => document.getElementById("provider-status").textContent.includes("next fresh analysis"));
  mode = "working-student";
  await options.locator('input[name="employment"][value="full-time"]').uncheck();
  await options.getByRole("checkbox", { name: "Working student (Werkstudent)", exact: true }).check();
  await options.locator("#save-preferences").click();
  await waitStatus("Match: 100/100");
  assert.equal(await options.evaluate(async () => (await chrome.storage.session.get("jobLens.providerTrace.v1"))["jobLens.providerTrace.v1"]), undefined);
  assert.equal(requests.at(-1).headers["x-job-lens-debug"], undefined);
  assert.deepEqual(requests.at(-1).input.preferences.employmentTypes, ["working-student"]);
  assert.equal(requirementModelCalls.length, 6);
  assert.deepEqual(requirementModelCalls.at(-2)[1].questions.language.instructions.applicationContext,
    { employmentTypes: ["working-student"], selectedBranch: "working-student" });
  assert.equal(requirementModelCalls.at(-2)[1].questions.experience.instructions.applicationContext.selectedBranch, "working-student");
  await options.reload(); await options.waitForFunction(() => document.getElementById("page-message").textContent.includes("Settings loaded"));
  assert.equal(await options.getByRole("checkbox", { name: "Working student (Werkstudent)", exact: true }).isChecked(), true);
  assert.equal(await options.locator('input[name="employment"][value="full-time"]').isChecked(), false);
  console.log("PASS: working-student preference persists, invalidates the old cached analysis, and reaches conditional language/education and employment matching");
  await options.locator("#resume-preview").fill(languageSettingsSample.resume.text);
  await options.locator("#confirm-resume").check(); await options.locator("#save-resume").click();
  await waitStatus("consent");
  await options.locator('input[name="employment"][value="part-time"]').check();
  await options.locator('input[name="employment"][value="internship"]').check();
  await options.locator("#acceptable-cities").fill("Dortmund\nPaderborn");
  for (const language of languageSettingsSample.preferences.languages) {
    await options.locator("#add-language").click();
    await options.locator(".language-name").last().fill(language.name);
    await options.locator(".language-level").last().selectOption(language.proficiency);
  }
  await options.locator("#automatic-analysis").check(); await options.locator("#save-preferences").click();
  await waitStatus("Match: 100/100");
  assert.deepEqual(requests.at(-1).input.preferences, languageSettingsSample.preferences);
  assert.equal(requests.at(-1).input.resume.text, languageSettingsSample.resume.text);
  assert.equal(requirementModelCalls.at(-2)[1].questions.language_status.instructions.applicationContext.selectedBranch, "working-student");
  assert.deepEqual(requirementModelCalls.at(-1)[1].state.workPreferences, {
    location: { acceptableCities: ["Dortmund", "Paderborn"], remoteWork: "hybrid" },
    employment: { employmentTypes: ["part-time", "working-student", "internship"] },
  });
  const beforeCefr = requests.length, oldPrefVersion = requests.at(-1).input.preferencesVersion;
  await options.locator(".language-level").last().selectOption({ label: "B1 (CEFR)" });
  await options.locator("#save-preferences").click();
  await page.waitForFunction(() => document.querySelector("#job-lens-status-bar-v1")?.shadowRoot.textContent.includes("Match: 100/100"));
  await options.waitForFunction(() => document.getElementById("page-message").textContent.includes("Preferences, API key, and consent saved"));
  // Wait on the new request, since the previous visible result may still be present briefly.
  for (let attempt = 0; requests.length === beforeCefr && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  await waitStatus("Match: 100/100");
  assert.equal(requests.length, beforeCefr + 1);
  assert.equal(requests.at(-1).input.preferences.languages[1].proficiency, "b1");
  assert.notEqual(requests.at(-1).input.preferencesVersion, oldPrefVersion);
  assert.equal(requests.at(-1).input.resume.text, languageSettingsSample.resume.text);
  assert.equal(requirementModelCalls.at(-2)[1].questions.language.instructions.applicationContext.selectedBranch, "working-student");
  console.log("PASS: supplied CV lines and screenshot settings reach the Worker intact; mixed employment types select the student branch and saving CEFR B1 invalidates the old assessment");
  mode = "unknown";
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=980"); await waitStatus("Provisional match: 10–100/100");
  await page.reload(); await waitStatus("Cached");
  const beforeRefresh = requests.length;
  const unrelatedCache = await options.evaluate(async () => (await chrome.storage.session.get("jobLens.analysisCache.v1"))["jobLens.analysisCache.v1"].find(e => e.result.jobId === "960"));
  assert.ok(unrelatedCache);
  mode = "matching";
  const reanalyze = page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Re-analyze", exact: true });
  await reanalyze.click(); await waitStatus("Match: 100/100");
  assert.equal(requests.length, beforeRefresh + 1);
  assert.ok(!(await status.textContent()).includes("Cached"));
  const afterRefresh = await options.evaluate(async () => (await chrome.storage.session.get("jobLens.analysisCache.v1"))["jobLens.analysisCache.v1"]);
  assert.deepEqual(afterRefresh.find(e => e.result.jobId === "960"), unrelatedCache);
  assert.equal(afterRefresh.filter(e => e.result.jobId === "980").length, 1);
  await page.reload(); await waitStatus("Match: 100/100"); await waitStatus("Cached");
  assert.equal(requests.length, beforeRefresh + 1);
  console.log("PASS: explicit re-analysis bypasses a cached provisional result once, replaces only that cache entry, and normal reload reuses the fresh result");
  mode = "401";
  await reanalyze.click(); await waitStatus("key is invalid");
  assert.equal(requests.length, beforeRefresh + 2);
  assert.ok(!(await status.textContent()).includes("Match:"));
  await page.reload(); await waitStatus("key is invalid");
  assert.equal(requests.length, beforeRefresh + 3);
  mode = "matching";
  await page.locator("#job-lens-status-bar-v1").getByRole("button", { name: "Retry analysis", exact: true }).click();
  await waitStatus("Match: 100/100");
  assert.equal(requests.length, beforeRefresh + 4);
  console.log("PASS: failed re-analysis removes the old cached score; refresh and retry cannot silently reuse it");
  await options.locator("#disable-analysis").click(); await waitStatus("consent");
  const stoppedCount = requests.length;
  await page.reload(); await waitStatus("consent"); assert.equal(requests.length, stoppedCount);
  await options.locator("#delete-all").click();
  await options.waitForFunction(() => document.getElementById("page-message").textContent.includes("All saved Job Lens data deleted"));
  const data = await options.evaluate(async () => ({ local: await chrome.storage.local.get(), session: await chrome.storage.session.get() }));
  assert.equal(data.local["jobLens.settings.v1"], undefined); assert.equal(data.session["jobLens.analysisCache.v1"], undefined);
  assert.deepEqual(errors, []);
  console.log("PASS: disabling stops analysis, deleting removes private settings/cache, and the browser reports no page errors");
} finally { delayedResolve?.(); await context.close(); }
