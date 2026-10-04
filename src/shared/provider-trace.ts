import { RUBRIC } from "./analysis.js";

export const PROVIDER_TRACE_KEY = "jobLens.providerTrace.v1";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Only a trusted extension page reads the full trace. The copyable report below
// excludes the CV, request identifiers, credentials and arbitrary provider text.
export function workTraceDiagnostics(value: unknown): string {
  const trace = object(value), request = object(trace.extensionRequest), debug = object(trace.debug);
  if (trace.format !== "job-lens-extension-provider-trace-v1" || !["job-lens-provider-trace-v1", "job-lens-provider-trace-v2"].includes(String(debug.format))) throw new Error("No valid provider trace is available.");
  const workCall = debug.format === "job-lens-provider-trace-v2" ? object(debug.work) : debug;
  const modelRequest = object(workCall.request), state = object(modelRequest.state), answers = object(object(workCall.rawResponse).answers);
  const preferences = object(request.preferences), job = object(request.job), result = object(trace.result), assessments = object(result.assessments);
  function answer(name: string) {
    const raw = object(answers[name]), probabilities = object(raw.probabilities), legend = object(raw.legend);
    return { type: raw.type === "choice" || raw.type === "score" ? raw.type : "invalid_or_missing",
      choice: ["assessable", "unknown", "not_required", "conflict", "no_conflict"].includes(String(raw.choice)) ? raw.choice : null,
      score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
      confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null,
      probabilities: Object.fromEntries(Object.entries(probabilities).filter(([key, number]) =>
        ["assessable", "unknown", "not_required", "conflict", "no_conflict", "0", "1", "2", "3", "4", "5"].includes(key)
        && typeof number === "number" && Number.isFinite(number))),
      ...(raw.type === "score" ? { legendMatchesRubric: Object.keys(legend).length === 6 && RUBRIC.every((label, index) => legend[String(index)] === label) } : {}),
    };
  }
  const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50).map(item => item.slice(0, 120)) : [];
  const work = object(state.workPreferences), location = object(work.location), employment = object(work.employment);
  return JSON.stringify({ format: "job-lens-work-provider-diagnostics-v1", extensionVersion: trace.extensionVersion,
    assessmentVersion: result.assessmentVersion, rubricVersion: result.rubricVersion,
    postingDetails: typeof job.description === "string" && job.description.startsWith("LinkedIn posting details:\n")
      ? job.description.split("\n\nAbout the job:\n")[0].slice(0, 6000) : "No separate posting header captured",
    savedPreferences: { acceptableCities: stringList(preferences.acceptableCities), remoteWork: preferences.remoteWork, employmentTypes: stringList(preferences.employmentTypes) },
    modelWorkPreferences: { location: { acceptableCities: stringList(location.acceptableCities), remoteWork: location.remoteWork }, employment: { employmentTypes: stringList(employment.employmentTypes) } },
    assessments: Object.fromEntries(["location", "employment"].map(dimension => [dimension, {
      rawStatus: answer(`${dimension}_status`), rawScore: answer(dimension), rawConflict: answer(`${dimension}_conflict`),
      parsedDecision: object(object(assessments[dimension]).status).decision,
      issues: object(assessments[dimension]).issues,
    }])),
  }, null, 2);
}
