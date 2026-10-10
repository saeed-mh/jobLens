# Job Lens privacy policy

Effective date: 10 October 2026. Applies to the Job Lens extension and its matching API maintained in the saeed-mh/jobLens repository.

## What Job Lens handles

Job Lens compares your reviewed resume and saved preferences with the LinkedIn job you open. It handles the resume text you confirm; language, city, work-arrangement and employment preferences; your personal testing API key; consent settings; the detected posting's ID, title, company and text; and AI assessments. Resume text can contain personal information if you leave it in the review field. Remove unnecessary names, contact details and other sensitive information before enabling matching.

PDF and DOCX extraction runs inside the extension. Original files are not uploaded or saved by Job Lens. Confirmed text, preferences, consent and the API key are saved in your browser profile using Chrome extension storage. This storage is restricted to trusted extension contexts, but Job Lens does not encrypt these saved values. Protect your device and browser profile; this is not an encrypted document vault.

## When information leaves your browser

Automatic matching is off by default. After you save a reviewed resume, configure the API key and explicitly consent, Job Lens sends the reviewed text, preferences and full detected job text to https://job-lens-api.saeedmohh10.workers.dev over HTTPS when you open a ready posting. Request identifiers and resume/preferences versions accompany the request. Your testing key is sent in the authorization header to that API; never enter a Cloudflare account token.

The API uses Cloudflare Workers AI and the Clef Flash model. A fresh analysis makes two model requests: one for qualifications and languages, and another for work preferences. The work-preference request includes posting text and work preferences, without resume text or language preferences. Model results return to the extension. Re-analyze makes another fresh analysis; cached results do not make another model request.

Cloudflare processes submitted information as our infrastructure provider. Its [Workers AI data-usage documentation](https://developers.cloudflare.com/workers-ai/platform/data-usage/) describes its handling of customer content and states that it does not use that content to train models without explicit consent. Cloudflare's applicable terms and privacy practices also govern its processing. We do not promise zero provider retention or zero infrastructure logging. The application does not create a server-side resume database or intentionally log resume text, authorization keys or full model responses. Deployment logging settings and provider operational records require separate review.

## Purpose and sharing

We use this information to provide the resume-to-job matching feature you choose and its user-requested troubleshooting controls. We do not sell personal data, use it for advertising, or use it to determine creditworthiness. Job Lens has no advertising or third-party analytics integration. It does not intentionally collect unrelated browsing history or private LinkedIn messages.

Transfers are limited to processing necessary for this feature, actions you explicitly request, and disclosures required by law or necessary to address security or abuse. We do not routinely have humans read submitted resume or posting content. If you voluntarily provide a troubleshooting report to support, you authorize review of that report for that purpose. Do not post private reports publicly. We do not use browsing or resume information for other unrelated purposes.

## Retention, diagnostics and deletion

Saved resume text, preferences, consent and the key remain in your browser profile until you change or delete them. Disable automatic analysis to stop new matching requests. Replacing the resume or changing the API key requires renewed consent. Disabling analysis does not erase previously saved settings.

Match results are cached in trusted session storage, with a six-hour expiry and up to 30 entries. Optional provider capture is off by default. If you arm it, the next fresh analysis can return the actual model requests and raw responses for troubleshooting. This report contains reviewed resume text, preferences and posting text, but excludes the API key. It remains in trusted session storage until cleared, settings change or the browser session ends. Arming expires after five minutes. Capturing adds no extra AI inference.

Use **Delete all saved data** in Settings to remove Job Lens's saved resume, preferences, API key, consent, session cache and captured report from this browser profile. A report you download becomes a separate file on your device; delete it yourself. Information already processed by Cloudflare and information you voluntarily send to support are outside this local deletion control.

## Support and changes

Contact the maintainer through [GitHub Issues](https://github.com/saeed-mh/jobLens/issues). Issues are public: do not include a CV, API key, identifying job-search details or a full provider trace. Request a suitable private contact method before sharing personal information or making a privacy request that requires it.

We will update this policy when data handling changes. Review the policy and consent notice before enabling matching after an update.
