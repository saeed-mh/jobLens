# Job Lens

A Chrome extension for managing your resume and job preferences while reviewing LinkedIn job postings.

## Features

- Upload text-based PDF or DOCX resumes, review the extracted text, and edit it before saving.
- Save preferred languages, proficiency levels, cities, work arrangements, and employment types.
- Automatically detect the opened LinkedIn job and update its description preview when switching postings.
- Keep the job status and description preview accessible through a sticky bar while scrolling.
- Store confirmed resume text and preferences locally, with controls to delete saved data.

Resume processing happens locally. This version does not send resume or job text to a backend or calculate AI match scores. Scanned PDFs require OCR, which is not supported yet.

## Installation

Requires Node.js 22.13+ and Chrome 125+.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the project's `dist` folder.
3. Open Job Lens settings to upload your resume and save your preferences, then open a LinkedIn job to view its description.

After updating the extension, reload it in `chrome://extensions` and refresh your LinkedIn tabs.
