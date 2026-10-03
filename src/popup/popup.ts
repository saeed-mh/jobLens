const settingsButton = document.querySelector<HTMLButtonElement>("#open-settings");
const versionLabel = document.querySelector<HTMLSpanElement>("#extension-version");
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message");

if (!settingsButton || !versionLabel || !errorMessage) {
  throw new Error("Required popup elements are missing.");
}

versionLabel.textContent = chrome.runtime.getManifest().version;

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

export {};
