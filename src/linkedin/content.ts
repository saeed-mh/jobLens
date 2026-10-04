import { currentRoute, fallbackAnchor, findCurrentJob, jobText, type JobCandidate } from "./extract.js";
import { BAR_ID, DEBOUNCE_MS, MAX_WAIT_MS, MODERN_LAYOUT, SELECTORS, SETTLE_MS, URL_CHECK_MS } from "./selectors.js";
import { ReadinessTracker, type ReadinessResult } from "./readiness.js";
import { StatusBar } from "./status-bar.js";
import { AnalysisClient } from "./analysis-client.js";

function start(): () => void {
  const tracker = new ReadinessTracker();
  const bar = new StatusBar();
  const analysis = new AnalysisClient(state => bar.renderAnalysis(state), () => schedule(0));
  bar.onRetry = () => analysis.retry();
  let candidate: JobCandidate | null = null;
  let url = location.href;
  let navigationStarted = performance.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const attemptedExpansion = new Set<string>();

  function schedule(delay = DEBOUNCE_MS): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(evaluate, delay);
  }

  function checkNavigation(): boolean {
    if (url === location.href) return false;
    const before = currentRoute(url);
    const after = currentRoute(location.href);
    url = location.href;
    if (before.jobId === after.jobId && before.isJobsPage === after.isJobsPage) return false;
    tracker.navigate(after.jobId); attemptedExpansion.clear();
    analysis.reset();
    navigationStarted = performance.now();
    if (!after.isJobsPage) { candidate = null; tracker.reset(); bar.remove(); }
    else bar.render({ phase: "reading", message: "Reading the opened job posting…" }, null);
    schedule(0); return true;
  }

  function evaluate(): void {
    timer = null;
    if (stopped) return;
    try {
      checkNavigation();
      const route = currentRoute(url);
      if (!route.isJobsPage) { analysis.reset(); candidate = null; tracker.reset(); bar.remove(); return; }
      tracker.navigate(route.jobId);
      const next = findCurrentJob(route);
      if (!next && !route.jobId) { analysis.reset(); candidate = null; tracker.reset(); bar.remove(); return; }
      if (candidate?.jobId !== next?.jobId) {
        analysis.reset();
        if (candidate?.jobId && next?.jobId) attemptedExpansion.clear();
        navigationStarted = performance.now();
      }
      candidate = next;
      bar.mount(next?.root ?? fallbackAnchor());
      let result: ReadinessResult = tracker.observe(next ? { ...next, collapsed: Boolean(next.expandButton) || next.collapsed } : null, performance.now());
      if (next?.expandButton && tracker.canExpand(next)) {
        const key = `${next.jobId ?? "unknown"}:${next.title}`;
        if (!attemptedExpansion.has(key)) {
          attemptedExpansion.add(key);
          // Only click the recognized Show more control inside the current detail panel.
          next.expandButton.click(); schedule();
        }
      }
      if (result.phase === "waiting" && performance.now() - navigationStarted > MAX_WAIT_MS) {
        result = { phase: "unavailable", message: `${result.message} The posting may be incomplete or this layout is unsupported. Try refreshing LinkedIn.` };
      }
      bar.render(result, next);
      if (result.phase === "ready" && next?.jobId) analysis.analyze({ id: next.jobId, title: next.title, company: next.company, description: jobText(next) });
      else analysis.suspend();
      if (result.phase === "reading") schedule(SETTLE_MS);
      else if (result.phase === "waiting") schedule(1_000);
    } catch {
      analysis.reset();
      tracker.invalidate();
      if (currentRoute(location.href).isJobsPage) {
        bar.mount(fallbackAnchor());
        bar.render({ phase: "unavailable", message: "Could not safely read this posting. Refresh LinkedIn and reload the extension if needed." }, null);
      }
    }
  }

  const observer = new MutationObserver((records) => {
    if (checkNavigation()) return;
    if (!currentRoute(url).isJobsPage) return;
    const active = candidate;
    const relevant = records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(`#${BAR_ID}`)) return false;
      if (record.type === "childList" && record.addedNodes.length
        && Array.from(record.addedNodes).every((node) => node === bar.host) && !record.removedNodes.length) return false;
      return !active || !active.root.isConnected || Boolean(target && (active.root.contains(target)
        || (record.type === "attributes" && target.contains(active.root))))
        || Array.from(record.removedNodes).some((node) => node === bar.host || node.contains(active.root))
        || Array.from(record.addedNodes).some((node) => node instanceof Element
          && (node.matches([...SELECTORS.roots, MODERN_LAYOUT.descriptions].join(","))
            || node.querySelector([...SELECTORS.roots, MODERN_LAYOUT.descriptions].join(","))));
    });
    if (!relevant) return;
    tracker.invalidate();
    analysis.suspend();
    bar.render({ phase: "reading", message: "Reading job description…" }, candidate);
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["aria-busy", "aria-expanded", "aria-hidden", "hidden", "class", "style", "id", "data-component-type", "data-job-id", "data-entity-urn", "href"] });

  // pushState in LinkedIn's world does not fire popstate in this isolated world.
  const urlTimer = setInterval(() => { checkNavigation(); }, URL_CHECK_MS);
  const onNavigation = () => { checkNavigation(); schedule(0); };
  window.addEventListener("popstate", onNavigation);
  window.addEventListener("hashchange", onNavigation);
  window.navigation?.addEventListener("navigatesuccess", onNavigation);
  const stop = () => {
    if (stopped) return;
    stopped = true; observer.disconnect(); clearInterval(urlTimer);
    if (timer) clearTimeout(timer);
    window.removeEventListener("popstate", onNavigation); window.removeEventListener("hashchange", onNavigation);
    window.navigation?.removeEventListener("navigatesuccess", onNavigation);
    window.removeEventListener("pagehide", onPageHide); window.removeEventListener("pageshow", onPageShow);
    analysis.stop(); candidate = null; tracker.reset(); bar.remove();
  };
  const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) stop(); else analysis.reset(); };
  const onPageShow = () => { analysis.reset(); onNavigation(); };
  window.addEventListener("pagehide", onPageHide); window.addEventListener("pageshow", onPageShow);
  evaluate();
  return stop;
}

const scope = globalThis as typeof globalThis & { __jobLensContentStop?: () => void };
scope.__jobLensContentStop?.();
scope.__jobLensContentStop = start();
