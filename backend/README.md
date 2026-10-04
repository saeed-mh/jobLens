# Job Lens API

Cloudflare Worker using `@cf/cloudflare/clef-flash` to assess skills, experience, language, location, and employment separately. The current Chrome extension still reads locally; connecting it to this API is the next step.

The API returns typed decisions (`met`, `partial`, `unmet`, `unknown`, `not_required`) and model confidence. Confidence is **not a match percentage**. No final score is calculated yet. Missing resume evidence is unknown, rather than proof that a skill is absent. Decisions are model assessments and need real-world evaluation.

Each question declares its allowed evidence. Skills and experience receive no preference fields; language receives only declared languages; location receives only cities and work arrangement; employment receives only employment types. Location and employment explicitly ignore resume evidence and use the saved preferences as authoritative. All five questions still share one model call, so this is prompt scoping, not a guarantee against model interference.

## Build and test

From the repository root:

```sh
npm run build:backend
npm run test:backend
```

The tests use a mocked AI binding to check the API contract, validation, authentication, privacy, and errors; they do not verify model accuracy. No Cloudflare requests are made by these tests.

`test:backend` rebuilds the deployment artifact first. On Windows it also runs offline checks of the PowerShell live-test script, replacing its network calls and secret prompt with synthetic fixtures.

Files:

- `src/worker.ts`: routes, authentication, bounded body reading, AI call, deadlines, and safe errors.
- `src/contract.ts`: validated request, fixed questions, and validated model answers.
- `wrangler.jsonc`: Worker name, AI binding, and optional CLI-deployed rate limiter.
- `sample-request.json`: synthetic resume and job for live testing.
- `dist/worker.js`: generated standalone JavaScript for the Cloudflare dashboard.
- `dist/build-info.json`: the expected build ID used to verify a deployment before live testing.

## Deploy through the dashboard

1. Build the backend, then open the existing `job-lens-api` Worker in Cloudflare.
2. Keep the Workers AI binding named `AI`.
3. Under **Settings → Variables and Secrets**, add a **Secret** named `JOB_LENS_API_TOKEN`. Generate a random value locally:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Save that value in your password manager. This is a new personal testing key, **not** a Cloudflare account API token. Do not commit it or put it in extension source code.

4. Open **Edit code**, replace the complete code with `backend/dist/worker.js`, then **Deploy**.
5. Open `https://job-lens-api.saeedmohh10.workers.dev/health`. Expect `status: "ok"`, `apiVersion: "job-lens-analysis-v1"`, `assessmentVersion: "dimension-scope-v2"`, and the `buildId` printed during your build.
6. Run all three live scenarios from PowerShell. The script checks `/health` against your local build **before prompting for the secret or calling AI**, then prompts once with hidden input:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario all
   ```

   It sends only synthetic samples, not your saved resume. Each response must identify the same build and return the sent request/job/resume/preferences versions. The script prints the complete results and checks these expected decisions:

   | Scenario | Skills | Experience | Language | Location | Employment |
   | --- | --- | --- | --- | --- | --- |
   | matching | met | met | met | met | met |
   | conflict | met | met | met | unmet | unmet |
   | unknown | unknown | unknown | unknown | met | met |

   Changing work preferences must not change professional assessments. Removing professional evidence must not change compatible work preferences. The script reports `FAIL` and exits with an error if any expected decision differs. A passing sample suite is not proof of accuracy on real resumes and job postings; probabilities can vary.

   To run a single scenario:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario matching
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario conflict
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario unknown
   ```

   If you see `Wrong deployed build`, copy the entire latest `dist/worker.js` into the editor and Deploy again. Preserve the existing `AI` binding and testing secret. Each new build can change the build ID; deploy the file matching your current `dist/build-info.json`.

The dashboard deployment is for personal testing with the secret. Browser GET requests to `/analyze` return 405, and the old public `/test` route returns 404. The secret is required only for POST `/analyze`; `/health` never calls AI.

## Optional CLI deployment

With Wrangler 4.36 or newer installed and authenticated, run `npm run build:backend`, deploy using `wrangler deploy --config backend/wrangler.jsonc`, and set the secret with `wrangler secret put JOB_LENS_API_TOKEN --config backend/wrangler.jsonc`. The CLI deploys the same generated bundle as the dashboard, preserving the build ID. Choose a unique rate-limit namespace number for your Cloudflare account. This config creates `ANALYSIS_RATE_LIMITER`, limiting this personal endpoint to approximately five analyses per minute **per Cloudflare location**. The dashboard-only deployment does not include this binding. Cloudflare rate limiting is eventually consistent and is not a global spending cap.

The shared testing secret is for development. Public distribution needs user authentication and per-user usage controls; do not distribute this secret to extension users.

## API contract

- `GET /` and `GET /health`: service health, no AI inference.
- `POST /analyze`: JSON matching `sample-request.json`, plus `Authorization: Bearer <testing secret>`.
- Consent must explicitly use `granted: true` and notice version `job-lens-cloudflare-v1`. This request field records the caller's assertion; the future extension must obtain actual user consent before sending.
- Health and analysis responses include the assessment version and a build ID derived from the generated bundle. Every response also has an `X-Job-Lens-Build` header. The build ID identifies the code artifact, not any resume or user data.
- Analysis responses include request ID, job ID, resume version, and preferences version so a future client can discard outdated results.
- The body is limited to 64 KiB; the complete model state plus fixed questions and scoped preferences is limited to 40 KiB of UTF-8 JSON, leaving context room for model framing. Oversized text is rejected, never silently truncated.
- Every dimension must return all five probabilities, finite values between 0 and 1, an approximately normalized distribution, and a highest-probability choice. Missing probabilities, including `unknown`, cause `502 invalid_ai_response`; the Worker never fills them in.
- Only text and preferences go to the AI binding. The Worker does not persist input or log resumes, job descriptions, secrets, or raw provider errors. Responses use `Cache-Control: no-store`. Review your own Cloudflare observability settings separately.
- Embedded instructions are treated as untrusted data in fixed questions. This reduces prompt injection risk but does not guarantee model compliance.
- The model response deadline is 30 seconds. An inference already accepted by Workers AI may still consume quota after a response timeout. Tests against the deployed Worker consume real Workers AI usage.

Errors: `400` invalid input/consent, `401` invalid token, `408` slow body, `413` oversized input, `415` wrong content type, `429` configured rate limit, `502` invalid/unavailable model result, `503` missing configuration, `504` model deadline.

Official references: [Clef Flash API and schema](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
