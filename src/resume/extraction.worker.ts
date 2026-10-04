import { extractResume, extractionErrorMessage, type ExtractionRequest, type ExtractionResponse } from "./extractor.js";

self.addEventListener("message", async (event: MessageEvent<ExtractionRequest>) => {
  let response: ExtractionResponse;
  try {
    response = { ok: true, result: await extractResume(event.data) };
  } catch (error) {
    // Do not expose parser messages that might contain document text.
    response = { ok: false, message: extractionErrorMessage(error) };
  }
  self.postMessage(response);
});
