export const API_ORIGIN = "https://job-lens-api.saeedmohh10.workers.dev";
export const API_VERSION = "job-lens-analysis-v2";
export const ASSESSMENT_VERSION = "clef-score-v9";
export const SCORING_VERSION = "weighted-clef-score-v1";
export const RUBRIC_VERSION = "alignment-0-5-v1";
export const CACHE_KEY = "jobLens.analysisCache.v1";
export const DIMENSIONS = ["skills", "experience", "language", "location", "employment"] as const;
export const STATUSES = ["assessable", "unknown", "not_required"] as const;
export const ACTIVE_STATUSES = ["assessable", "unknown"] as const;
export const CONFLICTS = ["conflict", "no_conflict", "unknown"] as const;
export const LEVELS = ["0", "1", "2", "3", "4", "5"] as const;
export const RUBRIC = [
  "0 — No alignment: explicit assessable evidence shows incompatibility or no relevant support for the conditions being compared.",
  "1 — Very limited alignment: isolated relevant support; alignment with most required conditions remains unestablished or explicitly contradicted.",
  "2 — Limited alignment: some relevant support; substantial alignment remains unestablished or explicitly contradicted.",
  "3 — Moderate alignment: meaningful support for several required conditions; noticeable alignment gaps or uncertainty remain.",
  "4 — Strong alignment: most required conditions are supported; small alignment gaps or uncertainty remain.",
  "5 — Full alignment: all stated required conditions or active preferences are explicitly supported, with no demonstrated gaps or mismatches.",
] as const;
export type Dimension = typeof DIMENSIONS[number];
export type Status = typeof STATUSES[number];
export type Conflict = typeof CONFLICTS[number];
export type Level = typeof LEVELS[number];
export interface Choice<T extends string> { decision: T; confidence: number; probabilities: Record<T, number> }
export type StatusChoice = Choice<Status> | Choice<typeof ACTIVE_STATUSES[number]>;
export interface Rating { score: number; confidence: number; probabilities: Record<Level, number> }
export interface UnresolvedChoice { decision: "unknown"; confidence: null; probabilities: null }
export const ASSESSMENT_ISSUES = ["invalid_status", "invalid_rating", "invalid_conflict", "unsupported_exclusion", "uncertain_exclusion", "inconsistent_exclusion"] as const;
export type AssessmentIssue = typeof ASSESSMENT_ISSUES[number];
export interface Assessment {
  status: StatusChoice | UnresolvedChoice; rating: Rating | null; conflict: Choice<Conflict> | UnresolvedChoice;
  reportedStatus: StatusChoice | null;
  requirementEvidence: { present: boolean; preferred: boolean; conditional: boolean };
  issues: AssessmentIssue[];
}
export type Assessments = Record<Dimension, Assessment>;
export const WEIGHTS: Record<Dimension, number> = { skills: 40, experience: 30, language: 20, location: 5, employment: 5 };
export const LABELS: Record<Dimension, string> = { skills: "Skills", experience: "Experience", language: "Language", location: "Location / work arrangement", employment: "Employment type" };
export interface Score {
  value: number | null; assessedAverage: number | null; provisional: boolean; range: [number, number]; coverage: number;
  breakdown: { dimension: Dimension; weight: number; status: Status; score: number | null; points: number | null }[];
  mandatoryUnmet: Dimension[]; preferenceUnmet: Dimension[]; unknown: Dimension[]; excluded: Dimension[]; conflictUnknown: Dimension[];
}

const rounded = (value: number) => Math.round(value * 10) / 10;
export function scoreAssessments(assessments: Assessments, weights = WEIGHTS): Score {
  if (DIMENSIONS.some(d => !Number.isFinite(weights[d]) || weights[d] < 0) || DIMENSIONS.reduce((sum, d) => sum + weights[d], 0) <= 0) {
    throw new Error("Invalid scoring weights.");
  }
  const breakdown = DIMENSIONS.map(dimension => {
    const answer = assessments[dimension], status = answer.status.decision;
    if (!STATUSES.includes(status) || (status === "assessable" && (!answer.rating || !Number.isFinite(answer.rating.score)
      || answer.rating.score < 0 || answer.rating.score > 5)) || (status !== "assessable" && answer.rating !== null)) {
      throw new Error("Invalid assessment score.");
    }
    const score = answer.rating?.score ?? null;
    return { dimension, weight: weights[dimension], status, score, points: score === null ? null : score * 20 };
  });
  const active = breakdown.filter(row => row.status !== "not_required" && row.weight > 0);
  const total = active.reduce((sum, row) => sum + row.weight, 0);
  const known = active.filter(row => row.points !== null);
  const knownWeight = known.reduce((sum, row) => sum + row.weight, 0);
  // Keep full precision for the weighted calculation; round only the aggregate display.
  const earned = known.reduce((sum, row) => sum + row.weight * row.points!, 0);
  const assessedAverage = knownWeight ? rounded(earned / knownWeight) : null;
  const provisional = !total || knownWeight !== total;
  const conflicts = DIMENSIONS.filter(d => assessments[d].conflict.decision === "conflict");
  return {
    value: provisional ? null : assessedAverage, assessedAverage, provisional,
    range: total ? [rounded(earned / total), rounded((earned + (total - knownWeight) * 100) / total)] : [0, 100],
    coverage: total ? Math.round(knownWeight / total * 100) : 0, breakdown,
    mandatoryUnmet: conflicts.filter(d => ["skills", "experience", "language"].includes(d)),
    preferenceUnmet: conflicts.filter(d => ["location", "employment"].includes(d)),
    conflictUnknown: DIMENSIONS.filter(d => assessments[d].status.decision !== "not_required" && assessments[d].conflict.decision === "unknown"),
    unknown: active.filter(row => row.status === "unknown").map(row => row.dimension),
    excluded: breakdown.filter(row => row.status === "not_required").map(row => row.dimension),
  };
}

export interface AnalysisResult {
  apiVersion: string; assessmentVersion: string; scoringVersion: string; rubricVersion: string; model: string;
  requestId: string; jobId: string; resumeVersion: string; preferencesVersion: string;
  assessments: Assessments; score: Score; durationMs: number;
}
export interface JobInput { id: string; title: string; company: string; description: string }
export type AnalysisState = { phase: "blocked" | "analyzing" | "error"; message: string }
  | { phase: "complete"; result: AnalysisResult; cached: boolean; elapsedMs: number };

export function validateDistribution<T extends string>(value: unknown, keys: readonly T[]): Record<T, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model probabilities.");
  const record = value as Record<T, number>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Number.isFinite(record[key]) || record[key] < 0 || record[key] > 1)
    || Math.abs(keys.reduce((sum, key) => sum + record[key], 0) - 1) > 0.01) throw new Error("Invalid model probabilities.");
  return Object.fromEntries(keys.map(key => [key, record[key]])) as Record<T, number>;
}
export function validateChoice<T extends string>(value: unknown, keys: readonly T[]): Choice<T> {
  const choice = value as Choice<T>;
  if (!choice || !keys.includes(choice.decision) || !Number.isFinite(choice.confidence) || choice.confidence < 0 || choice.confidence > 1) {
    throw new Error("Invalid model choice.");
  }
  const probabilities = validateDistribution(choice.probabilities, keys);
  if (probabilities[choice.decision] < Math.max(...keys.map(key => probabilities[key])) - 0.0001) throw new Error("Invalid model choice.");
  return { decision: choice.decision, confidence: choice.confidence, probabilities };
}
export function validateRating(value: unknown): Rating {
  const rating = value as Rating;
  if (!rating || !Number.isFinite(rating.score) || rating.score < 0 || rating.score > 5
    || !Number.isFinite(rating.confidence) || rating.confidence < 0 || rating.confidence > 1) throw new Error("Invalid model rating.");
  const probabilities = validateDistribution(rating.probabilities, LEVELS);
  const expected = LEVELS.reduce((sum, level) => sum + Number(level) * probabilities[level], 0);
  if (Math.abs(expected - rating.score) > 0.01) throw new Error("Model rating disagrees with its level probabilities.");
  return { score: rating.score, confidence: rating.confidence, probabilities };
}

function resolvedChoice<T extends string>(value: unknown, keys: readonly T[]): Choice<T> | UnresolvedChoice {
  const choice = value as UnresolvedChoice;
  if (choice?.decision === "unknown" && choice.confidence === null && choice.probabilities === null) {
    return { decision: "unknown", confidence: null, probabilities: null };
  }
  return validateChoice(value, keys);
}

function validateStatusChoice(value: unknown, active: boolean): StatusChoice {
  const probabilities = (value as StatusChoice)?.probabilities;
  // Preserve the actual option distribution. Never manufacture a probability
  // for an option that was not asked; missing options in other shapes are invalid.
  return active && probabilities && !Object.hasOwn(probabilities, "not_required")
    ? validateChoice(value, ACTIVE_STATUSES) : validateChoice(value, STATUSES);
}

function statusChoice(value: unknown, active: boolean): StatusChoice | UnresolvedChoice {
  const choice = value as UnresolvedChoice;
  if (choice?.decision === "unknown" && choice.confidence === null && choice.probabilities === null) return { decision: "unknown", confidence: null, probabilities: null };
  return validateStatusChoice(value, active);
}

export function parseAnalysisResult(value: unknown): AnalysisResult {
  const result = value as AnalysisResult;
  const bad = () => new Error("The API returned an invalid or outdated result. Update the Worker and try again.");
  if (!result || result.apiVersion !== API_VERSION || result.assessmentVersion !== ASSESSMENT_VERSION
    || result.scoringVersion !== SCORING_VERSION || result.rubricVersion !== RUBRIC_VERSION || result.model !== "@cf/cloudflare/clef-flash"
    || [result.requestId, result.jobId, result.resumeVersion, result.preferencesVersion].some(v => typeof v !== "string" || !v || v.length > 100)
    || !Number.isFinite(result.durationMs) || result.durationMs < 0 || result.durationMs > 120_000 || !result.assessments) throw bad();
  const assessments = {} as Assessments;
  try {
    for (const dimension of DIMENSIONS) {
      const answer = result.assessments[dimension];
      if (!answer) throw bad();
      const evidence = answer.requirementEvidence;
      const status = statusChoice(answer.status, evidence?.present === true), conflict = resolvedChoice(answer.conflict, CONFLICTS);
      const reportedStatus = answer.reportedStatus === null ? null : validateStatusChoice(answer.reportedStatus, evidence?.present === true);
      if (!evidence || [evidence.present, evidence.preferred, evidence.conditional].some(v => typeof v !== "boolean")
        || ((evidence.preferred || evidence.conditional) && !evidence.present)
        || !Array.isArray(answer.issues) || answer.issues.some(issue => !ASSESSMENT_ISSUES.includes(issue))
        || (status.decision === "not_required" && (evidence.present || reportedStatus?.decision !== "not_required"
          || !("not_required" in reportedStatus.probabilities) || reportedStatus.probabilities.not_required < 0.8 || answer.issues.length > 0))) throw bad();
      const rating = status.decision === "assessable" ? validateRating(answer.rating) : null;
      if ((status.decision !== "assessable" && answer.rating !== null) || (status.decision === "not_required" && conflict.decision === "conflict")) throw bad();
      assessments[dimension] = { status, rating, conflict, reportedStatus,
        requirementEvidence: { present: evidence.present, preferred: evidence.preferred, conditional: evidence.conditional }, issues: [...answer.issues] };
    }
  } catch { throw bad(); }
  const expected = scoreAssessments(assessments);
  // Chrome storage can reorder object keys. Compare values while keeping array order.
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
  if (canonical(result.score) !== canonical(expected)) throw bad();
  return { apiVersion: result.apiVersion, assessmentVersion: result.assessmentVersion, scoringVersion: result.scoringVersion,
    rubricVersion: result.rubricVersion, model: result.model, requestId: result.requestId, jobId: result.jobId,
    resumeVersion: result.resumeVersion, preferencesVersion: result.preferencesVersion, assessments, score: expected, durationMs: result.durationMs };
}
