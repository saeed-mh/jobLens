import { readSettings } from "../shared/storage.js";

const settingsButton = document.querySelector<HTMLButtonElement>("#open-settings");
const versionLabel = document.querySelector<HTMLSpanElement>("#extension-version");
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message");

if (!settingsButton || !versionLabel || !errorMessage) {
  throw new Error("Required popup elements are missing.");
}

versionLabel.textContent = chrome.runtime.getManifest().version;

async function updateStatus(): Promise<void> {
  const resumeStatus = document.getElementById("resume-status");
  const analysisStatus = document.getElementById("analysis-status");
  if (!resumeStatus || !analysisStatus) return;
  try {
    const settings = await readSettings();
    resumeStatus.textContent = settings.resume ? "Confirmed resume saved on this device." : "Upload and confirm your resume in settings.";
    analysisStatus.textContent = settings.consent.automaticAnalysis
      ? "Automatic AI matching is on. Open a LinkedIn job to see the result."
      : "Automatic AI matching is off. Configure your API key and consent in settings.";
  } catch { resumeStatus.textContent = "Could not read settings. Open settings to retry or reset saved data."; }
}

chrome.storage.onChanged.addListener(() => { void updateStatus(); });
void updateStatus();

settingsButton.addEventListener("click", async () => {
  errorMessage.hidden = true;

  try {
    await chrome.runtime.openOptionsPage();
  } catch {
    errorMessage.textContent =
      "Could not open settings. Reload Job Lens in chrome://extensions and try again.";
    errorMessage.hidden = false;
  }
});
