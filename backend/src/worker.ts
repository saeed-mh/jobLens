import { API_VERSION, ASSESSMENT_VERSION, BUILD_ID, MODEL, MAX_BODY_BYTES, ApiError, parseRequest, modelInputs, parseModelOutput } from "./contract.js";
import { withTimeout } from "./deadline.js";
import { SCORING_VERSION, RUBRIC_VERSION, scoreAssessments } from "../../src/shared/analysis.js";

export interface Env {
  AI: { run(model: string, input: ReturnType<typeof modelInputs>["professional"] | ReturnType<typeof modelInputs>["work"]): Promise<unknown> };
  JOB_LENS_API_TOKEN: string;
  // Wrangler config enables this. Dashboard-only personal tests may omit it.
  ANALYSIS_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

const MODEL_TIMEOUT_MS = 30_000;
const BODY_TIMEOUT_MS = 10_000;

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Job-Lens-Build": BUILD_ID, ...extraHeaders,
  } });
}

async function authorized(request: Request, token: string): Promise<boolean> {
  const provided = request.headers.get("Authorization") ?? "";
  if (provided.length > 512) return false;
  const encode = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(provided)),
    crypto.subtle.digest("SHA-256", encode.encode(`Bearer ${token}`)),
  ]);
  const actualBytes = new Uint8Array(actual), expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index++) difference |= actualBytes[index]! ^ expectedBytes[index]!;
  return difference === 0;
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send application/json.");
  }
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new ApiError(413, "body_too_large", "Request body exceeds 64 KiB.");
  }
  if (!request.body) throw new ApiError(400, "invalid_json", "Send a JSON request body.");
  const reader = request.body.getReader();
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large", "Request body exceeds 64 KiB.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new ApiError(400, "invalid_json", "Send valid UTF-8 JSON."); }
  };
  try {
    return await withTimeout(read(), BODY_TIMEOUT_MS, new ApiError(408, "request_timeout", "Request body took too long to arrive."));
  } catch (error) {
    // Stop reading oversized or stalled requests; never log their contents.
    void reader.cancel().catch(() => {});
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/health") {
      if (request.method !== "GET") return json({ error: { code: "method_not_allowed", message: "Use GET." } }, 405, { Allow: "GET" });
      return json({ status: "ok", service: "Job Lens", apiVersion: API_VERSION, assessmentVersion: ASSESSMENT_VERSION, scoringVersion: SCORING_VERSION, rubricVersion: RUBRIC_VERSION, buildId: BUILD_ID });
    }
    if (path !== "/analyze") return json({ error: { code: "not_found", message: "Route not found." } }, 404);
    if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405, { Allow: "POST" });
    try {
      if (typeof env.JOB_LENS_API_TOKEN !== "string" || !/^[a-zA-Z0-9_-]{32,128}$/.test(env.JOB_LENS_API_TOKEN)
        || typeof env.AI?.run !== "function") {
        throw new ApiError(503, "configuration_error", "Configure the AI binding and JOB_LENS_API_TOKEN secret.");
      }
      if (!await authorized(request, env.JOB_LENS_API_TOKEN)) {
        throw new ApiError(401, "unauthorized", "A valid personal testing API token is required.");
      }
      const input = parseRequest(await readJson(request));
      const payloads = modelInputs(input);
      if (env.ANALYSIS_RATE_LIMITER) {
        const result = await env.ANALYSIS_RATE_LIMITER.limit({ key: "job-lens-personal-analyze-v1" });
        if (!result.success) throw new ApiError(429, "rate_limited", "Too many analyses. Wait a minute before trying again.");
      }
      // A response deadline cannot cancel an inference already accepted by Workers AI.
      const started = performance.now();
      const [raw, workRaw] = await withTimeout(Promise.all([
        env.AI.run(MODEL, payloads.professional), env.AI.run(MODEL, payloads.work),
      ]), MODEL_TIMEOUT_MS,
        new ApiError(504, "ai_timeout", "The model took too long to respond. Try again later."));
      const professional = parseModelOutput(raw, input), work = parseModelOutput(workRaw, input);
      // Only answers requested in each call can contribute to the result.
      const result = { assessments: { skills: professional.assessments.skills, experience: professional.assessments.experience,
        language: professional.assessments.language, location: work.assessments.location, employment: work.assessments.employment },
        usage: { inputTokens: professional.usage.inputTokens + work.usage.inputTokens,
          outputTokens: professional.usage.outputTokens + work.usage.outputTokens } };
      return json({
        apiVersion: API_VERSION, assessmentVersion: ASSESSMENT_VERSION, buildId: BUILD_ID, model: MODEL,
        requestId: input.requestId, jobId: input.job.id,
        resumeVersion: input.resume.version, preferencesVersion: input.preferencesVersion,
        ...result, scoringVersion: SCORING_VERSION, rubricVersion: RUBRIC_VERSION, score: scoreAssessments(result.assessments), durationMs: Math.round(performance.now() - started),
        // Explicit authenticated debugging only. No tokens, headers, errors, logs,
        // or retained traces; the normal extension never requests this report.
        ...(request.headers.get("X-Job-Lens-Debug") === "requirements-v1"
          ? { debug: { format: "job-lens-provider-trace-v2", request: payloads.professional, rawResponse: raw,
            work: { request: payloads.work, rawResponse: workRaw } } } : {}),
      });
    } catch (error) {
      // Provider errors can contain input text or infrastructure details. Do not echo/log them.
      const safeError = error instanceof ApiError ? error
        : new ApiError(502, "ai_unavailable", "Analysis is unavailable. Check the Worker bindings and Workers AI quota, then try again.");
      return json({ error: { code: safeError.code, message: safeError.message } }, safeError.status,
        safeError.status === 429 ? { "Retry-After": "60" } : {});
    }
  },
};
