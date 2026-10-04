import { MAX_DESCRIPTION_LENGTH, MIN_DESCRIPTION_LENGTH, SETTLE_MS } from "./selectors.js";

export type JobPhase = "reading" | "waiting" | "ready" | "unavailable";
export interface JobObservation {
  jobId: string | null;
  domJobId: string | null;
  title: string;
  company: string;
  description: string;
  descriptionElement: object | null;
  loading: boolean;
  collapsed: boolean;
}
export interface ReadinessResult { phase: JobPhase; message: string }

export class ReadinessTracker {
  private expectedId: string | null = null;
  private previous: JobObservation | null = null;
  private transitionBaseline: JobObservation | null = null;
  private stable: JobObservation | null = null;
  private stableSince = 0;

  navigate(expectedId: string | null): void {
    if (this.expectedId === expectedId) return;
    this.transitionBaseline = expectedId && this.previous?.jobId !== expectedId ? this.previous : null;
    this.expectedId = expectedId;
    this.invalidate();
  }

  invalidate(): void { this.stable = null; this.stableSince = 0; }

  canExpand(input: JobObservation): boolean {
    if (!input.jobId || !input.title || !input.descriptionElement || input.loading
      || (this.expectedId && input.jobId !== this.expectedId)) return false;
    const baseline = this.transitionBaseline;
    return !baseline || input.description !== baseline.description
      || (input.descriptionElement !== baseline.descriptionElement && input.domJobId === (this.expectedId ?? input.jobId));
  }

  reset(): void {
    this.expectedId = null; this.previous = null; this.transitionBaseline = null; this.invalidate();
  }

  observe(input: JobObservation | null, now: number): ReadinessResult {
    const waiting = (message: string): ReadinessResult => { this.invalidate(); return { phase: "waiting", message }; };
    if (!input) return waiting("Waiting for the opened job posting…");
    const previous = this.previous;
    if (!this.expectedId && previous?.jobId && input.jobId !== previous.jobId) {
      this.transitionBaseline = previous;
      this.invalidate();
    }
    this.previous = input;
    if (!input.jobId || (this.expectedId && input.jobId !== this.expectedId)) {
      return waiting("Waiting for the current posting. The previous job will not be used.");
    }
    if (!input.title || !input.descriptionElement || input.loading) return waiting("Waiting for the job title and description to finish loading…");
    if (input.collapsed) return waiting("Waiting for the full description. Use LinkedIn's Show more button if it stays collapsed.");
    if (input.description.length < MIN_DESCRIPTION_LENGTH) return waiting("The description is missing or very short. Waiting for more information…");
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      this.invalidate(); return { phase: "unavailable", message: "This job description is too long to process safely in this version." };
    }
    const baseline = this.transitionBaseline;
    const expectedId = this.expectedId ?? input.jobId;
    if (baseline && (input.description === baseline.description && (input.descriptionElement === baseline.descriptionElement || input.domJobId !== expectedId))) {
      return waiting("Waiting for the new description. The previous job's text will not be reused.");
    }
    if (baseline && !input.domJobId && input.title === baseline.title) {
      return waiting("Waiting to verify the new posting's identity.");
    }
    const stable = this.stable;
    if (!stable || stable.jobId !== input.jobId || stable.title !== input.title || stable.company !== input.company
      || stable.description !== input.description || stable.descriptionElement !== input.descriptionElement) {
      this.stable = input; this.stableSince = now;
      return { phase: "reading", message: "Reading job description…" };
    }
    if (now - this.stableSince < SETTLE_MS) return { phase: "reading", message: "Reading job description…" };
    this.transitionBaseline = null;
    return { phase: "ready", message: "Job description ready · AI matching is not connected yet" };
  }
}
