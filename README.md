# Job Lens

A Chrome extension for managing your resume and job preferences while reviewing LinkedIn job postings.

## Features

- Upload text-based PDF or DOCX resumes, review the extracted text, and edit it before saving.
- Save preferred languages, proficiency levels, cities, work arrangements, and employment types, including working student (Werkstudent).
- Automatically detect the opened LinkedIn job, including its location and work-type header, and update the preview when switching postings.
- Show AI criterion scores on a 0–5 rubric, converted to 0–100 and combined with configurable weights in a sticky bar.
- Preserve preferred and conditional requirements, keep unknown or invalid answers unresolved, and flag mandatory qualification and work preference conflicts separately.
- Reuse cached results and discard outdated responses when jobs or saved information change.
- Store confirmed resume text and preferences locally, with consent and deletion controls.

Resume extraction happens locally. With consent, reviewed text, preferences, and the opened job description are sent to the Cloudflare backend for AI matching. Clef-flash's fractional rubric scores allow results such as 3.7/5 = 74/100. Incomplete assessments show a provisional range. Scanned PDFs require OCR, which is not supported yet.

## Installation

Requires Node.js 22.13+ and Chrome 125+.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the project's `dist` folder.
3. Follow the [backend setup](backend/README.md), then open Job Lens settings to upload your resume, enter your personal testing API key, and enable matching with consent.
4. Open a LinkedIn job to see its assessment. See [verification instructions](docs/VERIFY_MATCHING.md).

After updating the extension, reload it in `chrome://extensions` and refresh your LinkedIn tabs.
