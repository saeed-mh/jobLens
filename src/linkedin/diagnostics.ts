import { BAR_ID, MODERN_LAYOUT, SELECTORS } from "./selectors.js";
import { currentRoute, isVisible } from "./extract.js";

// Collect structural hints only: no text nodes, links, HTML, or storage values.
export function layoutDiagnostics(): string {
  function structure(element: HTMLElement): object {
    const attributes: Record<string, string> = {};
    for (const name of ["id", "class", "role", "aria-level", "aria-busy", "aria-expanded", "data-view-name", "data-component-type"]) {
      const value = element.getAttribute(name);
      if (value) attributes[name] = value.slice(0, 300);
    }
    return { tag: element.tagName.toLowerCase(), ...attributes };
  }
  const allowed = (element: HTMLElement) => isVisible(element) && !element.closest(`#${BAR_ID}`)
    && !element.closest(SELECTORS.excluded.join(","));
  const counts = Object.fromEntries(["roots", "titles", "descriptions", "headerDetails", "loading", "expandButtons"].map((group) => [group,
    Object.fromEntries(SELECTORS[group as keyof typeof SELECTORS].map((selector) => [selector,
      Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(allowed).length])),
  ]));
  const landmarks = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, [role="heading"], ' + SELECTORS.descriptions.join(",")))
    .filter(allowed).slice(0, 40).map((element) => {
      const ancestors: object[] = [];
      let parent = element.parentElement;
      for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
        ancestors.push(structure(parent));
        if (parent === document.body) break;
      }
      const siblings = Array.from(element.parentElement?.children ?? []).filter((node): node is HTMLElement => node instanceof HTMLElement && allowed(node))
        .slice(0, 12).map((node) => ({ ...structure(node), children: Array.from(node.children)
          .filter((child): child is HTMLElement => child instanceof HTMLElement && allowed(child)).slice(0, 8).map(structure) }));
      return { element: structure(element), ancestors, siblings };
    });
  const modernSections = Array.from(document.querySelectorAll<HTMLElement>(MODERN_LAYOUT.descriptions)).filter(allowed).slice(0, 4).map((section) => {
    let remaining = 160;
    function tree(element: HTMLElement, depth = 0): object {
      remaining--;
      return { ...structure(element), children: depth < 10 ? Array.from(element.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && allowed(child)).slice(0, 20)
        .flatMap((child) => remaining > 0 ? [tree(child, depth + 1)] : []) : [] };
    }
    const column = section.closest<HTMLElement>(MODERN_LAYOUT.column);
    const headerHeadingCandidates = column ? Array.from(column.querySelectorAll<HTMLElement>(MODERN_LAYOUT.headings)).filter((heading) =>
      allowed(heading) && !heading.closest(`${MODERN_LAYOUT.slots}, ${MODERN_LAYOUT.people}`)
      && Boolean(heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).length : 0;
    return { column: column ? structure(column) : null, headerHeadingCandidates, tree: tree(section) };
  });
  return JSON.stringify({ format: "job-lens-layout-v1", extensionVersion: chrome.runtime.getManifest().version,
    route: currentRoute(location.href), counts, landmarks, modernSections }, null, 2);
}
