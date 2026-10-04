import { BAR_ID, MODERN_LAYOUT, SELECTORS } from "./selectors.js";

export interface JobRoute {
  isJobsPage: boolean;
  jobId: string | null;
}

export interface JobCandidate {
  jobId: string | null;
  domJobId: string | null;
  title: string;
  company: string;
  description: string;
  postingDetails: string;
  root: HTMLElement;
  descriptionElement: HTMLElement | null;
  expandButton: HTMLElement | null;
  collapsed: boolean;
  loading: boolean;
}

export function jobIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    if (url.hostname !== "www.linkedin.com" || !url.pathname.startsWith("/jobs/")) return null;
    const selected = url.searchParams.get("currentJobId");
    if (selected && /^\d+$/.test(selected)) return selected;
    return url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1] ?? null;
  } catch { return null; }
}

export function currentRoute(value: string): JobRoute {
  try {
    const url = new URL(value);
    return { isJobsPage: url.hostname === "www.linkedin.com" && /^\/jobs(?:\/|$)/.test(url.pathname), jobId: jobIdFromUrl(value) };
  } catch { return { isJobsPage: false, jobId: null }; }
}

export function isVisible(element: HTMLElement): boolean {
  return element.isConnected && !element.closest('[hidden], [aria-hidden="true"]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function allowed(element: HTMLElement): boolean {
  return isVisible(element) && !element.closest(SELECTORS.excluded.join(",")) && !element.closest(`#${BAR_ID}`);
}

function first(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (allowed(element)) return element;
    }
  }
  return null;
}

function normalize(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Preserve paragraph/list boundaries without copying HTML or UI controls.
function readText(element: HTMLElement, excludedElements: ReadonlySet<HTMLElement>, header = false): string {
  const blockTags = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "SECTION"]);
  let stopped = false;
  function walk(node: Node): string {
    if (stopped) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    // The modern column's first detail slot ends the header. Never continue
    // into people/company/recommendation sections, even if nested in wrappers.
    if (header && node.matches(`${MODERN_LAYOUT.slots}, ${MODERN_LAYOUT.people}`)) { stopped = true; return ""; }
    if (excludedElements.has(node) || node.matches(`script, style, nav, [hidden], [aria-hidden="true"], #${BAR_ID}, ${SELECTORS.excluded.join(",")}`)) return "";
    if (node.tagName === "BR") return "\n";
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return "";
    if (node.matches('button, [role="button"]')) {
      // LinkedIn also renders job attributes as buttons. Accept only literal
      // attribute labels, never Apply/Save or personalized preference text.
      const label = normalize(node.innerText).split("\n")[0];
      return header && /^(?:hybrid|remote|on[- ]?site|vor ort|homeoffice|full[- ]?time|part[- ]?time|vollzeit|teilzeit|working student(?: \(werkstudent\))?|werkstudent|internship|praktikum|contract|freelance|temporary|apprenticeship)$/iu.test(label) ? `\n${label}\n` : "";
    }
    const text = Array.from(node.childNodes).map(walk).join("");
    return blockTags.has(node.tagName) ? `\n${text}\n` : text;
  }
  return normalize(walk(element));
}

export function descriptionText(element: HTMLElement, excludedElements: ReadonlySet<HTMLElement> = new Set()): string {
  return readText(element, excludedElements);
}

function classicPostingDetails(root: HTMLElement, description: HTMLElement | null): string {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(SELECTORS.headerDetails.join(",")))
    .filter(element => allowed(element) && !description?.contains(element))
    .filter((element, _, all) => !all.some(other => other !== element && other.contains(element)));
  return [...new Set(elements.map(element => readText(element, new Set(), true)).filter(Boolean))].join("\n");
}

export function cleanPostingDetails(text: string, title: string): string {
  const seen = new Set<string>(), details: string[] = [];
  for (const source of normalize(text).split("\n")) {
    let line = source.trim();
    if (!line || line.toLocaleLowerCase() === normalize(title).toLocaleLowerCase()
      || /^(?:apply|save|saved|bewerben|speichern)$/iu.test(line)
      || /^(?:promoted by hirer|responses managed off linkedin|get ai-powered advice|see how you compare|access exclusive applicant insights|reactivate premium|determine your fit|show match details|tailor my resume|help me stand out)\b/iu.test(line)) continue;
    // These separators belong to LinkedIn's company/location and posting-time
    // rows. Keep the displayed location, without applicant counts or timestamps.
    const inlineLocation = line.split(/\s+•\s+/).at(-1)!;
    if (inlineLocation.includes(",")) line = inlineLocation;
    line = line.split(/\s+·\s+/)[0].trim();
    const key = line.toLocaleLowerCase();
    if (line && !seen.has(key)) { seen.add(key); details.push(line); }
  }
  return details.join("\n");
}

// The preview and API use exactly the same text. Keep the body separate in the
// readiness tracker: a new header cannot establish that the body has changed.
export function jobText(candidate: Pick<JobCandidate, "description" | "postingDetails">): string {
  return candidate.postingDetails
    ? `LinkedIn posting details:\n${candidate.postingDetails}\n\nAbout the job:\n${candidate.description}`
    : candidate.description;
}

function scopedJobId(root: HTMLElement, title: HTMLElement | null): string | null {
  const link = title?.matches("a[href]") ? title : title?.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]');
  const linkedId = link ? jobIdFromUrl(link.getAttribute("href") ?? "") : null;
  if (linkedId) return linkedId;
  // Read identity from the detail header/root, never from recommendation cards.
  let current: HTMLElement | null = title ?? root;
  while (current && root.contains(current)) {
    const explicit = current.getAttribute("data-job-id");
    if (explicit && /^\d+$/.test(explicit)) return explicit;
    const urn = current.getAttribute("data-entity-urn");
    const urnId = urn?.match(/^urn:li:(?:fsd_)?jobPosting:(\d+)$/)?.[1];
    if (urnId) return urnId;
    if (current === root) break;
    current = current.parentElement;
  }
  return null;
}

function expandButton(root: HTMLElement): HTMLButtonElement | null {
  for (const selector of SELECTORS.expandButtons) {
    for (const button of root.querySelectorAll<HTMLButtonElement>(selector)) {
      if (!allowed(button) || button.disabled || button.getAttribute("aria-expanded") === "true") continue;
      const label = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
      if (button.getAttribute("aria-expanded") === "false"
        || button.matches(".show-more-less-html__button--more")
        || /show more|see more|mehr anzeigen|mehr ansehen|نمایش بیشتر/i.test(label)) return button;
    }
  }
  return null;
}

function descriptionIsClipped(description: HTMLElement | null, root: HTMLElement): boolean {
  let element = description;
  while (element && element !== root) {
    const style = getComputedStyle(element);
    const lineClamp = style.getPropertyValue("-webkit-line-clamp");
    if (element.scrollHeight > element.clientHeight + 4
      && (["hidden", "clip"].includes(style.overflowY) || (lineClamp && lineClamp !== "none"))) return true;
    element = element.parentElement;
  }
  return false;
}

function modernCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];
  for (const section of document.querySelectorAll<HTMLElement>(MODERN_LAYOUT.descriptions)) {
    const domJobId = section.id.match(/^JobDetails_AboutTheJob_(\d+)$/)?.[1];
    const root = section.closest<HTMLElement>(MODERN_LAYOUT.column);
    if (!domJobId || !root || !allowed(section) || !allowed(root)) continue;
    // A result list or parent column containing several postings is not a detail panel.
    if (Array.from(root.querySelectorAll<HTMLElement>(MODERN_LAYOUT.descriptions)).filter(allowed).length !== 1) continue;
    const titles = Array.from(root.querySelectorAll<HTMLElement>(MODERN_LAYOUT.headings)).filter((heading) =>
      allowed(heading) && !heading.closest(`${MODERN_LAYOUT.slots}, ${MODERN_LAYOUT.people}`)
      && Boolean(heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING));
    // Slot headings (About the job/company/people) must never become the job title.
    const title = titles.length === 1 ? titles[0] : null;
    const sectionHeading = first(section, [MODERN_LAYOUT.headings]);
    const excluded = new Set<HTMLElement>(sectionHeading ? [sectionHeading] : []);
    const expand = Array.from(section.querySelectorAll<HTMLElement>('button, [role="button"]')).find((button) => {
      if (!allowed(button) || button.getAttribute("aria-disabled") === "true"
        || (button instanceof HTMLButtonElement && button.disabled)
        || button.getAttribute("aria-expanded") === "true") return false;
      const labels = [button.textContent, button.getAttribute("aria-label")].filter((value): value is string => Boolean(value));
      return labels.some((label) => /^(?:(?:show|see) more|mehr anzeigen|mehr ansehen|نمایش بیشتر|(?:…|\.{3})\s*more)[\s.…]*$/i.test(normalize(label)));
    }) ?? null;
    // This layout can clip a nested paragraph rather than the section itself.
    const nestedClipping = [section, ...section.querySelectorAll<HTMLElement>("div, p, span")].some((element) => {
      if (!allowed(element) || element.closest('button, [role="button"]') || (element.textContent?.trim().length ?? 0) < 40) return false;
      const style = getComputedStyle(element);
      const lineClamp = style.getPropertyValue("-webkit-line-clamp");
      return element.scrollHeight > element.clientHeight + 4
        && (["hidden", "clip"].includes(style.overflowY) || Boolean(lineClamp && lineClamp !== "none"));
    });
    candidates.push({ jobId: domJobId, domJobId, title: normalize(title?.innerText ?? ""), company: "",
      description: descriptionText(section, excluded),
      postingDetails: title ? cleanPostingDetails(readText(root, new Set([title]), true), title.innerText) : "", root, descriptionElement: section,
      expandButton: expand, collapsed: nestedClipping || descriptionIsClipped(section, root),
      loading: Boolean(root.closest('[aria-busy="true"]')) || Boolean(first(root, SELECTORS.loading)),
    });
  }
  return candidates;
}

export function findCurrentJob(route: JobRoute): JobCandidate | null {
  if (!route.isJobsPage) return null;
  const candidates: JobCandidate[] = modernCandidates();
  const visited = new Set<HTMLElement>();
  const roots = SELECTORS.roots.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
  // LinkedIn can replace wrapper classes while retaining its description marker.
  // Start from that marker and find the nearest local header, never page text.
  for (const selector of SELECTORS.descriptions) {
    for (const description of document.querySelectorAll<HTMLElement>(selector)) {
      if (!allowed(description)) continue;
      let parent = description.parentElement;
      for (let depth = 0; parent && depth < 8; depth++, parent = parent.parentElement) {
        if (parent.matches('main, [role="main"], body, html') || !allowed(parent)) break;
        const title = first(parent, SELECTORS.titles);
        if (title && !description.contains(title) && !title.contains(description)
          && Boolean(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          // A wrapper containing multiple descriptions is not a single detail panel.
          const descriptions = Array.from(parent.querySelectorAll<HTMLElement>(SELECTORS.descriptions.join(","))).filter(allowed);
          if (descriptions.every((other) => other === description || other.contains(description) || description.contains(other))) roots.push(parent);
          break;
        }
      }
    }
  }
  for (const root of roots) {
    if (visited.has(root) || !allowed(root)) continue;
    visited.add(root);
    const titleElement = first(root, SELECTORS.titles);
    const descriptionElement = first(root, SELECTORS.descriptions);
    if (!titleElement && !descriptionElement) continue;
    const domJobId = scopedJobId(root, titleElement);
    candidates.push({
      jobId: domJobId ?? route.jobId, domJobId,
      title: normalize(titleElement?.innerText ?? ""),
      company: normalize(first(root, SELECTORS.companies)?.innerText ?? ""),
      description: descriptionElement ? descriptionText(descriptionElement) : "",
      postingDetails: cleanPostingDetails(classicPostingDetails(root, descriptionElement), titleElement?.innerText ?? ""),
      root, descriptionElement, expandButton: expandButton(root),
      collapsed: descriptionIsClipped(descriptionElement, root),
      loading: Boolean(root.closest('[aria-busy="true"]')) || Boolean(first(root, SELECTORS.loading)),
    });
  }
  const matching = candidates.filter((candidate) => candidate.domJobId === route.jobId && candidate.domJobId !== null);
  const eligible = route.jobId && matching.length ? matching : candidates;
  // Select the best detail candidate within the first supported layout. If two
  // separate panels are equally plausible, do not guess which posting is active.
  const best = eligible.find((candidate) => candidate.title && candidate.descriptionElement) ?? eligible[0];
  if (!best) return null;
  const ambiguous = eligible.some((candidate) => candidate !== best
    && (candidate.jobId !== best.jobId || candidate.title !== best.title || candidate.description !== best.description || candidate.postingDetails !== best.postingDetails)
    && !best.root.contains(candidate.root) && !candidate.root.contains(best.root));
  return ambiguous ? null : best;
}

export function fallbackAnchor(): HTMLElement {
  return first(document, [".scaffold-layout__detail", "main", '[role="main"]']) ?? document.body;
}
