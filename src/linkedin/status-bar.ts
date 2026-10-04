import { BAR_ID } from "./selectors.js";
import type { JobCandidate } from "./extract.js";
import type { ReadinessResult } from "./readiness.js";
import { layoutDiagnostics } from "./diagnostics.js";

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
    row.append(brand, this.status);
    const note = document.createElement("p"); note.className = "note";
    note.textContent = "Local reading only. No data is sent and no match score is calculated in this version.";
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
    bar.append(row, note, this.details, this.diagnostics); shadow.append(bar);
    this.details.hidden = true;
    this.diagnostics.hidden = true;
  }

  mount(anchor: HTMLElement): void {
    this.removeClones();
    if (this.host.parentElement !== anchor || anchor.firstElementChild !== this.host) anchor.prepend(this.host);
  }

  render(result: ReadinessResult, candidate: JobCandidate | null): void {
    const ready = result.phase === "ready" && candidate;
    const key = JSON.stringify([result.phase, result.message, ready ? candidate.jobId : null,
      ready ? candidate.title : null, ready ? candidate.company : null, ready ? candidate.description : null]);
    if (key === this.rendered) return;
    this.rendered = key; this.host.dataset.state = result.phase;
    this.host.dataset.jobId = candidate?.jobId ?? "";
    this.status.textContent = result.message;
    this.details.hidden = !ready;
    this.diagnostics.hidden = result.phase !== "unavailable";
    if (result.phase !== "unavailable") {
      this.diagnostics.open = false; this.diagnosticText.value = ""; this.diagnosticText.hidden = true;
    }
    this.title.textContent = ready ? `${candidate.title}${candidate.company ? ` · ${candidate.company}` : ""}` : "";
    this.metadata.textContent = ready ? `${candidate.description.length.toLocaleString()} characters read from the opened posting. Check this preview against LinkedIn before future matching.` : "";
    this.description.textContent = ready ? candidate.description : "";
    if (!ready) this.details.open = false;
  }

  private removeClones(): void {
    for (const element of document.querySelectorAll(`#${BAR_ID}[data-job-lens="status"]`)) {
      if (element !== this.host) element.remove();
    }
  }

  remove(): void { this.host.remove(); this.removeClones(); }
}
