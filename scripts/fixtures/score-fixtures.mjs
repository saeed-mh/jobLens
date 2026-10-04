export const dimensions = ["skills", "experience", "language", "location", "employment"];
export const statuses = ["assessable", "unknown", "not_required"];
export const conflicts = ["conflict", "no_conflict", "unknown"];
export const levels = ["0", "1", "2", "3", "4", "5"];
export const choice = (decision, keys) => ({ decision, confidence: 1, probabilities: Object.fromEntries(keys.map(k => [k, k === decision ? 1 : 0])) });
export function rating(score) {
  const low = Math.floor(score), high = Math.ceil(score);
  const probabilities = Object.fromEntries(levels.map(level => [level, low === high ? Number(Number(level) === low)
    : Number(level) === low ? high - score : Number(level) === high ? score - low : 0]));
  return { score, confidence: 0.25, probabilities };
}
export function assessments(overrides = {}) {
  return Object.fromEntries(dimensions.map(d => {
    const config = overrides[d] ?? {}, status = config.status ?? "assessable";
    return [d, { status: choice(status, statuses), conflict: choice(config.conflict ?? "no_conflict", conflicts),
      reportedStatus: choice(status, statuses), requirementEvidence: { present: status !== "not_required", preferred: false, conditional: false }, issues: [],
      rating: status === "assessable" ? rating(config.score ?? 5) : null }];
  }));
}
export function provider(input, rubric) {
  const answers = {};
  for (const dimension of dimensions) {
    const a = input[dimension];
    const rawChoice = value => ({ type: "choice", choice: value.decision, confidence: value.confidence, probabilities: value.probabilities });
    answers[`${dimension}_status`] = rawChoice(a.status);
    answers[dimension] = { type: "score", ...(a.rating ?? rating(5)), legend: Object.fromEntries(levels.map(level => [level, rubric[Number(level)]])) };
    answers[`${dimension}_conflict`] = rawChoice(a.conflict);
  }
  return { model: "clef-flash", answers, usage: { input_tokens: 1000, output_tokens: 0 } };
}

// Fixture choices are sharp distributions, independent of a particular prompt.
// Model stubs adapt only valid zero-mass unavailable options to the asked schema.
// Non-zero forbidden options and malformed responses are left intact for tests.
export function providerForQuestions(value, questions) {
  const result = structuredClone(value);
  for (const dimension of dimensions) {
    const raw = result?.answers?.[`${dimension}_status`], probabilities = raw?.probabilities;
    if (questions[`${dimension}_status`]?.criteria.not_required === undefined && raw?.type === "choice"
      && ["assessable", "unknown"].includes(raw.choice) && probabilities
      && Object.keys(probabilities).length === 3 && probabilities.not_required === 0
      && Number.isFinite(probabilities.assessable) && Number.isFinite(probabilities.unknown)
      && Math.abs(probabilities.assessable + probabilities.unknown - 1) < 0.01) delete probabilities.not_required;
  }
  return result;
}
