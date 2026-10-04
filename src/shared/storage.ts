import { SETTINGS_KEY, parseSettings, type Settings } from "./settings.js";
import { CACHE_KEY } from "./analysis.js";
import { PROVIDER_TRACE_KEY } from "./provider-trace.js";

export async function readSettings(): Promise<Settings> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return parseSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings, expectedRevision: string): Promise<void> {
  // Serialize saves and deletes across options tabs before checking the revision.
  await navigator.locks.request("jobLens.settings", async () => {
    const current = await readSettings();
    if (current.revision !== expectedRevision) {
      throw new Error("Settings changed in another tab. Reload this page before saving.");
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: parseSettings(settings) });
  });
}

export async function deleteAllSettings(): Promise<void> {
  await navigator.locks.request("jobLens.settings", async () => {
    await chrome.storage.local.remove(SETTINGS_KEY);
    await chrome.storage.session.remove([CACHE_KEY, PROVIDER_TRACE_KEY]);
  });
}
