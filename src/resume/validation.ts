export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 100_000;
export const MIN_TEXT_LENGTH = 40;
export const MAX_PDF_PAGES = 30;
export const EXTRACTION_TIMEOUT_MS = 30_000;
export type ResumeFormat = "pdf" | "docx";

export class ResumeError extends Error {}

export function validateFile(file: Pick<File, "name" | "type" | "size">): ResumeFormat {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx") {
    throw new ResumeError("Choose a text-based PDF or a DOCX file. DOC and image files are not supported.");
  }
  if (file.size === 0) throw new ResumeError("This file is empty. Choose another file.");
  if (file.size > MAX_FILE_BYTES) throw new ResumeError("The file is too large. The limit is 5 MB.");
  const expectedType = extension === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // Some operating systems report an empty or generic MIME type.
  if (file.type && file.type !== "application/octet-stream" && file.type !== expectedType) {
    throw new ResumeError("The file type does not match its extension. Export a new PDF or DOCX file.");
  }
  return extension;
}

export function validateSignature(data: Uint8Array, format: ResumeFormat): void {
  const valid = format === "pdf"
    ? new TextDecoder().decode(data.subarray(0, 1024)).includes("%PDF-")
    : data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (!valid) throw new ResumeError("The file content is not a valid PDF or DOCX. Renaming a file does not convert it.");
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
    .replace(/[\t ]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

export function validateResumeText(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new ResumeError("The extracted text is too long. The limit is 100,000 characters; choose a shorter document.");
  }
  if (normalized.replace(/\s/g, "").length < MIN_TEXT_LENGTH || !/[\p{L}\p{N}]/u.test(normalized)) {
    throw new ResumeError("There is too little extractable text. Scanned PDFs and image-only documents need OCR, which is not available in this version.");
  }
  return normalized;
}
