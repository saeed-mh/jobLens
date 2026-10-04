import type { Dimension } from "../../src/shared/analysis.js";
import type { AnalysisRequest } from "./contract.js";

export interface RequirementEvidence { present: boolean; preferred: boolean; conditional: boolean }

// Positive markers prevent a model from excluding plainly stated conditions.
// A non-match never proves absence, and these markers never assign a grade.
export function requirementEvidence(input: AnalysisRequest): Record<Dimension, RequirementEvidence> {
  const text = `${input.job.title}\n${input.job.description}`;
  const patterns: Record<Dimension, RegExp> = {
    skills: /\b(?:python|git|sql|javascript|typescript|softwarearchitektur\w*|architecture|SOLID|DRY|KISS|YAGNI|skills|kenntnisse|fähigkeiten)\b/giu,
    experience: /\b(?:erfahrung\w*|experience|seniority|years?|jahre\w*|studium|degree|eingeschrieben)\b/giu,
    language: /(?:englisch|english|deutsch|german|französisch|french|spanisch|spanish)[^\n.!?]{0,100}(?:\b[ABC][12]\b|fluent|fließend|native|muttersprache|sehr gut|wort und schrift)|\b(?:language|sprach)(?:\s+requirements|kenntnisse|anforderungen)/giu,
    location: /\b(?:hybrid|remote|on[- ]?site|homeoffice|home office|vor ort|standorte?|arbeitsort|work arrangement|work location|job location|based in|office in)\b/giu,
    employment: /\b(?:full[- ]?time|part[- ]?time|vollzeit|teilzeit|werkstudent\w*|praktik\w*|internship|freelance|contract|befristet|unbefristet|employment type)\b/giu,
  };
  const result = {} as Record<Dimension, RequirementEvidence>;
  for (const dimension of Object.keys(patterns) as Dimension[]) {
    const matches = [...text.matchAll(patterns[dimension])];
    // Preserve nearby qualifiers, including headings above bullet lists.
    const contexts = matches.map(match => text.slice(Math.max(0, match.index! - 200), match.index! + match[0].length + 150));
    const activePreference = dimension === "location"
      ? input.preferences.acceptableCities.length > 0 || input.preferences.remoteWork !== "any"
      : dimension === "employment" && input.preferences.employmentTypes.length > 0;
    result[dimension] = {
      present: matches.length > 0 || activePreference,
      preferred: contexts.some(context => /vorteilhaft|wünschenswert|preferred|nice.to.have|ideally|desirable/iu.test(context)),
      conditional: contexts.some(context => /werkstudent|vollzeit|full.time|\bif\b|\bals\b|\bfalls\b|\bwhen\b/iu.test(context)),
    };
  }
  return result;
}
