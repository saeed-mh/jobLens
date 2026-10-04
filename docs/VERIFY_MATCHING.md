# Verify AI matching

## Update both components

~~~sh
npm run build
npm run build:backend
~~~

Replace the complete production Worker code with **backend/dist/worker.js** and Deploy, preserving AI and JOB_LENS_API_TOKEN. Its /health response must match the build ID in **backend/dist/build-info.json** and report job-lens-analysis-v2, clef-score-v9, weighted-clef-score-v1, and alignment-0-5-v1.

Reload extension **0.6.11** in chrome://extensions and refresh LinkedIn. Previous assessment/scoring/rubric responses are rejected. Confirmed CV text and preferences remain saved.

The extension reads the opened posting's header. In **Review detected job description**, check that **LinkedIn posting details** includes the displayed city, work arrangement and employment type (for the supplied posting: Paderborn, Hybrid, Full-time). These details and the complete About-the-job body are sent together. The modern header ends before the people/company sections; classic layouts use scoped metadata selectors. Unknown layouts still need layout diagnostics. A changed extracted posting produces a fresh cache key.

Version **0.6.11 / clef-score-v9** separates the actual model requests: skills/experience/language receive CV evidence; location/employment receive the full posting, quoted header facts and saved **state.workPreferences**, with no CV or language settings. City and work arrangement are compared separately, so an acceptable city does not erase an On-site/Hybrid mismatch. Missing facts, contradictory offers and valid model unknowns stay unresolved. The rubric, conversion, weights and exclusion rules are unchanged. One fresh analysis uses **two parallel Workers AI calls**, with summed usage; cache hits make no calls. All input budgets are checked before either call, without cutting document text.

The captured regression had **Padernborn** saved, while the posting stated **Paderborn**. Correct that spelling in settings and save it before a fresh test. City strings are not silently corrected by the extension or parser.

## Setup

1. Review the saved CV text, including language declarations. Remove unnecessary personal information and confirm the text.
2. Save languages and work preferences. Language levels in the CV are also model evidence; empty saved language settings do not erase them.
3. Enter the existing personal JOB_LENS_API_TOKEN testing secret in settings. It remains in trusted local extension storage and is not encrypted. Never use a Cloudflare account token.
4. Enable automatic matching, save, and confirm consent. Reviewed CV text, preferences, and the opened job text can now reach the configured Cloudflare Worker and Workers AI.

For a Werkstudent target, select **Working student (Werkstudent)** without Full-time; Part-time and Internship may remain selected. Only selecting both Working student and Full-time leaves those two branches ambiguous; neither selects a branch on its own. Changes survive reload and invalidate cached matching. Generic Part-time alone does not select student-specific thresholds. Enrollment and language proficiency still require separate candidate evidence.

For the reported CV lines, select **German B1 (CEFR)** and **English Fluent** to keep saved settings consistent with "Deutsch: B1" and "Englisch: Fließend". Do not invent an English CEFR level. Existing Basic/Professional settings are preserved until edited. Saving a changed level creates a new preference version and triggers fresh matching under saved consent.

## Check the scores

- Open a fully loaded LinkedIn job. Expand **Match criteria and requirements**.
- Every assessed row shows its returned score /5 and conversion /100. **3.7/5 must display 74/100**, not the former 50-point category.
- Open **How the 0–5 rubric works** to see all six ordered level descriptions.
- For a complete assessment, confirm the overall score is the weighted average. For example, scores 74, 84, 100, 80, 80 with default weights 40/30/20/5/5 give **82.8/100**.
- Unneeded rows show Excluded and no score. Active weights are normalized after excluding them.
- Unknown rows have no numeric score. The overall result remains provisional. The weighted average of assessed criteria is labeled incomplete, and the overall range varies unknown criteria without assigning them points.
- Mandatory and work preference conflict flags are separate from the score. A high grade must not hide a flag. Unresolved conflict checks are also listed.
- Confidence/level probabilities appear in copied diagnostics, not as hiring probabilities or replacements for ratings.

## Requirement regression and live inspection

- The supplied metamorphosis posting states English >= B2, German >= B1 for working students/>= B2 for full-time, Paderborn/hybrid, full-time/working-student information, and preferred Python/Git/architecture experience. These are active conditions, including preferred and conditional ones.
- Clear posting conditions with missing candidate comparison facts must remain Unknown. Empty preferences must not turn stated city/employment conditions into No active requirement.
- Copy matching diagnostics to compare **reportedStatus**, resolved **status**, positive requirement markers, and **issues**. Repaired or missing answers carry null confidence/probabilities instead of fabricated certainty; unresolved criteria have no grade.
- After deploying, run **scripts/debug-requirements-live.ps1** with PowerShell as described in the [backend guide](../backend/README.md#inspect-a-real-provider-trace). It captures a real model request, raw response, and parsed result in an ignored local report using this posting and a synthetic CV. Confirm full-time German B1 is compared with B2; preserve the separate working-student B1 alternative. Unknown target branches must not silently inherit the strictest threshold.
- The regression tests inject the reported erroneous exclusions and malformed/missing answers into the real Worker parser, then check the real extension UI. These local tests do not establish live model accuracy.

## Check consent, cache, and navigation

- Matching off: no API request. Refreshing the same result: Cached, with no second inference.
- Click **Re-analyze** to bypass the current result's cache and request a fresh assessment with saved consent. This uses AI quota. The button is hidden while analyzing. A successful result replaces that cache entry; a failed refresh does not restore the old score. Other jobs keep their cached results.
- Switch jobs quickly: old scores disappear and late responses cannot overwrite the new posting.
- Save changed preferences: old cache entries clear and the current job is reevaluated with consent.
- Replace the confirmed CV: consent resets; renew it only after reviewing the new text.
- Disable matching: results clear and further jobs send nothing. Delete all data: CV, preferences, key, consent, and cached results are removed.
- On a narrow window, the criterion table scrolls horizontally within its own region.

## Troubleshooting

Expand **Troubleshoot this assessment → Copy matching diagnostics**. The report includes status, numeric grades, level probabilities, and conflict choices, with no input text, credentials, or identifiers. Copying a cached result does not call AI.

When the model still refuses to assess a condition visible in the preview, capture the **actual extension request** rather than retesting the synthetic CLI example:

1. Open Job Lens settings and click **Capture next analysis** under **Troubleshoot an AI assessment**.
2. Within five minutes, return to the target LinkedIn job and click **Re-analyze**. The capture uses that fresh analysis, with the current saved CV/preferences and actual extracted posting, and bypasses its old cache. It does not add a second AI request.
3. Return to settings and copy **Work diagnostics**. They show the captured header, saved preferences, preferences passed to the model, raw work status/score/conflict fields and parser issues, without the CV or API key.
4. **Download full provider trace** only when you need the complete model request and raw response. This download includes your reviewed CV. The report contains no authorization headers. The private trace is restricted to trusted extension storage and never sent to the LinkedIn page or stored in the ordinary match cache. **Clear capture**, changing settings or deleting saved data removes the session trace; a downloaded file remains on your device.

Capture targets the next fresh inference, so avoid opening another job before re-analyzing the intended posting. Header lines are deduplicated and Apply/Save, Premium prompts and posting-time/applicant-count text are removed. The About-the-job body is preserved. Use the current clef-score-v9 Worker and the unchanged alignment-0-5-v1 rubric.

Version 0.6.11 changes the inference contract to **clef-score-v9**, invalidating earlier assessments. Both components must be updated. A returned model unknown is still unresolved; the parser never substitutes the earlier test's grades. Local prompt/pipeline tests do not establish live model accuracy.

Invalid key: correct it in settings. Invalid/outdated response: deploy the current Worker. Input too large: shorten reviewed text; full jobs are never silently cut. Usage limit: wait before retrying. Timeout: retry later; an accepted server inference may still consume quota. Unavailable posting: review the extracted preview and layout diagnostics.

## Tests

~~~sh
npm test
npm run test:backend
npm run test:browser
~~~

Local tests verify calculation, privacy, validation, real extension messaging, caching, stale requests, failures, and deletion using synthetic intercepted input. They do not call the real model.

After deployment:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario matching
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario languages
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario conditional
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-live.ps1 -Scenario language-settings
~~~

These consume real AI usage and prompt for the key with hidden input. The first suite sends one synthetic request; the second sends four CV-only language cases. The script checks versions, correlation, status/conflict expectations, and conversion. Inspect grade quality separately against the supplied evidence. If the five-per-minute limiter is enabled, pause between suites.

The conditional suite sends four requests using the supplied metamorphosis posting and a synthetic student CV. It checks Working student only (German B1 requirement), Full-time only (German B2 versus declared B1 conflict), multiple acceptable types (English remains comparable), and a control with no declared language levels (unknown). These are expectations to evaluate against the live provider, not hardcoded parser outcomes. Run suites separately if rate limited.

For the REWE case, verify the new trace contains **debug.work.request.state.postingHeader** with Cologne/onsite and **debug.work.request.state.workPreferences.location.remoteWork = hybrid**. That work request must have no resume. **debug.request/rawResponse** contain the separate professional/language call; **debug.work.request/rawResponse** contain the actual work call. If the full description offers hybrid as an alternative, preserve it when reviewing the result. A model-returned unknown remains unresolved even if its raw score is numeric. Re-analyze after updating both components; a passing mock test does not establish that the live model decision is fixed.
