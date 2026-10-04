// Keep LinkedIn-specific selectors here. Unsupported layouts must fail visibly.
export const SELECTORS = {
  roots: [
    ".jobs-search__job-details--container", ".jobs-search__job-details",
    ".jobs-details__main-content", ".jobs-details", ".job-view-layout",
    ".scaffold-layout__detail", "main .details",
  ],
  titles: [
    ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title",
    "h1.topcard__title", "h1.top-card-layout__title", ".jobs-details-top-card__job-title", "h1",
    'h2 a[href*="/jobs/view/"]',
  ],
  descriptions: [
    "#job-details", ".jobs-description__content .jobs-box__html-content",
    ".jobs-description-content__text", ".jobs-description-content__text--stretch",
    ".description__text .show-more-less-html__markup", ".description__text--rich",
  ],
  companies: [
    ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name",
    ".jobs-details-top-card__company-url", ".topcard__org-name-link",
  ],
  headerDetails: [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__primary-description",
    ".job-details-jobs-unified-top-card__job-insight",
    ".jobs-unified-top-card__job-insight",
    ".topcard__flavor--bullet",
    ".description__job-criteria-item",
  ],
  loading: [
    '[aria-busy="true"]', ".artdeco-loader", ".jobs-details__loading",
    ".jobs-description__skeleton", ".jobs-details-skeleton",
  ],
  expandButtons: [
    ".jobs-description__footer-button", ".show-more-less-html__button--more",
    'button[aria-controls="job-details"][aria-expanded="false"]',
  ],
  excluded: [
    ".jobs-search-results-list", ".scaffold-layout__list", ".scaffold-layout__list-container",
    ".jobs-similar-jobs-list", ".similar-jobs", ".base-card", ".job-card-container",
  ],
};

// Observed in the user's layout report. Class names in this layout are generated.
export const MODERN_LAYOUT = {
  descriptions: '[id^="JobDetails_AboutTheJob_"]',
  column: '[data-component-type="LazyColumn"]',
  slots: '[id^="JobDetails_"]',
  people: '[id^="JobDetailsPeopleWhoCanHelpSlot_"]',
  headings: 'h2, [role="heading"][aria-level="2"]',
};

export const BAR_ID = "job-lens-status-bar-v1";
export const DEBOUNCE_MS = 200;
export const SETTLE_MS = 1_200;
export const URL_CHECK_MS = 500;
export const MAX_WAIT_MS = 15_000;
export const MIN_DESCRIPTION_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 100_000;
