import type { AnalysisState, JobInput } from "../shared/analysis.js";

export class AnalysisClient {
  private port: chrome.runtime.Port | null = null;
  private key = "";
  private requestId = "";
  private ready = false;
  private latest: AnalysisState | null = null;
  private job: JobInput | null = null;
  constructor(private render: (state: AnalysisState | null) => void, private invalidate: () => void) {}
  suspend(): void { this.ready = false; this.render(null); }
  reset(): void {
    this.key = ""; this.requestId = ""; this.latest = null; this.job = null; this.suspend();
    try { this.port?.postMessage({ type: "cancel" }); } catch { this.port = null; }
  }
  analyze(job: JobInput, refresh = false): void {
    this.ready = true;
    const key = JSON.stringify(job);
    if (key === this.key && !refresh) { this.render(this.latest); return; }
    this.job = job;
    this.key = key; this.requestId = crypto.randomUUID();
    this.latest = { phase: "analyzing", message: "Checking analysis settings…" }; this.render(this.latest);
    try {
      if (!this.port) {
        const port = chrome.runtime.connect(chrome.runtime.id, { name: "jobLens.analysis" }); this.port = port;
        port.onMessage.addListener(message => {
          if (message?.type === "invalidate") { this.reset(); this.invalidate(); return; }
          if (message?.type !== "state" || message.requestId !== this.requestId) return;
          this.latest = message.state as AnalysisState;
          if (this.ready) this.render(this.latest);
        });
        port.onDisconnect.addListener(() => {
          if (this.port !== port) return;
          this.port = null;
          this.latest = { phase: "error", message: "The extension connection closed. Retry, or refresh LinkedIn after reloading Job Lens." };
          if (this.ready) this.render(this.latest);
        });
      }
      this.port.postMessage({ type: "analyze", requestId: this.requestId, url: location.href, job, refresh });
    } catch {
      this.latest = { phase: "error", message: "Reload Job Lens and refresh LinkedIn to restore matching." }; this.render(this.latest);
    }
  }
  retry(): void { if (this.ready && this.job) this.analyze(this.job, true); }
  stop(): void { this.reset(); this.port?.disconnect(); this.port = null; }
}
