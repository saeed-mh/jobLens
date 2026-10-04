import { DIMENSIONS, RUBRIC, parseAnalysisResult, type AnalysisState } from "../shared/analysis.js";

export function matchingDiagnostics(state: Extract<AnalysisState, { phase: "complete" }>, extensionVersion: string): string {
  // Explicitly allowlist result fields; never include texts, credentials, or identifiers.
  const result = parseAnalysisResult(state.result);
  return JSON.stringify({
    format: "job-lens-match-diagnostics-v2", extensionVersion,
    apiVersion: result.apiVersion, assessmentVersion: result.assessmentVersion,
    scoringVersion: result.scoringVersion, rubricVersion: result.rubricVersion, model: result.model,
    cached: state.cached, elapsedMs: state.elapsedMs, modelDurationMs: result.durationMs,
    rubric: [...RUBRIC], conversion: "score / 5 * 100",
    assessments: Object.fromEntries(DIMENSIONS.map(dimension => [dimension, {
      status: result.assessments[dimension].status,
      rating: result.assessments[dimension].rating,
      conflict: result.assessments[dimension].conflict,
      reportedStatus: result.assessments[dimension].reportedStatus,
      requirementEvidence: result.assessments[dimension].requirementEvidence,
      issues: result.assessments[dimension].issues,
    }])),
    score: result.score,
  }, null, 2);
}
