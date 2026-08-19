/**
 * The shape of one language's user-facing vocabulary.
 *
 * §2 requires that "the output language is a config value, not hardcoded
 * strings". This interface is the contract that makes that true: the renderer
 * only ever reads keys off a `StringTable`, so a second language is a second
 * data file (`strings.en.ts`) and zero renderer changes. Because every key is
 * required, a language file that forgets one is a compile error rather than an
 * `undefined` that reaches a reader as "undefined" on the page.
 *
 * Values are plain text, never HTML — the renderer escapes them. `{name}`
 * placeholders are substituted by the renderer; an unknown placeholder is left
 * verbatim rather than throwing, because a typo in a locale file must not stop
 * an unattended 06:00 run from publishing (§9: fail visibly, not loudly).
 */
export interface StringTable {
  // ---- Page chrome ----------------------------------------------------
  /** `<title>` of a day page. Placeholders: {site} {category} {date}. */
  readonly dayPageTitle: string;
  /** `<title>` of the archive index. Placeholder: {site}. */
  readonly indexPageTitle: string;
  /** One-line description of what the site is, under the masthead. */
  readonly siteIntro: string;
  /** Longer lead paragraph, index page only. */
  readonly indexIntro: string;
  /** Heading above the list of archived days. */
  readonly indexDaysHeading: string;
  /** Shown instead of the list when nothing has been archived yet. */
  readonly indexEmpty: string;
  /** Link text from an index entry to that day's full page. */
  readonly indexOpenDay: string;
  /** Link text from a day page back to the index. */
  readonly backToIndex: string;
  /** Label above the day's category name. */
  readonly dayTopicLabel: string;
  /** Position of a paper within the day. Placeholders: {n} {total}. */
  readonly paperCounter: string;

  // ---- The six §7 blocks, in the spec's order -------------------------
  readonly blockTitle: string;
  readonly blockWhatItIsAbout: string;
  readonly blockDetail: string;
  readonly blockExample: string;
  readonly blockWhyItMatters: string;
  readonly blockReferences: string;

  // ---- Notices --------------------------------------------------------
  /** §7.4 fallback label: the example is the authors' motivation, not a finding. */
  readonly exampleIsMotivation: string;
  /** §4.3: a preprint has not been peer reviewed, said in plain words. */
  readonly preprintNotice: string;
  /** §3 shortfall heading. */
  readonly shortfallHeading: string;
  /** §3 shortfall body. Placeholders: {produced} {expected}. */
  readonly shortfallNotice: string;

  // ---- §7.6 reference block -------------------------------------------
  readonly refAuthors: string;
  readonly refAuthorsUnknown: string;
  /** Appended after a truncated author list. */
  readonly refAndOthers: string;
  readonly refJournal: string;
  readonly refPreprintServer: string;
  readonly refVenueUnknown: string;
  readonly refPublished: string;
  readonly refDoi: string;
  readonly refDoiMissing: string;
  readonly refOpenAlex: string;
  readonly refOpenAlexLinkText: string;
  readonly refOpenAccessPdf: string;
  readonly refOpenAccessPdfLinkText: string;
  readonly refPaperPage: string;
  readonly refPaperPageLinkText: string;
  readonly refLimitations: string;

  // ---- §9 footer ------------------------------------------------------
  readonly degradationHeading: string;
  readonly degradationOpenAlex: string;
  readonly degradationArxiv: string;
  readonly degradationSemanticScholar: string;
  readonly degradationAnthropic: string;
  readonly degradationTranslation: string;
  readonly degradationBudget: string;
  /** Placeholder: {date}. */
  readonly footerGenerated: string;
  readonly footerHowItWorks: string;

  // ---- Dates ----------------------------------------------------------
  /**
   * Month names in whatever form the language's date pattern needs — Czech
   * dates take the genitive ("19. srpna"), so this is not the citation form.
   * January first, twelve entries, enforced by the tuple type.
   */
  readonly monthsInDates: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  /** How a date reads. Placeholders: {day} {month} {year}. */
  readonly datePattern: string;
}
