# Job Lens API

Cloudflare Worker using **@cf/cloudflare/clef-flash** to assess skills, experience, language, location, and employment. Version 0.6.11 splits 15 typed questions across two parallel inferences: nine for skills/experience/language and six for location/employment. Each criterion retains its assessability choice, 0–5 score question, and independent conflict choice. One fresh API analysis uses two Workers AI calls; cache hits use none.

Each question declares its evidence scope. The professional inference receives the complete CV and posting, saved language levels, and employment context solely for conditional branch selection. It receives no city or work-arrangement preferences. The work inference receives the complete posting and **state.workPreferences**, with no CV, language settings, or qualification questions. Its **state.postingHeader** highlights quoted header facts, exact cities and work arrangements. The complete description remains available so offered alternatives and contradictions are preserved. A matching city and mismatching arrangement permit comparison; exclusively On-site versus an active Hybrid preference is checked independently for conflict. Header facts never assign a score, prove absence, or override a model unknown. Language comparisons retain CV declarations, German/English equivalents, and CEFR notation even when saved settings are empty.

Preferred qualifications remain comparison evidence without becoming mandatory conflicts. Conditional qualifications retain their alternatives: English B2 and German B1 for working students/B2 for full-time are not collapsed into one threshold. Generic part-time or enrollment alone does not establish a working-student application. Unknown branches remain unresolved. Stated city, work arrangement, and employment conditions cannot be excluded solely because saved preferences are empty.

**Working student (Werkstudent)** is a separate employment preference, stored as **working-student**. Branch selection considers the explicit working-student and full-time options: exactly one of these selects its stated conditional language/education requirements, even alongside part-time or internship. Both or neither leave these alternatives unresolved. A known saved branch takes precedence over an old CV target. Selecting the preference is not evidence of enrollment, student eligibility, or proficiency. Employment matching recognizes Werkstudent/Werkstudentin/working student roles separately from internships.

Language settings support **A1, A2, B1, B2, C1, C2** as exact CEFR levels while retaining existing broad labels. Explicit CEFR evidence takes precedence over a broad label for the same language; conflicting explicit levels remain unresolved. No automatic conversion maps Basic or Professional to a CEFR level, and old saved settings remain intact. English "Fließend" is qualitative evidence, not an invented numeric CEFR level.

The status questions retain the previous restriction that removes the not_required option entirely when positive condition evidence or an active work preference is present. The model chooses assessable or unknown; absent comparison facts do not become assumed points. Without positive evidence, the three-option question remains, and absence still needs strong model support before exclusion. The parser retains the actual two- or three-option probabilities without adding values. Unexpected or incomplete distributions remain unresolved, and forbidden exclusions are retained only as diagnostics. The six score levels, conversion, weighted arithmetic and separate conflict questions are unchanged.

An unclear target branch must not erase comparable shared requirements. For example, declared English B2 remains comparable to the shared English B2 condition while German's B1/B2 branch stays uncertain. Full-time German B1 versus required B2 is a comparable mismatch, with its mandatory conflict checked independently. Cities are passed as saved: Padernborn is not silently changed to Paderborn. Correct typos in settings before testing a location match.

## Scoring

Six ordered levels define **alignment-0-5-v1**:

| Level | Meaning |
| --- | --- |
| 0 | No alignment: explicit assessable evidence shows incompatibility or no relevant support. |
| 1 | Very limited alignment: isolated support; most required alignment remains unestablished or contradicted. |
| 2 | Limited alignment: some support; substantial alignment remains unestablished or contradicted. |
| 3 | Moderate alignment: several conditions supported; noticeable gaps or uncertainty remain. |
| 4 | Strong alignment: most conditions supported; small gaps or uncertainty remain. |
| 5 | Full alignment: all required conditions or active preferences supported without demonstrated gaps. |

The exact descriptions are shared by the Worker and extension in **src/shared/analysis.ts**. Optional qualifications are not mandatory. A criterion without enough evidence for any meaningful comparison is unknown and receives no numeric rating. Missing evidence alone never means zero or a mandatory conflict.

Clef returns a probability-weighted rubric level that may be fractional. Convert with **points = rating / 5 × 100**: **3.7/5 becomes 74/100**, rather than a fixed categorical midpoint. Model confidence is not substituted for the rating or used as an accuracy threshold. [Cloudflare score schema](https://developers.cloudflare.com/workers-ai/models/clef-flash/schema-output.json).

Default weights: skills 40%, experience 30%, language 20%, location 5%, employment 5%. The weighted average is **sum(weight × points) / sum(assessed weights)**, calculated before aggregate rounding to one decimal. Unneeded criteria are excluded and the UI shows normalized active weights.

If an active criterion is unknown, **score.value** is null. **score.assessedAverage** describes assessed criteria only; **score.range** holds their ratings fixed and varies unknown weight from 0 to 100. It is a conditional rubric range, not a statistical confidence interval. All-unknown or all-unneeded assessments have no average. Coverage is the percentage of active weight assigned a rating, not evidence quality or hiring probability.

Mandatory conflicts in skills, experience, and language are independently model-flagged; work preference conflicts appear separately. Scores are never used to infer or erase these flags. An unresolved conflict check also appears separately. A high score does not establish that mandatory conditions are satisfied.

## Build and deploy

From the repository root:

~~~sh
npm run build
npm run build:backend
~~~

1. Keep the production Workers AI binding named **AI** and existing **JOB_LENS_API_TOKEN** secret.
2. Replace the complete dashboard Worker code with **backend/dist/worker.js**, then Deploy.
3. Open the production /health endpoint. Verify its build ID matches **backend/dist/build-info.json** and these versions:

   | Field | Value |
   | --- | --- |
   | apiVersion | job-lens-analysis-v2 |
   | assessmentVersion | clef-score-v9 |
   | scoringVersion | weighted-clef-score-v1 |
   | rubricVersion | alignment-0-5-v1 |

4. Reload Job Lens in chrome://extensions and refresh LinkedIn. Old categorical results and cached versions are rejected.

For a first deployment, generate a random personal testing secret locally:

~~~sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

Save it in your password manager and add it as a Worker secret. This is an application testing key; a Cloudflare account token must never be entered in extension settings or committed.

Optional CLI deployment uses **wrangler deploy --config backend/wrangler.jsonc** after a build, and **wrangler secret put JOB_LENS_API_TOKEN --config backend/wrangler.jsonc**. The config's optional rate limiter allows approximately five analyses per minute per Cloudflare location, not a global spending cap. Public distribution needs user authentication and per-user controls instead of the shared personal testing key.

## API and validation

- GET / and /health report metadata without inference. POST /analyze requires the personal token and explicitly asserted consent; GET /analyze returns 405 and /test returns 404.
- Request fields follow **sample-request.json**. The original file is never sent.
- Each assessment includes resolved status, the original valid model status or null, a rating or null, independent conflict status, positive requirement markers, and parsing issue codes. Unknown choices caused by missing/invalid answers have null confidence and probabilities; no model certainty is invented.
- Provider answers must have the right type and complete, finite, normalized probabilities. Score answers must have six level keys 0–5, the exact requested rubric legend, and a finite score in 0–5 consistent with the probability-weighted level within rounding tolerance. Missing or invalid individual answers stay unresolved and are identified by issue codes. Invalid overall model/usage envelopes fail with 502. Nothing is clamped or filled in with a grade.
- Exclusion requires a valid not_required answer with selected probability at least 0.8, lead at least 0.2, no parsing issues, no explicit conflict, and no positive job-condition or active-preference markers. This is a conservative exclusion policy, not calibrated accuracy. Marker patterns only prevent exclusion; absence of a marker never proves absence or assigns a score. Returned grades for unknown/excluded criteria are discarded. Conflicts survive a repaired exclusion separately.
- Responses carry request/job/resume/preferences versions for stale-result checks, plus API, assessment, scoring, rubric, and build versions. Unrecognized provider fields never reach the page.
- Bodies are limited to 64 KiB. The complete original analysis and each actual inference payload must fit 40 KiB UTF-8; every budget is checked before either AI call starts. Inputs are rejected rather than silently truncated.
- Shared fixed rules and CV-language guidance are stored once in structured state. Work preference facts are also stored once there, rather than repeated inside instructions. Status questions contain their criterion definition directly. With the sample preferences, fixed instructions and metadata occupy less than 22 KiB; an 18 KiB CV/posting regression fits intact. Actual space depends on preferences, metadata, escaping, and UTF-8 byte lengths; all CV and job text is preserved.
- Usage sums both provider responses. Only answers from the inference assigned to that dimension are parsed into the result; extra answers cannot replace missing work answers.
- The Worker does not persist or log input, credentials, or raw provider errors. Responses use Cache-Control: no-store. Review account observability settings separately.
- The AI deadline is 30 seconds; the extension waits 25 seconds. An accepted inference can still consume quota after a client abort.
- The extension stores up to 30 sanitized results for six hours in trusted session storage. Keys include text/version fingerprints and the scoring/rubric contract. Saved settings changes invalidate results and active requests.

## Tests

~~~sh
npm test
npm run test:backend
npm run test:browser
~~~

Local tests mock Workers AI and intercept synthetic browser requests. They verify conversion, weighted averages, unknown/excluded criteria, independent conflicts, contract validation, consent, caching, stale results, and failures. They do not establish real model accuracy or spend AI quota.

After deploying, run a single synthetic live analysis (two Workers AI calls):

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario matching
~~~

The script verifies the deployed build before its hidden key prompt. It checks assessability/conflict decisions and rating conversion, without prescribing an exact model grade. **-Scenario languages** runs four CV-only German/English cases; **-Scenario all** runs seven cases and can reach the configured five-per-minute limiter. Run suites separately with a pause when that limiter is enabled.

**-Scenario conditional** runs four separate cases using the supplied metamorphosis posting: working-student only, full-time only, both types, and no declared language levels. It checks that shared English and relevant experience remain comparable, the full-time German B1/B2 mismatch is flagged, and the missing-language control stays unknown. This suite tests live model decisions; local mocks only validate the test plumbing.

**-Scenario language-settings** runs two cases using the reported CV language lines and screenshot preferences in **sample-language-settings-request.json**, with synthetic experience text. It preserves Dortmund/Paderborn, hybrid, and part-time/working-student/internship; compares the original broad settings with English Fluent/German B1; and expects language, location, and employment to be assessable without prescribing grades. These two analyses consume four real Workers AI calls after deployment.

Language cases expect: native German + English C2 → assessable/no conflict; German A2 + English C2 → assessable/mandatory conflict; English C2 without German evidence → partial assessable evidence/no assumed conflict; no declarations → unknown. These are synthetic regression expectations, not a guarantee for every qualitative language requirement.

## Inspect a real provider trace

After deploying, run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/debug-requirements-live.ps1
~~~

The default request uses the supplied metamorphosis posting in **sample-requirements-request.json** and a synthetic CV declaring English B2/German B1 with a full-time target. The hidden-key script sends one API request with two parallel real inferences and writes **.test-artifacts/provider-trace.json** with the actual Workers AI request, raw response, and parsed assessments. Compare **debug.rawResponse.answers.language_status** with **assessments.language.reportedStatus**, resolved status, and issues. Conditional full-time German B2 should be checked separately from preferred experience; no exact numeric grade is prescribed.

For the remaining work-comparison issue, use **-RequestFile backend/sample-language-settings-request.json** from the project directory. Verify **debug.work.request.state.workPreferences** contains Dortmund/Paderborn, hybrid, and part-time/working-student/internship, then inspect **debug.work.rawResponse.answers.location_status**, **employment_status**, their raw score questions, and the parsed issues. This trace records both actual inference requests and raw responses, and distinguishes a still-incorrect model decision from invalid grading or parsing; a local mock passing does not prove the live result is fixed.

Live/debug scripts decode response bytes as strict UTF-8 through **scripts/worker-json.ps1**. This preserves German language text and exact rubric legends when Windows PowerShell 5.1 receives JSON without a charset. Earlier saved reports may contain corrupted Unicode even when the server's parsed decisions are valid; do not treat those mangled strings as the original request or response. This script correction does not change the deployed Worker or scoring contract.

**-RequestFile** accepts a reviewed, consented request in the normal schema for reproducing another case. The report contains that request's CV/job text; it is ignored by Git and never automatically uploaded. No token or authorization header is included. The Worker only returns the trace for explicitly authenticated **X-Job-Lens-Debug: requirements-v1** requests, does not persist it, and never returns provider exception text. Normal extension requests and copied matching diagnostics do not contain raw traces.

The authenticated debug response uses **job-lens-provider-trace-v2**: **debug.request/rawResponse** record the professional call; **debug.work.request/rawResponse** record the work call. Both are actual provider payloads, not a reconstructed combined request. Opt-in extension capture keeps both in trusted session storage; copied work diagnostics omit the CV and private provider text. The REWE regression preserves the supplied Cologne/On-site/Part-time header and captured valid unknown, using a clearly synthetic body because the full REWE description was not supplied. Local regressions verify isolation and parsing, not live model accuracy.
