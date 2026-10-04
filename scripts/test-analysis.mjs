import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assessments, rating } from "./fixtures/score-fixtures.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({ absWorkingDir: root, entryPoints: ["src/shared/analysis.ts", "src/linkedin/matching-diagnostics.ts", "src/shared/provider-trace.ts"], outbase: "src", outdir: ".test-artifacts/score", bundle: true, platform: "node", format: "esm" });
const scoring = await import(pathToFileURL(path.join(root, ".test-artifacts/score/shared/analysis.js")));
const diagnostics = await import(pathToFileURL(path.join(root, ".test-artifacts/score/linkedin/matching-diagnostics.js")));
const { workTraceDiagnostics } = await import(pathToFileURL(path.join(root, ".test-artifacts/score/shared/provider-trace.js")));
test("Work provider diagnostics preserve raw choices and numbers without copying CV text, credentials or arbitrary provider fields", () => {
  const request = { resume: { text: "PRIVATE_CV" }, preferences: { acceptableCities: ["Paderborn"], remoteWork: "hybrid", employmentTypes: ["working-student"] },
    job: { description: "LinkedIn posting details:\nPaderborn\nHybrid\n\nAbout the job:\nPRIVATE_BODY" } };
  const raw = { type: "choice", choice: "not_required", confidence: 0.6142, probabilities: { assessable: 0.043, unknown: 0.1023, not_required: 0.8547 }, privateText: "PRIVATE_PROVIDER" };
  const trace = { format: "job-lens-extension-provider-trace-v1", extensionVersion: "test", extensionRequest: request,
    debug: { format: "job-lens-provider-trace-v1", request: { state: { resume: "PRIVATE_CV", workPreferences: { location: request.preferences, employment: request.preferences } } }, rawResponse: { answers: { location_status: raw }, apiToken: "PRIVATE_TOKEN" } },
    result: { assessments: { location: { status: { decision: "unknown" }, issues: ["unsupported_exclusion"] } } } };
  const text = workTraceDiagnostics(trace), result = JSON.parse(text);
  assert.equal(result.assessments.location.rawStatus.choice, "not_required");
  assert.equal(result.assessments.location.rawStatus.probabilities.not_required, 0.8547);
  assert.equal(result.assessments.location.parsedDecision, "unknown");
  assert.equal(result.assessments.location.rawScore.type, "invalid_or_missing");
  for (const secret of ["PRIVATE_CV", "PRIVATE_TOKEN", "PRIVATE_BODY", "PRIVATE_PROVIDER"]) assert.ok(!text.includes(secret));
  const split = structuredClone(trace);
  split.debug.format = "job-lens-provider-trace-v2";
  split.debug.work = { request: split.debug.request, rawResponse: split.debug.rawResponse };
  split.debug.request = { state: { resume: "PRIVATE_CV" } };
  split.debug.rawResponse = { answers: { location_status: { ...raw, choice: "assessable" } } };
  const splitText = workTraceDiagnostics(split);
  assert.equal(JSON.parse(splitText).assessments.location.rawStatus.choice, "not_required");
  assert.deepEqual(JSON.parse(splitText).modelWorkPreferences, result.modelWorkPreferences);
  for (const secret of ["PRIVATE_CV", "PRIVATE_TOKEN", "PRIVATE_BODY", "PRIVATE_PROVIDER"]) assert.ok(!splitText.includes(secret));
});
const response = a => ({ apiVersion: scoring.API_VERSION, assessmentVersion: scoring.ASSESSMENT_VERSION, scoringVersion: scoring.SCORING_VERSION,
  rubricVersion: scoring.RUBRIC_VERSION, model: "@cf/cloudflare/clef-flash", requestId: "req", jobId: "100", resumeVersion: "resume", preferencesVersion: "pref",
  assessments: a, score: scoring.scoreAssessments(a), durationMs: 123 });

test("The supplied live diagnostics preserve a model-unknown language and blocked work exclusions without inventing scores", async () => {
  const reported = JSON.parse(await readFile(path.join(root, "scripts/fixtures/reported-clef-unresolved.json"), "utf8"));
  const result = scoring.parseAnalysisResult({ ...response(reported.assessments), score: reported.score });
  assert.equal(result.assessments.language.reportedStatus.decision, "unknown");
  assert.deepEqual(result.assessments.language.status, result.assessments.language.reportedStatus);
  assert.deepEqual(result.assessments.language.issues, []);
  assert.equal(result.assessments.language.rating, null);
  for (const dimension of ["location", "employment"]) {
    assert.equal(result.assessments[dimension].reportedStatus.decision, "not_required");
    assert.equal(result.assessments[dimension].requirementEvidence.present, true);
    assert.deepEqual(result.assessments[dimension].issues, ["unsupported_exclusion"]);
    assert.deepEqual(result.assessments[dimension].status, { decision: "unknown", confidence: null, probabilities: null });
    assert.equal(result.assessments[dimension].rating, null);
  }
  assert.equal(result.score.coverage, 70);
  assert.equal(result.score.assessedAverage, 58.4);
  assert.deepEqual(result.score.range, [40.9, 70.9]);
  assert.deepEqual(result.score.excluded, []);
  assert.equal(result.score.value, null);
});

test("Clef 3.7/5 converts to 74/100 without categorical midpoint mapping or probability thresholds", () => {
  const a = assessments({ skills: { score: 3.7 } });
  a.skills.rating.confidence = 0;
  const result = scoring.parseAnalysisResult(response(a));
  assert.equal(result.assessments.skills.rating.score, 3.7);
  assert.equal(result.score.breakdown[0].points, 74);
  assert.equal(result.score.value, 89.6);
  assert.equal(result.score.provisional, false);
});

test("Active two-option status distributions reach the extension unchanged, while missing answers and probabilities are invalid", () => {
  const a = assessments({ location: { score: 2.3983 } });
  a.location.status = { decision: "assessable", confidence: 0.6, probabilities: { assessable: 0.8, unknown: 0.2 } };
  a.location.reportedStatus = structuredClone(a.location.status);
  const result = scoring.parseAnalysisResult(response(a));
  assert.deepEqual(result.assessments.location.status.probabilities, { assessable: 0.8, unknown: 0.2 });
  assert.ok(Math.abs(result.score.breakdown.find(row => row.dimension === "location").points - 47.966) < 1e-10);
  assert.ok(!Object.hasOwn(result.assessments.location.reportedStatus.probabilities, "not_required"));
  const missing = structuredClone(a); delete missing.location.status.probabilities.unknown;
  assert.throws(() => scoring.parseAnalysisResult(response(missing)), /invalid/);
  const noEvidence = structuredClone(a); noEvidence.location.requirementEvidence.present = false;
  assert.throws(() => scoring.parseAnalysisResult(response(noEvidence)), /invalid/);
  const badReported = structuredClone(a); badReported.location.reportedStatus = { decision: "unknown", confidence: null, probabilities: null };
  assert.throws(() => scoring.parseAnalysisResult(response(badReported)), /invalid/);
});
test("The weighted average uses 40/30/20/5/5, with full precision before display rounding", () => {
  const a = assessments({ skills: { score: 3.7 }, experience: { score: 4.2 }, language: { score: 5 }, location: { score: 4 }, employment: { score: 4 } });
  const score = scoring.scoreAssessments(a);
  assert.equal(score.value, 82.8); assert.equal(score.assessedAverage, 82.8);
  assert.equal(score.coverage, 100); assert.deepEqual(score.range, [82.8, 82.8]);
  const b = assessments({ skills: { score: 3.73331 }, experience: { score: 2.94441 } });
  assert.equal(scoring.scoreAssessments(b).value, Math.round((3.73331 * 20 * 40 + 2.94441 * 20 * 30 + 100 * 30) / 100 * 10) / 10);
});
test("Assessable zero is a real zero score, and five is exactly 100", () => {
  const a = assessments(Object.fromEntries(scoring.DIMENSIONS.map(d => [d, { score: 0 }])));
  assert.equal(scoring.parseAnalysisResult(response(a)).score.value, 0);
  assert.equal(scoring.scoreAssessments(a).assessedAverage, 0);
  assert.equal(scoring.scoreAssessments(a).provisional, false);
  assert.equal(scoring.scoreAssessments(assessments()).value, 100);
});
test("Unknown criteria get no numeric score, keep an incomplete overall result, and show conditional bounds", () => {
  const a = assessments({ skills: { status: "unknown" } });
  const score = scoring.scoreAssessments(a);
  assert.equal(score.value, null); assert.equal(score.assessedAverage, 100); assert.equal(score.coverage, 60);
  assert.deepEqual(score.range, [60, 100]); assert.deepEqual(score.unknown, ["skills"]);
  assert.equal(score.breakdown[0].points, null);
  const none = scoring.scoreAssessments(assessments(Object.fromEntries(scoring.DIMENSIONS.map(d => [d, { status: "unknown" }]))));
  assert.equal(none.assessedAverage, null); assert.equal(none.value, null); assert.deepEqual(none.range, [0, 100]);
});
test("Unneeded criteria are excluded and remaining weights normalized, including no applicable criteria", () => {
  const a = assessments({ skills: { score: 3.7 }, language: { status: "not_required" }, location: { status: "not_required" }, employment: { status: "not_required" } });
  assert.equal(scoring.scoreAssessments(a).value, 85.1); // (74*40 + 100*30)/70
  const none = scoring.scoreAssessments(assessments(Object.fromEntries(scoring.DIMENSIONS.map(d => [d, { status: "not_required" }]))));
  assert.equal(none.value, null); assert.equal(none.assessedAverage, null); assert.equal(none.coverage, 0);
});
test("Mandatory conflicts are independent of numeric scores, preferences, and unknown grades", () => {
  const a = assessments({ skills: { score: 4.7, conflict: "conflict" }, location: { score: 4.8, conflict: "conflict" }, language: { status: "unknown", conflict: "conflict" }, employment: { conflict: "unknown" } });
  const score = scoring.scoreAssessments(a);
  assert.deepEqual(score.mandatoryUnmet, ["skills", "language"]);
  assert.deepEqual(score.preferenceUnmet, ["location"]);
  assert.deepEqual(score.conflictUnknown, ["employment"]);
  assert.equal(score.breakdown[0].points, 94);
});
test("Out-of-range, incomplete, and inconsistent score distributions are rejected without clamping or filling values", () => {
  for (const invalid of [-0.1, 5.1, NaN, Infinity]) assert.throws(() => scoring.validateRating({ ...rating(3.7), score: invalid }));
  const incomplete = rating(3.7); delete incomplete.probabilities["0"];
  assert.throws(() => scoring.validateRating(incomplete));
  assert.throws(() => scoring.validateRating({ ...rating(3.7), score: 3.9 }));
  const wrong = rating(3.7); wrong.probabilities.extra = 0;
  assert.throws(() => scoring.validateRating(wrong));
  const a = assessments(); a.skills.status.decision = "unknown";
  assert.throws(() => scoring.parseAnalysisResult(response(a)));
});
test("Unknown and excluded grades cannot be smuggled into results or turned into zero, and old contracts are rejected", () => {
  const value = response(assessments());
  for (const [field, old] of [["apiVersion", "job-lens-analysis-v1"], ["assessmentVersion", "clef-score-v2"], ["assessmentVersion", "clef-score-v4"], ["assessmentVersion", "clef-score-v5"], ["assessmentVersion", "clef-score-v6"], ["assessmentVersion", "clef-score-v7"], ["scoringVersion", "weighted-evidence-v2"], ["rubricVersion", "old"]]) {
    assert.throws(() => scoring.parseAnalysisResult({ ...value, [field]: old }));
  }
  assert.throws(() => scoring.parseAnalysisResult({ ...value, score: { ...value.score, value: 99 } }));
  const a = assessments({ skills: { status: "unknown" } }), invalid = response(a);
  invalid.assessments.skills.rating = rating(0);
  assert.throws(() => scoring.parseAnalysisResult(invalid));
  const contradictory = assessments({ skills: { status: "not_required", conflict: "conflict" } });
  assert.throws(() => scoring.parseAnalysisResult(response(contradictory)));
});
test("Chrome key reordering is accepted; private provider fields and identifiers stay out of copied diagnostics", () => {
  const value = response(assessments({ skills: { score: 3.7 } }));
  value.requestId = "PRIVATE_REQUEST_ID"; value.jobId = "PRIVATE_JOB_ID"; value.resumeVersion = "PRIVATE_RESUME_ID"; value.preferencesVersion = "PRIVATE_PREF_ID";
  value.resume = "PRIVATE_RESUME_TEXT"; value.apiToken = "PRIVATE_API_KEY"; value.jobText = "PRIVATE_JOB_TEXT";
  value.assessments.skills.rating.privateField = "PRIVATE_PROVIDER_FIELD";
  const reorder = item => Array.isArray(item) ? item.map(reorder) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, reorder(val)])) : item;
  assert.equal(scoring.parseAnalysisResult(reorder(value)).score.value, 89.6);
  const text = diagnostics.matchingDiagnostics({ phase: "complete", result: value, cached: true, elapsedMs: 0 }, "0.6.3");
  assert.ok(!text.includes("PRIVATE_"));
  const report = JSON.parse(text);
  assert.equal(report.format, "job-lens-match-diagnostics-v2"); assert.equal(report.cached, true);
  assert.equal(report.assessments.skills.rating.score, 3.7);
  assert.equal(report.score.breakdown[0].points, 74); assert.equal(report.rubric.length, 6);
});
test("Custom weights reject negative, non-finite, or zero totals", () => {
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => scoring.scoreAssessments(assessments(), { ...scoring.WEIGHTS, skills: invalid }));
  assert.throws(() => scoring.scoreAssessments(assessments(), Object.fromEntries(scoring.DIMENSIONS.map(d => [d, 0]))));
  assert.equal(scoring.scoreAssessments(assessments({ skills: { score: 3.7 } }), { skills: 1, experience: 0, language: 0, location: 0, employment: 0 }).value, 74);
});

test("Repaired exclusions preserve the original choice with unresolved probabilities, not invented certainty or points", () => {
  const a = assessments({ language: { status: "unknown" } });
  a.language.status = { decision: "unknown", confidence: null, probabilities: null };
  a.language.reportedStatus = assessments({ language: { status: "not_required" } }).language.status;
  a.language.requirementEvidence = { present: true, preferred: false, conditional: true };
  a.language.issues = ["unsupported_exclusion"];
  const result = scoring.parseAnalysisResult(response(a));
  assert.equal(result.assessments.language.reportedStatus.decision, "not_required");
  assert.equal(result.assessments.language.status.probabilities, null);
  assert.equal(result.score.value, null); assert.ok(result.score.unknown.includes("language"));
  const report = JSON.parse(diagnostics.matchingDiagnostics({ phase: "complete", result, cached: false, elapsedMs: 20 }, "0.6.3"));
  assert.deepEqual(report.assessments.language.issues, ["unsupported_exclusion"]);
  a.language.status = a.language.reportedStatus;
  assert.throws(() => scoring.parseAnalysisResult(response(a)));
});
