import { readResume } from "../resume/upload.js";
import { normalizeText, validateResumeText, ResumeError } from "../resume/validation.js";
import { confirmResume, defaultSettings, PROFICIENCY_LEVELS, SETTINGS_KEY, updatePreferences, withoutResume,
  type Settings, type Preferences, type ProficiencyLevel, type RemotePreference, type EmploymentType } from "../shared/settings.js";
import { deleteAllSettings, readSettings, saveSettings } from "../shared/storage.js";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing settings element: ${id}`);
  return result as T;
}

const controls = element<HTMLFieldSetElement>("settings-controls");
const pageMessage = element<HTMLParagraphElement>("page-message");
const reloadButton = element<HTMLButtonElement>("reload-settings");
const fileInput = element<HTMLInputElement>("resume-file");
const uploadStatus = element<HTMLParagraphElement>("upload-status");
const uploadWarning = element<HTMLParagraphElement>("upload-warning");
const review = element<HTMLDivElement>("resume-review");
const preview = element<HTMLTextAreaElement>("resume-preview");
const confirmation = element<HTMLInputElement>("confirm-resume");
const saveResumeButton = element<HTMLButtonElement>("save-resume");
const deleteResumeButton = element<HTMLButtonElement>("delete-resume");
const deleteAllButton = element<HTMLButtonElement>("delete-all");
const automaticAnalysis = element<HTMLInputElement>("automatic-analysis");
const disableAnalysisButton = element<HTMLButtonElement>("disable-analysis");
const languageRows = element<HTMLDivElement>("language-rows");
let saved = defaultSettings();
let loaded = false;
let busy = false;
let extracting = false;
let stale = false;
let writing = false;
let controller: AbortController | null = null;
let languageIndex = 0;

function message(text: string, error = false): void {
  pageMessage.textContent = text;
  pageMessage.className = error ? "error" : "status";
  pageMessage.setAttribute("role", error ? "alert" : "status");
}

function resumeIsDraft(): boolean {
  return !review.hidden && normalizeText(preview.value) !== (saved.resume?.text ?? "");
}

function syncControls(): void {
  controls.disabled = !loaded || busy || stale;
  deleteAllButton.disabled = busy || extracting;
  deleteResumeButton.disabled = !saved.resume || extracting;
  saveResumeButton.disabled = extracting || !confirmation.checked || Boolean(review.hidden);
  automaticAnalysis.disabled = !saved.resume || resumeIsDraft() || extracting;
  element<HTMLButtonElement>("save-preferences").disabled = extracting || resumeIsDraft();
  disableAnalysisButton.disabled = !saved.consent.automaticAnalysis;
  element<HTMLParagraphElement>("text-count").textContent = `${preview.value.length.toLocaleString()} / 100,000 characters`;
  element<HTMLParagraphElement>("saved-resume-status").textContent = saved.resume
    ? `Confirmed resume saved locally (${saved.resume.text.length.toLocaleString()} characters). Upload another file to replace it.`
    : "No confirmed resume saved.";
  element<HTMLParagraphElement>("consent-status").textContent = resumeIsDraft()
    ? "Confirm or discard the resume draft before saving preferences or consent."
    : saved.consent.automaticAnalysis
      ? "Saved preference: on. Matching is not connected yet; stage 2 sends nothing."
      : "Saved preference: off. Confirm a resume first, then opt in and save if you wish.";
}

function addLanguage(name = "", proficiency: ProficiencyLevel = "professional"): void {
  if (languageRows.children.length >= 20) { message("Use at most 20 languages.", true); return; }
  const row = document.createElement("div");
  row.className = "language-row";
  const suffix = languageIndex++;
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Language";
  const input = document.createElement("input");
  input.type = "text"; input.maxLength = 80; input.value = name; input.placeholder = "e.g. German";
  input.id = `language-name-${suffix}`; input.className = "language-name";
  nameLabel.htmlFor = input.id;
  const levelLabel = document.createElement("label");
  levelLabel.textContent = "Proficiency";
  const select = document.createElement("select");
  select.id = `language-level-${suffix}`; select.className = "language-level"; levelLabel.htmlFor = select.id;
  for (const level of PROFICIENCY_LEVELS) {
    const option = document.createElement("option");
    option.value = level; option.textContent = level[0].toUpperCase() + level.slice(1); select.append(option);
  }
  select.value = proficiency;
  const remove = document.createElement("button");
  remove.type = "button"; remove.className = "secondary"; remove.textContent = "Remove";
  remove.setAttribute("aria-label", "Remove language");
  remove.addEventListener("click", () => { row.remove(); message("Unsaved preference changes. Click Save preferences & consent."); });
  const nameGroup = document.createElement("div"); nameGroup.append(nameLabel, input);
  const levelGroup = document.createElement("div"); levelGroup.append(levelLabel, select);
  row.append(nameGroup, levelGroup, remove); languageRows.append(row);
}

function renderSaved(): void {
  controller?.abort(); controller = null; extracting = false;
  fileInput.value = "";
  review.hidden = !saved.resume;
  preview.value = saved.resume?.text ?? "";
  confirmation.checked = false;
  uploadWarning.hidden = true;
  uploadStatus.className = "";
  uploadStatus.textContent = saved.resume ? "Showing your saved professional text." : "No file selected.";
  languageRows.replaceChildren();
  for (const language of saved.preferences.languages) addLanguage(language.name, language.proficiency);
  element<HTMLTextAreaElement>("acceptable-cities").value = saved.preferences.acceptableCities.join("\n");
  element<HTMLSelectElement>("remote-work").value = saved.preferences.remoteWork;
  document.querySelectorAll<HTMLInputElement>('input[name="employment"]').forEach((checkbox) => {
    checkbox.checked = saved.preferences.employmentTypes.includes(checkbox.value as EmploymentType);
  });
  automaticAnalysis.checked = saved.consent.automaticAnalysis;
  syncControls();
}

async function load(): Promise<void> {
  try {
    saved = await readSettings(); loaded = true; stale = false;
    reloadButton.hidden = true; renderSaved(); message("Settings loaded. Changes are saved only when you confirm them.");
  } catch {
    loaded = false; syncControls();
    message("Could not read saved settings. Reload the extension and try again. If saved data is damaged, use Delete all saved data to reset it.", true);
    reloadButton.hidden = false;
  }
}

async function persist(next: Settings, success: string): Promise<boolean> {
  if (!loaded || busy || stale) return false;
  busy = true; writing = true; syncControls();
  try {
    await saveSettings(next, saved.revision);
    saved = next; message(success); return true;
  } catch (error) {
    message(error instanceof Error ? error.message : "Could not save settings. Try again.", true);
    return false;
  } finally { busy = false; writing = false; syncControls(); }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  controller?.abort();
  const current = new AbortController(); controller = current;
  extracting = true; confirmation.checked = false;
  automaticAnalysis.checked = false;
  uploadWarning.hidden = true; uploadStatus.className = "";
  uploadStatus.textContent = `Reading ${file.name} locally…`;
  syncControls();
  try {
    const result = await readResume(file, current.signal);
    if (current !== controller || current.signal.aborted) return;
    preview.value = result.text; review.hidden = false;
    uploadWarning.textContent = result.warnings.join(" "); uploadWarning.hidden = !result.warnings.length;
    uploadStatus.textContent = "Text extracted. Review and confirm it before saving; your previous saved resume has not changed.";
    message("Resume draft ready. Review it, then confirm and save.");
  } catch (error) {
    if (current !== controller || current.signal.aborted) return;
    automaticAnalysis.checked = resumeIsDraft() ? false : saved.consent.automaticAnalysis;
    uploadStatus.className = "error";
    uploadStatus.textContent = error instanceof ResumeError ? error.message : "Could not read this file. Try another PDF or DOCX.";
    message("Upload was not saved. Your previously confirmed resume, if any, is unchanged.", true);
  } finally {
    if (current === controller) { extracting = false; fileInput.value = ""; syncControls(); }
  }
});

preview.addEventListener("input", () => {
  confirmation.checked = false; automaticAnalysis.checked = false;
  message("Unsaved resume changes. Review and confirm again before saving."); syncControls();
});
confirmation.addEventListener("change", syncControls);

saveResumeButton.addEventListener("click", async () => {
  if (!confirmation.checked || extracting) return;
  try {
    const next = confirmResume(saved, validateResumeText(preview.value));
    if (await persist(next, "Resume confirmed and saved locally. A changed resume resets the automatic analysis preference; opt in again if you wish.")) {
      preview.value = saved.resume!.text; confirmation.checked = false;
      automaticAnalysis.checked = saved.consent.automaticAnalysis;
      uploadStatus.textContent = "Showing your confirmed professional text."; syncControls();
    }
  } catch (error) { message(error instanceof Error ? error.message : "The resume text is invalid.", true); }
});

element<HTMLButtonElement>("discard-draft").addEventListener("click", () => {
  controller?.abort(); controller = null; extracting = false;
  preview.value = saved.resume?.text ?? ""; review.hidden = !saved.resume;
  confirmation.checked = false; automaticAnalysis.checked = saved.consent.automaticAnalysis;
  uploadWarning.hidden = true; uploadStatus.className = "";
  uploadStatus.textContent = saved.resume ? "Showing your saved professional text." : "No file selected.";
  message("Unsaved resume changes discarded."); syncControls();
});

deleteResumeButton.addEventListener("click", async () => {
  if (!window.confirm("Delete the saved resume and disable automatic analysis? Your saved preferences will remain.")) return;
  if (await persist(withoutResume(saved), "Saved resume deleted. Automatic analysis preference is off.")) renderSaved();
});

element<HTMLButtonElement>("add-language").addEventListener("click", () => {
  addLanguage(); message("Unsaved preference changes. Click Save preferences & consent.");
});

function readPreferences(): Preferences {
  return {
    languages: Array.from(languageRows.children).map((row) => ({
      name: row.querySelector<HTMLInputElement>(".language-name")!.value,
      proficiency: row.querySelector<HTMLSelectElement>(".language-level")!.value as ProficiencyLevel,
    })),
    acceptableCities: element<HTMLTextAreaElement>("acceptable-cities").value.split("\n").map((city) => city.trim()).filter(Boolean),
    remoteWork: element<HTMLSelectElement>("remote-work").value as RemotePreference,
    employmentTypes: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="employment"]:checked')).map((input) => input.value as EmploymentType),
  };
}

element<HTMLButtonElement>("save-preferences").addEventListener("click", async () => {
  if (resumeIsDraft() || extracting) return;
  try {
    await persist(updatePreferences(saved, readPreferences(), automaticAnalysis.checked), "Preferences and consent saved locally. No data has been sent.");
  } catch (error) { message(error instanceof Error ? error.message : "Check your preferences.", true); }
});

disableAnalysisButton.addEventListener("click", async () => {
  if (await persist(updatePreferences(saved, saved.preferences, false), "Automatic analysis preference disabled.")) {
    automaticAnalysis.checked = false; syncControls();
  }
});

controls.addEventListener("change", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest(".language-row") || target.id === "acceptable-cities" || target.id === "remote-work"
    || target.id === "automatic-analysis" || target.getAttribute("name") === "employment") {
    message("Unsaved preference changes. Click Save preferences & consent.");
  }
});

deleteAllButton.addEventListener("click", async () => {
  if (!window.confirm("Delete all saved Job Lens data in this browser profile?")) return;
  controller?.abort(); controller = null; extracting = false;
  busy = true; writing = true; syncControls();
  try {
    await deleteAllSettings(); saved = defaultSettings(); loaded = true; stale = false;
    reloadButton.hidden = true; renderSaved(); message("All saved Job Lens data deleted. Automatic analysis preference is off.");
  } catch { message("Could not delete saved data. Reload the extension and try again.", true); }
  finally { busy = false; writing = false; syncControls(); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY] || writing) return;
  controller?.abort(); controller = null; extracting = false;
  // Never allow an old draft to silently restore data deleted in another tab.
  stale = true; preview.value = ""; review.hidden = true; confirmation.checked = false;
  automaticAnalysis.checked = false; reloadButton.hidden = false;
  message("Saved settings changed in another tab. Reload saved settings before editing or saving.", true); syncControls();
});

reloadButton.addEventListener("click", () => { void load(); });
window.addEventListener("pagehide", () => controller?.abort());
void load();
