import { EXTRACTION_TIMEOUT_MS, ResumeError, validateFile } from "./validation.js";
import type { ExtractionRequest, ExtractionResponse, ExtractionResult } from "./extractor.js";

export async function readResume(file: File, signal: AbortSignal): Promise<ExtractionResult> {
  const format = validateFile(file);
  if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
  const data = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL("resume/extraction.worker.js"), { type: "module" });
    const finish = (response?: ExtractionResponse, error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else if (response?.ok) resolve(response.result);
      else reject(new ResumeError(response?.message ?? "The extraction worker returned an invalid response."));
    };
    const abort = () => finish(undefined, new DOMException("Upload cancelled", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new ResumeError("Reading this file took too long. Try a smaller file or export a new copy.")), EXTRACTION_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<ExtractionResponse>) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(undefined, new ResumeError("The file reader could not start. Rebuild and reload the extension, then try again."));
    };
    worker.onmessageerror = () => finish(undefined, new ResumeError("The file reader returned an unreadable response."));
    const request: ExtractionRequest = {
      format, data,
      pdfWorkerUrl: chrome.runtime.getURL("vendor/pdf/pdf.worker.min.mjs"),
      pdfAssetsUrl: chrome.runtime.getURL("vendor/pdf/"),
    };
    worker.postMessage(request, [data]);
  });
}
