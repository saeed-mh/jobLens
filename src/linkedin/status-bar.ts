import { BAR_ID } from "./selectors.js";
import { jobText, type JobCandidate } from "./extract.js";
import type { ReadinessResult } from "./readiness.js";
import { layoutDiagnostics } from "./diagnostics.js";
import { DIMENSIONS, LABELS, RUBRIC, type AnalysisState } from "../shared/analysis.js";
import { matchingDiagnostics } from "./matching-diagnostics.js";

export class StatusBar {
  readonly host = document.createElement("div");
  private status = document.createElement("span");
  private details = document.createElement("details");
  private title = document.createElement("p");
  private description = document.createElement("pre");
  private metadata = document.createElement("p");
  private rendered = "";
  private diagnostics = document.createElement("details");
  private diagnosticText = document.createElement("textarea");
  private match = document.createElement("span");
  private matchDetails = document.createElement("details");
  private matchBody = document.createElement("div");
  private retry = document.createElement("button");
  private settings = document.createElement("button");
  private ready = false;
  private analysisRender = 0;
  onRetry: () => void = () => {};

  constructor() {
    this.removeClones();
    this.host.id = BAR_ID;
    this.host.setAttribute("data-job-lens", "status");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = new CSSStyleSheet();
    style.replaceSync(`
      :host { display:block !important; margin:0 0 16px !important; width:auto !important;
        position:sticky !important; top:72px !important; z-index:10 !important; flex-shrink:0 !important;
        max-height:calc(100dvh - 88px) !important; overflow-y:auto !important; }
      * { box-sizing:border-box; }
      .bar { border:1px solid #b5c9f4; border-radius:10px; background:#f0f5ff; color:#17243a;
        padding:12px 16px; font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; text-align:start;
        box-shadow:0 3px 12px #17243a18; }
      .row { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
      strong { font-weight:700; color:#2457d6; white-space:nowrap; }
      [role=status] { font-weight:600; }
      p { margin:8px 0; }
      .note { font-size:12px; color:#52657e; margin:6px 0 0; }
      details { margin-top:10px; border-top:1px solid #cad7f0; padding-top:8px; }
      summary { cursor:pointer; color:#2457d6; }
      summary:focus-visible { outline:2px solid #2457d6; outline-offset:3px; }
      pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto;
        margin:12px 0 0; padding:12px; border-radius:6px; background:white; font:13px/1.7 system-ui,sans-serif; }
      button { font:inherit; padding:5px 10px; margin-top:8px; cursor:pointer; }
      textarea { display:block; width:100%; height:160px; margin-top:8px; font:12px/1.5 monospace; }
      .table-scroll { max-width:100%; overflow-x:auto; }
      table { width:100%; min-width:460px; border-collapse:collapse; font-size:13px; } th,td { padding:6px; text-align:start; border-bottom:1px solid #cad7f0; }
      :host([data-state=ready]) .bar { border-color:#a5d3bc; background:#f0faf5; }
      :host([data-state=unavailable]) .bar { border-color:#e5cb9b; background:#fff8eb; }
      [hidden] { display:none !important; }
    `);
    shadow.adoptedStyleSheets = [style];
    const bar = document.createElement("section");
    bar.className = "bar"; bar.setAttribute("aria-label", "Job Lens status");
    const row = document.createElement("div"); row.className = "row";
    const brand = document.createElement("strong"); brand.textContent = "Job Lens";
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.match.setAttribute("aria-live", "polite"); this.match.setAttribute("data-match-status", "");
    row.append(brand, this.status, this.match);
    const note = document.createElement("p"); note.className = "note";
    note.textContent = "AI matching sends reviewed text to Cloudflare only with saved consent. Scores describe compatibility with our rubric, not hiring probability.";
    this.retry.type = "button"; this.retry.textContent = "Retry analysis"; this.retry.hidden = true;
    this.retry.addEventListener("click", () => this.onRetry());
    this.settings.type = "button"; this.settings.textContent = "Open settings"; this.settings.hidden = true;
    this.settings.addEventListener("click", () => { void chrome.runtime.sendMessage({ type: "jobLens.openSettings" }); });
    const matchSummary = document.createElement("summary"); matchSummary.textContent = "Match criteria and requirements";
    this.matchDetails.append(matchSummary, this.matchBody); this.matchDetails.hidden = true;
    const summary = document.createElement("summary"); summary.textContent = "Review detected job description";
    this.description.setAttribute("dir", "auto");
    this.title.setAttribute("dir", "auto");
    this.details.append(summary, this.title, this.metadata, this.description);
    const diagnosticSummary = document.createElement("summary"); diagnosticSummary.textContent = "Troubleshoot this layout";
    const diagnosticNote = document.createElement("p"); diagnosticNote.className = "note";
    diagnosticNote.textContent = "Copy page structure for troubleshooting. This report contains element tags and attributes, but no resume or job description text. Nothing is sent automatically.";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy layout diagnostics";
    this.diagnosticText.readOnly = true; this.diagnosticText.hidden = true;
    this.diagnosticText.setAttribute("aria-label", "Layout diagnostics; select and copy this report");
    copy.addEventListener("click", async () => {
      const report = layoutDiagnostics();
      try { await navigator.clipboard.writeText(report); copy.textContent = "Copied — paste it in this conversation"; }
      catch {
        this.diagnosticText.value = report; this.diagnosticText.hidden = false;
        this.diagnosticText.focus(); this.diagnosticText.select(); copy.textContent = "Select the report below and copy it";
      }
    });
    this.diagnostics.append(diagnosticSummary, diagnosticNote, copy, this.diagnosticText);
    bar.append(row, note, this.retry, this.settings, this.matchDetails, this.details, this.diagnostics); shadow.append(bar);
    this.details.hidden = true;
    this.diagnostics.hidden = true;
  }

  mount(anchor: HTMLElement): void {
    this.removeClones();
    if (this.host.parentElement !== anchor || anchor.firstElementChild !== this.host) anchor.prepend(this.host);
  }

  render(result: ReadinessResult, candidate: JobCandidate | null): void {
    const ready = result.phase === "ready" && candidate;
    this.ready = Boolean(ready);
    if (!ready) this.renderAnalysis(null);
    const key = JSON.stringify([result.phase, result.message, ready ? candidate.jobId : null,
      ready ? candidate.title : null, ready ? candidate.company : null, ready ? jobText(candidate) : null]);
    if (key === this.rendered) return;
    this.rendered = key; this.host.dataset.state = result.phase;
    this.host.dataset.jobId = candidate?.jobId ?? "";
    this.status.textContent = result.message;
    this.details.hidden = !ready;
    this.diagnostics.hidden = !ready && result.phase !== "unavailable";
    if (!ready && result.phase !== "unavailable") {
      this.diagnostics.open = false; this.diagnosticText.value = ""; this.diagnosticText.hidden = true;
    }
    this.title.textContent = ready ? `${candidate.title}${candidate.company ? ` · ${candidate.company}` : ""}` : "";
    this.metadata.textContent = ready ? `${jobText(candidate).length.toLocaleString()} characters read from the opened posting. Check this preview against LinkedIn.` : "";
    this.description.textContent = ready ? jobText(candidate) : "";
    if (!ready) this.details.open = false;
  }

  renderAnalysis(state: AnalysisState | null): void {
    const generation = ++this.analysisRender;
    this.match.textContent = ""; this.matchDetails.hidden = true; this.matchBody.replaceChildren();
    this.retry.hidden = true; this.settings.hidden = true;
    if (!this.ready || !state) { this.matchDetails.open = false; return; }
    if (state.phase !== "complete") {
      this.match.textContent = state.message;
      this.retry.textContent = "Retry analysis";
      this.retry.hidden = state.phase !== "error";
      this.settings.hidden = state.phase === "analyzing";
      return;
    }
    this.retry.textContent = "Re-analyze";
    this.retry.title = "Request a fresh AI assessment with your saved consent. This uses AI quota.";
    this.retry.hidden = false;
    const score = state.result.score;
    const label = score.value !== null ? `Match: ${score.value}/100`
      : score.assessedAverage !== null ? `Provisional match: ${score.range[0]}–${score.range[1]}/100`
        : score.unknown.length ? "Match unresolved — uncertain or missing information" : "Match unknown — no applicable requirements";
    this.match.textContent = `${label}${state.cached ? " · Cached" : ` · ${(state.elapsedMs / 1000).toFixed(1)}s`}`;
    this.matchDetails.hidden = false;
    const note = document.createElement("p");
    note.textContent = "Each assessable criterion receives an AI score from 0 (no alignment) to 5 (full alignment). Multiply by 20 to convert it to 0–100: 3.7/5 = 74/100. The overall score is a weighted average. Unneeded criteria are excluded; unknown criteria stay unresolved and create a conditional overall range. Mandatory conflicts are checked separately and can remain flagged even with a high score.";
    const rubric = document.createElement("details");
    const rubricSummary = document.createElement("summary"); rubricSummary.textContent = "How the 0–5 rubric works";
    rubric.append(rubricSummary);
    for (const level of RUBRIC) { const p = document.createElement("p"); p.textContent = level; rubric.append(p); }
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const label of ["Criterion", "Active weight", "Assessment", "AI score /5", "Score /100"]) { const th = document.createElement("th"); th.textContent = label; th.scope = "col"; head.append(th); }
    table.append(head);
    const activeWeight = score.breakdown.filter(row => row.status !== "not_required").reduce((sum, row) => sum + row.weight, 0);
    const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    for (const row of score.breakdown) {
      const tr = document.createElement("tr");
      const assessment = ({ assessable: "Assessed", unknown: "Unknown — comparison unresolved", not_required: "No active requirement" })[row.status];
      const weight = row.status === "not_required" ? "Excluded" : `${format(activeWeight ? row.weight / activeWeight * 100 : 0)}%`;
      for (const text of [LABELS[row.dimension], weight, assessment, row.score === null ? "—" : format(row.score), row.points === null ? "—" : format(row.points)]) {
        const td = document.createElement("td"); td.textContent = text; tr.append(td);
      }
      table.append(tr);
    }
    const tableScroll = document.createElement("div"); tableScroll.className = "table-scroll";
    tableScroll.setAttribute("role", "region"); tableScroll.setAttribute("aria-label", "Criterion score table"); tableScroll.tabIndex = 0;
    tableScroll.append(table);
    this.matchBody.append(note, rubric, tableScroll);
    const average = document.createElement("p");
    average.textContent = `Weighted average of assessed criteria: ${score.assessedAverage === null ? "Unavailable" : `${format(score.assessedAverage)}/100`}${score.provisional ? " (incomplete assessment)" : ""}.`;
    this.matchBody.append(average);
    const repaired = DIMENSIONS.filter(d => state.result.assessments[d].issues.length > 0);
    if (repaired.length) {
      const p = document.createElement("p");
      p.textContent = `Missing, invalid, or unsupported model answers remain unresolved: ${repaired.map(d => LABELS[d]).join(", ")}. No absent requirement is assumed.`;
      this.matchBody.append(p);
    }
    for (const [heading, dimensions] of [["Model-flagged mandatory qualification conflicts", score.mandatoryUnmet], ["Work preference conflicts", score.preferenceUnmet], ["Unresolved requirements", score.unknown], ["Excluded criteria", score.excluded], ["Conflict checks unresolved", score.conflictUnknown]] as const) {
      const p = document.createElement("p"); p.textContent = `${heading}: ${dimensions.length ? dimensions.map(d => LABELS[d]).join(", ") : "None flagged"}.`; this.matchBody.append(p);
    }
    const caution = document.createElement("p"); caution.className = "note";
    caution.textContent = `Criteria assessed: ${score.coverage}% of active weight. The range holds assessed scores fixed and varies unresolved criteria from 0–100; it is not a statistical confidence interval. Scores describe model-assessed alignment, not hiring probability. Review the posting and any flagged conflicts.`;
    this.matchBody.append(caution);
    const troubleshooting = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = "Troubleshoot this assessment";
    const diagnosticNote = document.createElement("p"); diagnosticNote.className = "note";
    diagnosticNote.textContent = "Copy assessability, 0–5 scores, level probabilities, and conflict decisions. The report excludes your resume, posting text, identifiers, and API key. Nothing is sent automatically. Model confidence is not calibrated accuracy.";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy matching diagnostics";
    const fallback = document.createElement("textarea"); fallback.readOnly = true; fallback.hidden = true;
    fallback.setAttribute("aria-label", "Matching diagnostics; select and copy this report");
    copy.addEventListener("click", async () => {
      const report = matchingDiagnostics(state, chrome.runtime.getManifest().version);
      try {
        await navigator.clipboard.writeText(report);
        if (generation === this.analysisRender) copy.textContent = "Copied — paste it in this conversation";
      } catch {
        if (generation !== this.analysisRender) return;
        fallback.value = report; fallback.hidden = false;
        fallback.focus(); fallback.select(); copy.textContent = "Select the report below and copy it";
      }
    });
    troubleshooting.append(summary, diagnosticNote, copy, fallback);
    this.matchBody.append(troubleshooting);
  }

  private removeClones(): void {
    for (const element of document.querySelectorAll(`#${BAR_ID}[data-job-lens="status"]`)) {
      if (element !== this.host) element.remove();
    }
  }

  remove(): void { this.host.remove(); this.removeClones(); }
}
