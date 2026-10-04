import { validateResumeText } from "../resume/validation.js";

export const SETTINGS_KEY = "jobLens.settings.v1";
export const CONSENT_NOTICE_VERSION = "stage2-local-setup-v1";
export const PROFICIENCY_LEVELS = ["basic", "intermediate", "professional", "fluent", "native"] as const;
export const REMOTE_PREFERENCES = ["any", "remote", "hybrid", "onsite"] as const;
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "freelance", "internship", "temporary", "apprenticeship"] as const;
export type ProficiencyLevel = typeof PROFICIENCY_LEVELS[number];
export type RemotePreference = typeof REMOTE_PREFERENCES[number];
export type EmploymentType = typeof EMPLOYMENT_TYPES[number];

export interface Preferences {
  languages: { name: string; proficiency: ProficiencyLevel }[];
  acceptableCities: string[];
  remoteWork: RemotePreference;
  employmentTypes: EmploymentType[];
}

export interface Settings {
  schemaVersion: 1;
  revision: string;
  resume: { text: string; version: string; confirmedAt: string } | null;
  preferences: Preferences;
  preferencesVersion: string;
  consent: { automaticAnalysis: boolean; noticeVersion: string; updatedAt: string | null };
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1, revision: "initial", resume: null,
    preferences: { languages: [], acceptableCities: [], remoteWork: "any", employmentTypes: [] },
    preferencesVersion: "initial",
    consent: { automaticAnalysis: false, noticeVersion: CONSENT_NOTICE_VERSION, updatedAt: null },
  };
}

export function validatePreferences(preferences: Preferences): Preferences {
  if (!preferences || !Array.isArray(preferences.languages) || !Array.isArray(preferences.acceptableCities)
    || !Array.isArray(preferences.employmentTypes)) throw new Error("Invalid preferences.");
  if (preferences.languages.length > 20 || preferences.acceptableCities.length > 50) {
    throw new Error("Use at most 20 languages and 50 cities.");
  }
  const languages = preferences.languages.map((language) => {
    if (!language || typeof language.name !== "string" || !PROFICIENCY_LEVELS.includes(language.proficiency)) {
      throw new Error("Choose a proficiency level for each language.");
    }
    const name = language.name.trim();
    if (!name || name.length > 80) throw new Error("Each language needs a name of 1–80 characters, or remove the empty row.");
    return { name, proficiency: language.proficiency };
  });
  if (new Set(languages.map((language) => language.name.toLowerCase())).size !== languages.length) {
    throw new Error("Each language should appear only once.");
  }
  const acceptableCities = preferences.acceptableCities.map((city) => {
    if (typeof city !== "string" || !city.trim() || city.trim().length > 120) {
      throw new Error("Each city must contain 1–120 characters.");
    }
    return city.trim();
  });
  if (!REMOTE_PREFERENCES.includes(preferences.remoteWork)
    || preferences.employmentTypes.some((type) => !EMPLOYMENT_TYPES.includes(type))) {
    throw new Error("Choose valid remote-work and employment preferences.");
  }
  return {
    languages, acceptableCities: [...new Set(acceptableCities)],
    remoteWork: preferences.remoteWork, employmentTypes: [...new Set(preferences.employmentTypes)],
  };
}

export function parseSettings(value: unknown): Settings {
  if (value === undefined) return defaultSettings();
  if (typeof value !== "object" || value === null) throw new Error("Saved settings are invalid.");
  const settings = value as Settings;
  if (settings.schemaVersion !== 1 || typeof settings.revision !== "string"
    || typeof settings.preferencesVersion !== "string" || !settings.consent
    || typeof settings.consent.automaticAnalysis !== "boolean" || typeof settings.consent.noticeVersion !== "string"
    || (settings.consent.updatedAt !== null && typeof settings.consent.updatedAt !== "string")) {
    throw new Error("Saved settings are invalid or use an unsupported version.");
  }
  if (settings.resume !== null) {
    if (!settings.resume || typeof settings.resume.text !== "string"
      || typeof settings.resume.version !== "string" || typeof settings.resume.confirmedAt !== "string") {
      throw new Error("The saved resume is invalid.");
    }
    settings.resume.text = validateResumeText(settings.resume.text);
  }
  settings.preferences = validatePreferences(settings.preferences);
  if (!settings.resume || settings.consent.noticeVersion !== CONSENT_NOTICE_VERSION) {
    settings.consent.automaticAnalysis = false;
  }
  return settings;
}

export function confirmResume(settings: Settings, text: string): Settings {
  const normalized = validateResumeText(text);
  const changed = settings.resume?.text !== normalized;
  return {
    ...settings, revision: crypto.randomUUID(),
    resume: changed ? { text: normalized, version: crypto.randomUUID(), confirmedAt: new Date().toISOString() } : settings.resume,
    consent: changed ? { automaticAnalysis: false, noticeVersion: CONSENT_NOTICE_VERSION, updatedAt: null } : settings.consent,
  };
}

export function updatePreferences(settings: Settings, preferences: Preferences, automaticAnalysis: boolean): Settings {
  const validated = validatePreferences(preferences);
  if (automaticAnalysis && !settings.resume) throw new Error("Confirm and save a resume before enabling automatic analysis.");
  return {
    ...settings, revision: crypto.randomUUID(), preferences: validated,
    preferencesVersion: JSON.stringify(validated) === JSON.stringify(settings.preferences)
      ? settings.preferencesVersion : crypto.randomUUID(),
    consent: { automaticAnalysis, noticeVersion: CONSENT_NOTICE_VERSION, updatedAt: new Date().toISOString() },
  };
}

export function withoutResume(settings: Settings): Settings {
  return { ...settings, revision: crypto.randomUUID(), resume: null,
    consent: { automaticAnalysis: false, noticeVersion: CONSENT_NOTICE_VERSION, updatedAt: null } };
}
