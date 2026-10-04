import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".browser-cache");
const { chromium } = await import("playwright");
const artifacts = path.join(root, ".test-artifacts");
await mkdir(path.join(artifacts, "profiles"), { recursive: true });
const profile = await mkdtemp(path.join(artifacts, "profiles", "linkedin-"));
const extensionPath = path.join(root, "dist");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors = [];
const networkRequests = [];
context.on("page", (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()); });
});
context.on("request", (request) => networkRequests.push(request.url()));

const DESCRIPTION_A = "We are looking for a Backend Engineer to design reliable services using TypeScript, PostgreSQL, and REST APIs. Responsibilities include writing tests, reviewing code, and maintaining distributed systems. Professional English is required. This role is hybrid in Berlin and offers full-time employment.";
const DESCRIPTION_B = "We are looking for a Data Engineer to build analytics pipelines using Python and SQL. Responsibilities include improving data quality, maintaining batch processing, and collaborating with analysts. Professional German is required. This role is remote in Germany and offers a six-month contract.";
const styles = '<style>body{margin:0;background:#f3f2ef;font:16px/1.5 system-ui;color:#17243a}main{display:flex;gap:24px;max-width:1120px;margin:32px auto;padding:0 16px}.jobs-search-results-list{width:250px;background:white;padding:20px}.jobs-search__job-details--container,.details{background:white;padding:24px;flex:1;min-width:0}h1{font-size:24px}.hidden{display:none}</style>';
const sidebar = '<aside class="jobs-search-results-list"><article class="job-card-container" data-job-id="999"><h1>Unopened recommendation</h1><div id="recommendation-text">DO NOT READ THIS RECOMMENDATION</div></article></aside>';
const title = (id, name) => `<div class="job-details-jobs-unified-top-card__job-title"><h1><a href="/jobs/view/${id}/">${name}</a></h1></div>`;
const panel = (id = "100", name = "Backend Engineer", description = DESCRIPTION_A) => `<section class="jobs-search__job-details--container" data-job-id="${id}">${title(id, name)}<div class="job-details-jobs-unified-top-card__company-name">Example Company</div><div class="jobs-description"><div id="job-details"><p>${description}</p></div></div><section class="similar-jobs"><h1>Unopened similar job</h1><p>DO NOT READ THIS SIMILAR JOB</p></section></section>`;
// Reconstruct the stable IDs, h2-only headings, LazyColumn scoping, and deep
// wrappers observed in the user's structural report; all text is synthetic.
const nest = (content, depth = 5) => Array.from({ length: depth }).reduce((html, _, index) => `<div class="generated-${index}">${html}</div>`, content);
const modernPanel = (id = "500", name = "Backend Engineer", description = DESCRIPTION_A) => `<div data-component-type="LazyColumn" id="fixture-modern-panel"><div>${nest(`<h2>${name}</h2>`)}<div id="JobDetailsPeopleWhoCanHelpSlot_${id}">${nest('<h2>People who can help</h2>')}<p>DO NOT READ PEOPLE TEXT</p><button>Show more</button></div><div id="JobDetails_AboutTheJob_${id}">${nest('<h2>About the job</h2>')}<div class="modern-body"><p>${description}</p><ul><li>Build APIs</li><li>Write tests</li></ul></div></div><div id="JobDetails_AboutTheCompany_${id}">${nest('<h2>About the company</h2>')}<p>DO NOT READ COMPANY TEXT</p><button>Show more</button></div><h2>Other jobs you may like</h2><p>DO NOT READ RECOMMENDATIONS</p></div></div>`;
let html = `<!doctype html><html><head>${styles}</head><body><main>${sidebar}${panel()}</main></body></html>`;
// The real extension runs on the LinkedIn origin, but every fixture is fulfilled
// locally. No request is sent to LinkedIn or any backend by these tests.
await context.route("https://www.linkedin.com/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
await context.route("https://example.com/**", (route) => route.fulfill({ contentType: "text/html", body: html }));

try {
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const bar = page.locator("#job-lens-status-bar-v1");
  const waitState = (state) => page.waitForFunction((state) => {
    const hosts = document.querySelectorAll("#job-lens-status-bar-v1");
    return hosts.length === 1 && hosts[0].shadowRoot && hosts[0].dataset.state === state;
  }, state, { timeout: 20000 });
  const readyText = () => bar.locator("pre").textContent();
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=100");
  await waitState("ready");
  assert.equal(await readyText(), DESCRIPTION_A);
  assert.equal(await bar.count(), 1);
  assert.equal(await bar.evaluate((element) => element.parentElement.firstElementChild === element), true);
  await bar.getByText("Review detected job description", { exact: true }).click();
  assert.equal(await bar.locator("pre").isVisible(), true);
  assert.ok(!(await bar.innerText()).includes("DO NOT READ"));
  console.log("PASS: automatic detail-panel detection, one status bar, and only the opened job's text");

  const scrollStyles = await page.addStyleTag({ content: '.jobs-search__job-details--container::after { content:"";display:block;height:1800px; }' });
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForFunction(() => scrollY >= 700);
  const stickyBox = await bar.boundingBox();
  assert.ok(stickyBox.y >= 70 && stickyBox.y <= 74, 'The status bar stays below the page header when the document scrolls');
  assert.equal(await bar.locator('pre').isVisible(), true);
  await page.screenshot({ path: path.join(artifacts, 'linkedin-status-sticky.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await scrollStyles.evaluate((element) => element.remove());
  console.log('PASS: the status bar and open preview stay visible during document scrolling');

  await page.evaluate(() => history.pushState({}, "", "/jobs/search/?currentJobId=200"));
  await page.waitForFunction(() => document.getElementById("job-lens-status-bar-v1")?.dataset.state !== "ready");
  assert.equal(await readyText(), "");
  await page.evaluate(() => {
    const root = document.querySelector(".jobs-search__job-details--container");
    root.dataset.jobId = "200";
    root.querySelector("h1 a").textContent = "Data Engineer";
    root.querySelector("h1 a").href = "/jobs/view/200/";
    const oldButton = document.createElement("button");
    oldButton.className = "jobs-description__footer-button"; oldButton.textContent = "Show more";
    oldButton.setAttribute("aria-expanded", "false");
    globalThis.staleExpansionClicks = 0;
    oldButton.addEventListener("click", () => globalThis.staleExpansionClicks++);
    root.querySelector(".jobs-description").append(oldButton);
  });
  await page.waitForTimeout(1800);
  assert.notEqual(await bar.getAttribute("data-state"), "ready", "New title with the old description must not be ready");
  assert.equal(await readyText(), "");
  assert.equal(await page.evaluate(() => globalThis.staleExpansionClicks), 0);
  await page.evaluate((description) => {
    document.querySelector(".jobs-description__footer-button").remove();
    document.getElementById("job-details").textContent = description;
  }, DESCRIPTION_B);
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_B); assert.equal(await bar.count(), 1);
  console.log("PASS: SPA job switch clears the previous preview and waits for the new description");

  await page.evaluate(() => {
    const root = document.querySelector(".jobs-search__job-details--container");
    root.setAttribute("aria-busy", "true");
    document.getElementById("job-details").textContent = "Loading…";
  });
  await waitState("waiting");
  await page.evaluate((description) => { document.getElementById("job-details").textContent = description; }, DESCRIPTION_A);
  await page.waitForTimeout(1600); assert.notEqual(await bar.getAttribute("data-state"), "ready");
  await page.evaluate(() => document.querySelector(".jobs-search__job-details--container").removeAttribute("aria-busy"));
  await waitState("ready");
  console.log("PASS: loading indicators override stable, long text");

  await page.evaluate((description) => {
    const root = document.querySelector(".jobs-search__job-details--container");
    document.getElementById("job-details").textContent = "A short preview…";
    const button = document.createElement("button");
    button.className = "jobs-description__footer-button"; button.textContent = "Show more";
    button.setAttribute("aria-expanded", "false");
    globalThis.expansionClicks = 0;
    button.addEventListener("click", () => {
      globalThis.expansionClicks++; button.setAttribute("aria-expanded", "true"); button.textContent = "Show less";
      document.getElementById("job-details").textContent = description;
    });
    root.querySelector(".jobs-description").append(button);
  }, DESCRIPTION_B);
  await waitState("ready");
  assert.equal(await page.evaluate(() => globalThis.expansionClicks), 1);
  assert.equal(await readyText(), DESCRIPTION_B);
  console.log("PASS: only the current posting's Show more control is expanded, once");

  await page.evaluate(() => document.getElementById("job-lens-status-bar-v1").remove());
  await waitState("ready"); assert.equal(await bar.count(), 1);
  await page.evaluate(() => {
    const root = document.querySelector(".jobs-search__job-details--container");
    root.replaceWith(root.cloneNode(true));
  });
  await waitState("ready"); assert.equal(await bar.count(), 1);
  console.log("PASS: removed bars and replaced detail panels recover without duplicates");

  await page.evaluate(() => history.pushState({}, "", "/feed/"));
  await page.waitForFunction(() => !document.getElementById("job-lens-status-bar-v1"));
  await page.evaluate(() => history.pushState({}, "", "/jobs/search/?currentJobId=200"));
  await waitState("ready"); assert.equal(await bar.count(), 1);
  console.log("PASS: navigation away removes the bar; entering jobs from the same SPA restores it");

  await page.evaluate(() => history.pushState({}, "", "/jobs/search/"));
  await waitState("ready");
  await page.evaluate(() => {
    const root = document.querySelector(".jobs-search__job-details--container");
    root.dataset.jobId = "201";
    root.querySelector("h1 a").href = "/jobs/view/201/";
    root.querySelector("h1 a").textContent = "Platform Engineer";
  });
  await waitState("waiting");
  await page.evaluate((text) => document.getElementById("job-details").textContent = text, `${DESCRIPTION_A} A new platform position.`);
  await waitState("ready");
  assert.equal(await bar.getAttribute("data-job-id"), "201");
  await page.evaluate(() => {
    const description = document.getElementById("job-details");
    description.style.maxHeight = "24px"; description.style.overflow = "hidden";
  });
  await waitState("waiting");
  assert.equal(await readyText(), "");
  await page.evaluate(() => document.getElementById("job-details").removeAttribute("style"));
  await waitState("ready");
  console.log("PASS: DOM-only job switches and visibly clipped descriptions are handled conservatively");

  html = `<!doctype html><html><head>${styles}</head><body><main><div class="details"><h1 class="topcard__title">Backend Engineer</h1><a class="topcard__org-name-link">Example Public Company</a><section class="description"><div class="description__text"><div class="show-more-less-html__markup"><p>${DESCRIPTION_A}</p><ul><li>Build APIs</li><li>Write tests</li></ul></div><button class="show-more-less-html__button--more" aria-expanded="false">Show more</button></div></section></div></main><script>document.querySelector('button').addEventListener('click', event => { event.target.hidden = true; });</script></body></html>`;
  await page.goto("https://www.linkedin.com/jobs/view/backend-engineer-300/");
  await waitState("ready");
  assert.match(await readyText(), /Build APIs\s*\n\s*Write tests/);
  assert.ok(!(await readyText()).includes("Show more"));
  await bar.getByText("Review detected job description", { exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "linkedin-status-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "linkedin-status-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("PASS: public job layout, paragraph/list boundaries, preview, and narrow screen");

  html = `<!doctype html><html><head>${styles}</head><body><main>${sidebar}<section class="new-wrapper-class"><header><h2><a href="/jobs/view/320/">Backend Engineer</a></h2></header><section><h2>About the job</h2><div id="job-details"><p>${DESCRIPTION_A}</p></div></section><section class="similar-jobs"><h2>Other jobs</h2><p>DO NOT READ THIS SIMILAR JOB</p></section></section></main></body></html>`;
  await page.goto("https://www.linkedin.com/jobs/view/320/");
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_A);
  assert.match(await bar.locator("details p").first().textContent(), /Backend Engineer/);
  await page.evaluate((text) => {
    history.pushState({}, "", "/jobs/view/321/");
    const title = document.querySelector('.new-wrapper-class header a');
    title.href = '/jobs/view/321/'; title.textContent = 'Data Engineer';
    document.getElementById('job-details').textContent = text;
  }, DESCRIPTION_B);
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_B);
  assert.equal(await bar.getAttribute("data-job-id"), "321");
  await page.evaluate(() => document.querySelector('.new-wrapper-class').parentElement.setAttribute('aria-busy', 'true'));
  await waitState("waiting"); assert.equal(await readyText(), "");
  await page.evaluate(() => document.querySelector('.new-wrapper-class').parentElement.removeAttribute('aria-busy'));
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_B);
  console.log("PASS: changed wrapper classes and linked h2 titles use the bounded description section, including SPA switches");

  html = `<!doctype html><html><head>${styles}</head><body><div id="root"><div data-component-type="LazyColumn"><h2>Recommended jobs</h2><h2>Unopened result</h2><p>DO NOT READ SEARCH RESULTS</p></div>${modernPanel()}</div></body></html>`;
  await page.goto("https://www.linkedin.com/jobs/search/?currentJobId=500");
  await waitState("ready");
  assert.equal(await bar.getAttribute("data-job-id"), "500");
  assert.equal(await bar.locator("details p").first().textContent(), "Backend Engineer");
  assert.equal(await readyText(), `${DESCRIPTION_A}\n\nBuild APIs\n\nWrite tests`);
  assert.ok(!(await readyText()).includes("About the job") && !(await readyText()).includes("DO NOT READ"));
  const panelScrollStyles = await page.addStyleTag({ content: '#fixture-modern-panel { height:600px;overflow-y:auto; } #fixture-modern-panel > div:not([data-job-lens])::after {content:"";display:block;height:1800px;}' });
  await page.evaluate(() => { document.querySelector('#fixture-modern-panel').scrollTop = 400; });
  await page.waitForFunction(() => document.querySelector('#fixture-modern-panel').scrollTop === 400);
  const panelStickyBox = await bar.boundingBox();
  const panelBox = await page.locator('#fixture-modern-panel').boundingBox();
  assert.ok(Math.abs(panelStickyBox.y - panelBox.y - 72) <= 2, 'The status bar also stays visible inside an independently scrolling detail column');
  assert.ok(panelStickyBox.y + panelStickyBox.height <= panelBox.y + panelBox.height + 1,
    `Sticky bar must fit inside the detail column: ${JSON.stringify({ panelStickyBox, panelBox })}`);
  await page.evaluate(() => { document.querySelector('#fixture-modern-panel').scrollTop = 0; });
  await panelScrollStyles.evaluate((element) => element.remove());
  console.log('PASS: the status bar stays visible when the modern detail column scrolls independently');
  await page.evaluate(() => {
    globalThis.unrelatedClicks = 0;
    document.querySelectorAll('[id^="JobDetailsPeople" ] button, [id^="JobDetails_AboutTheCompany_"] button').forEach(button => button.addEventListener('click', () => globalThis.unrelatedClicks++));
    const button = document.createElement('button'); button.textContent = 'See more';
    globalThis.modernExpansionClicks = 0;
    button.addEventListener('click', () => { globalThis.modernExpansionClicks++; button.textContent = 'See less'; });
    document.getElementById('JobDetails_AboutTheJob_500').append(button);
  });
  await waitState("ready");
  assert.equal(await page.evaluate(() => globalThis.modernExpansionClicks), 1);
  assert.equal(await page.evaluate(() => globalThis.unrelatedClicks), 0);
  console.log("PASS: reported h2/LazyColumn layout reads only AboutTheJob and expands only its own control");

  await page.evaluate(() => history.pushState({}, '', '/jobs/search/?currentJobId=501'));
  await waitState("waiting"); assert.equal(await readyText(), "");
  await page.evaluate(() => {
    document.querySelector('#fixture-modern-panel h2').textContent = 'Data Engineer';
    document.getElementById('JobDetails_AboutTheJob_500').id = 'JobDetails_AboutTheJob_501';
  });
  await page.waitForTimeout(1600); assert.notEqual(await bar.getAttribute('data-state'), 'ready');
  await page.evaluate((text) => document.querySelector('.modern-body').textContent = text, DESCRIPTION_B);
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_B);
  assert.equal(await bar.getAttribute('data-job-id'), '501');
  await page.evaluate(() => { document.querySelector('.modern-body').style.cssText = 'max-height:24px;overflow:hidden'; });
  await waitState("waiting"); assert.equal(await readyText(), '');
  await page.evaluate(() => document.querySelector('.modern-body').removeAttribute('style'));
  await waitState("ready"); assert.equal(await readyText(), DESCRIPTION_B);
  await page.evaluate(() => document.querySelector('#fixture-modern-panel').setAttribute('aria-busy', 'true'));
  await waitState('waiting'); assert.equal(await readyText(), '');
  await page.evaluate(() => document.querySelector('#fixture-modern-panel').removeAttribute('aria-busy'));
  await waitState('ready');
  console.log("PASS: modern IDs prevent stale text on SPA switches; nested clipping and loading block readiness");

  await page.evaluate(() => {
    const duplicateTitle = document.createElement('h2'); duplicateTitle.textContent = 'Ambiguous header';
    document.querySelector('#fixture-modern-panel').prepend(duplicateTitle);
  });
  await waitState('waiting'); assert.equal(await readyText(), '');
  console.log("PASS: modern layout rejects ambiguous header titles instead of guessing");

  html = `<!doctype html><html><head>${styles}</head><body><main><div class="details"><h1>Backend Engineer</h1><div class="description__text--rich">${DESCRIPTION_A}</div></div><div class="details"><h1>Data Engineer</h1><div class="description__text--rich">${DESCRIPTION_B}</div></div></main></body></html>`;
  await page.goto("https://www.linkedin.com/jobs/view/350/");
  await waitState("waiting"); await page.waitForTimeout(1600);
  assert.notEqual(await bar.getAttribute("data-state"), "ready"); assert.equal(await readyText(), "");
  console.log("PASS: ambiguous independent detail panels are not guessed from the URL alone");

  html = `<!doctype html><html><head>${styles}</head><body><main>${sidebar}<section class="unknown-layout"><h1>Unknown layout</h1><p>${DESCRIPTION_A}</p></section></main></body></html>`;
  await page.goto("https://www.linkedin.com/jobs/view/400/");
  await waitState("waiting");
  // Main-world fake timers cannot advance the isolated content script's clock.
  await waitState("unavailable"); assert.equal(await readyText(), "");
  assert.ok((await bar.locator('[role="status"]').textContent()).includes("unsupported"));
  console.log("PASS: unknown layouts fail visibly instead of reading all page text");

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://www.linkedin.com" });
  await bar.getByText("Troubleshoot this layout", { exact: true }).click();
  await bar.getByRole("button", { name: "Copy layout diagnostics" }).click();
  await page.waitForFunction(() => document.querySelector('#job-lens-status-bar-v1').shadowRoot.querySelector('button').textContent !== 'Copy layout diagnostics');
  const diagnostics = await bar.locator("textarea").isVisible()
    ? await bar.locator("textarea").inputValue() : await page.evaluate(() => navigator.clipboard.readText());
  const report = JSON.parse(diagnostics);
  assert.equal(report.format, "job-lens-layout-v1");
  assert.equal(report.counts.descriptions["#job-details"], 0);
  assert.ok(diagnostics.includes("unknown-layout"));
  assert.ok(!diagnostics.includes(DESCRIPTION_A) && !diagnostics.includes("Unknown layout") && !diagnostics.includes("DO NOT READ"));
  console.log("PASS: user-triggered diagnostics contain structure without copying job text");

  html = `<!doctype html><html><head>${styles}</head><body><main>${panel()}</main></body></html>`;
  await page.goto("https://example.com/jobs/view/100/");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#job-lens-status-bar-v1").count(), 0);
  assert.deepEqual(errors, [], "No script or CSP errors are expected");
  assert.ok(networkRequests.every((url) => url.startsWith("https://www.linkedin.com/") || url.startsWith("https://example.com/") || url.startsWith("chrome-extension://")));
  console.log("PASS: content script stays on LinkedIn, with no backend requests or script errors");
} finally { await context.close(); }
