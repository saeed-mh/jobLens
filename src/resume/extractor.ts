import mammoth from "mammoth";
import { getDocument, PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { MAX_PDF_PAGES, MAX_TEXT_LENGTH, ResumeError, validateSignature, validateResumeText, type ResumeFormat } from "./validation.js";

export interface ExtractionRequest {
  format: ResumeFormat;
  data: ArrayBuffer;
  pdfWorkerUrl: string;
  pdfAssetsUrl: string;
}

export interface ExtractionResult {
  text: string;
  warnings: string[];
}

export type ExtractionResponse =
  | { ok: true; result: ExtractionResult }
  | { ok: false; message: string };

export async function extractResume(request: ExtractionRequest): Promise<ExtractionResult> {
  validateSignature(new Uint8Array(request.data), request.format);
  if (request.format === "docx") {
    // Plain text only. Mammoth's default denies external file access.
    const result = await mammoth.extractRawText({ arrayBuffer: request.data });
    if (result.messages.some((message) => message.type === "error")) {
      throw new ResumeError("Parts of this DOCX could not be read. Export a new copy and try again.");
    }
    return {
      text: validateResumeText(result.value),
      warnings: result.messages.length ? ["Some DOCX elements were not supported. Check the preview against your original file."] : [],
    };
  }

  // Supply a local worker port explicitly to avoid PDF.js's blob/CDN fallback.
  const port = new Worker(request.pdfWorkerUrl, { type: "module" });
  const worker = PDFWorker.create({ port, verbosity: 0 });
  const task = getDocument({
    data: new Uint8Array(request.data), worker,
    cMapUrl: `${request.pdfAssetsUrl}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${request.pdfAssetsUrl}standard_fonts/`,
    useWorkerFetch: true, useWasm: false, useSystemFonts: false,
    disableFontFace: true, stopAtErrors: true, enableXfa: false, verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new ResumeError("This PDF has too many pages. The limit is 30 pages.");
    }
    const pages: string[] = [];
    let totalLength = 0;
    let emptyPages = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.filter((item): item is TextItem => "str" in item)
        .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`).join("").trim();
      if (!pageText) emptyPages++;
      totalLength += pageText.length;
      if (totalLength > MAX_TEXT_LENGTH) throw new ResumeError("The PDF contains too much text. Choose a shorter resume.");
      pages.push(pageText);
      page.cleanup();
    }
    return {
      text: validateResumeText(pages.join("\n\n")),
      warnings: emptyPages ? ["Some pages had no extractable text and may contain scanned images. Check that no resume content is missing; those pages need OCR."] : [],
    };
  } finally {
    try { await task.destroy(); } finally { worker.destroy(); port.terminate(); }
  }
}

export function extractionErrorMessage(error: unknown): string {
  if (error instanceof ResumeError) return error.message;
  if (error instanceof Error && error.name === "PasswordException") {
    return "Password-protected PDFs are not supported. Upload an unlocked copy.";
  }
  return "This file could not be read. It may be corrupted, encrypted, or not a valid PDF/DOCX. Export a fresh copy and try again.";
}
