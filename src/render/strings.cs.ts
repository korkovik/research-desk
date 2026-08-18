/**
 * ============================================================================
 * THE COMPLETE CZECH SURFACE OF THE SITE. NOTHING ELSE IN `src/` SAYS A WORD
 * TO THE READER.
 * ============================================================================
 *
 * FOR THE REVIEWER
 *
 * Every fixed Czech word a visitor can see — headings, labels, notices,
 * footers, month names — is in the one object below. Nothing here is code you
 * need to understand: each entry is a piece of text, and the comment above it
 * says what it means in English and where on the site it appears. If a word is
 * wrong, change it here; there is no second place to check.
 *
 * NOT YET REVIEWED BY A NATIVE SPEAKER. The project owner and the author of
 * this file are both non-native. Grammar, case endings and tone are all fair
 * game — please correct them freely. The wording marked "spec wording" is
 * quoted from the project definition and, if it reads badly in Czech, should be
 * changed here and flagged to the owner rather than left awkward.
 *
 * WHAT IS NOT IN THIS FILE: the papers' own texts (written per-paper by the
 * summariser), the day's category names (they live in `config.json`, because
 * they double as query configuration), and the site name (also `config.json`,
 * §12 open decision).
 *
 * HOUSE RULES FOR ANY TEXT ADDED HERE
 * - Plain words. A 15-year-old must read it comfortably (§2).
 * - No hype: never "revoluční", "průlom", "převratný", "zázračný" (§2).
 * - Honest rather than tidy: if something failed or is uncertain, say so (§2, §9).
 * - `{neco}` in curly braces is a slot the program fills in (a number, a date,
 *   a name). Keep the slots, move them where the Czech sentence needs them.
 * - Plain text only, no HTML tags — the program handles the formatting.
 */
import type { StringTable } from './stringTable.js';

export const stringsCs: StringTable = {
  // ---- Page chrome ----------------------------------------------------

  // EN: browser tab title of one day's page, e.g. "Psychologie a chování –
  // 19. srpna 2026 – Research Desk". Shown in the tab and when the page is
  // shared or bookmarked.
  dayPageTitle: '{category} – {date} – {site}',

  // EN: browser tab title of the archive index page.
  indexPageTitle: '{site} – přehled všech dní',

  // EN: one-line description of the whole site. Appears under the heading on
  // every page, including the index.
  siteIntro: 'Nové vědecké studie vysvětlené běžnými slovy.',

  // EN: lead paragraph on the index page only, explaining what the reader is
  // looking at.
  indexIntro:
    'Každý den vybíráme několik nových vědeckých studií a vysvětlujeme je běžnými slovy. Níže jsou všechna dosavadní vydání, od nejnovějšího.',

  // EN: heading above the list of archived days on the index page.
  indexDaysHeading: 'Všechna vydání',

  // EN: shown on the index page instead of the list when no day has been
  // published yet (first run, or the archive was emptied).
  indexEmpty: 'Zatím tu není žádné vydání. První se objeví po prvním ranním běhu programu.',

  // EN: link text under each day on the index page, leading to that day's
  // full page ("Open the whole issue").
  indexOpenDay: 'Otevřít celé vydání',

  // EN: link at the top and bottom of a day page, leading back to the index
  // ("Back to the list of all days").
  backToIndex: 'Zpět na přehled všech dní',

  // EN: small label above the day's category name in the page header
  // ("Today's topic"). The category name itself comes from config.json.
  dayTopicLabel: 'Téma dne',

  // EN: position of a paper within the day, above each paper
  // ("Study 1 of 5"). {n} is the number of this paper, {total} the day's count.
  paperCounter: 'Studie {n} z {total}',

  // ---- The six blocks each paper is made of (§7), in order -------------

  // EN: block 1 heading — "Headline". Small label above the plain-language
  // title of the paper.
  blockTitle: 'Nadpis',

  // EN: block 2 heading — "What it is about". Two or three sentences on the
  // question and the finding.
  blockWhatItIsAbout: 'O co jde',

  // EN: block 3 heading — "Detailed explanation". The longer text with the
  // numbers in it.
  blockDetail: 'Podrobné vysvětlení',

  // EN: block 4 heading — "An example from everyday life". The centrepiece of
  // each paper.
  blockExample: 'Příklad ze života',

  // EN: block 5 heading — "Why it matters".
  blockWhyItMatters: 'Proč je to důležité',

  // EN: block 6 heading — "I want to know more". The references: authors,
  // journal, date, links, limitations.
  blockReferences: 'Chci vědět víc',

  // ---- Notices --------------------------------------------------------

  // EN: "The authors mention this as the reason they did the study." Shown
  // above the example whenever the example is the authors' stated motivation
  // rather than something the study actually found. Spec wording (§7.4) — it
  // must stay clear that this is not a result.
  exampleIsMotivation: 'Autoři to zmiňují jako důvod, proč studii dělali.',

  // EN: "This is an early version of the study, a so-called preprint. It has
  // not been through peer review yet – independent experts have not checked
  // the results." Shown on every paper that is a preprint. Spec wording (§4.3)
  // requires the phrase "zatím neprošlo recenzním řízením"; the rest is here to
  // explain what that means to someone who has never heard of peer review.
  // REVIEWER: please check the subject agreement of "neprošlo" here — a native
  // speaker may prefer "Studie zatím neprošla recenzním řízením".
  preprintNotice:
    'Jde o předběžnou verzi studie, takzvaný preprint – zatím neprošlo recenzním řízením, nezávislí odborníci výsledky ještě nezkontrolovali.',

  // EN: "There are fewer studies today". Heading of the notice shown when the
  // day has fewer papers than usual (§3).
  shortfallHeading: 'Dnes je studií méně',

  // EN: "Today we only managed to prepare {produced} of the usual {expected}
  // studies. We would rather publish fewer than add older or unrelated work."
  // Shown in the body of the day page, never hidden (§3).
  shortfallNotice:
    'Dnes se podařilo připravit jen {produced} z obvyklých {expected} studií. Raději zveřejníme méně studií, než abychom doplňovali starší nebo nesouvisející práce.',

  // ---- The reference block of each paper (§7.6) ------------------------

  // EN: "Authors".
  refAuthors: 'Autoři',

  // EN: "The authors are not listed" — when the source gives us no names.
  refAuthorsUnknown: 'Autoři nejsou uvedeni',

  // EN: "and others" — appended when the author list is too long to print in
  // full, e.g. "Nováková, Svoboda, Dvořák a další".
  refAndOthers: 'a další',

  // EN: "Journal" — label for the journal a peer-reviewed paper appeared in.
  refJournal: 'Časopis',

  // EN: "Preprint server" — label used instead of "Journal" for preprints,
  // e.g. arXiv.
  refPreprintServer: 'Preprintový server',

  // EN: "The source is not listed" — when we know neither journal nor server.
  refVenueUnknown: 'Zdroj není uveden',

  // EN: "Date of publication".
  refPublished: 'Datum zveřejnění',

  // EN: "DOI (permanent link to the study)". DOI is unavoidable jargon, so §2
  // requires explaining it in the same breath the first time it appears.
  refDoi: 'DOI (trvalý odkaz na studii)',

  // EN: "The study does not have a DOI yet" — shown instead of the link for
  // papers that have none, typically preprints.
  refDoiMissing: 'Studie zatím nemá DOI',

  // EN: "Record in the OpenAlex database" — label of the link to the paper's
  // entry in the catalogue the selection is based on.
  refOpenAlex: 'Záznam v databázi OpenAlex',

  // EN: "Open the record" — the clickable text of that link.
  refOpenAlexLinkText: 'Otevřít záznam',

  // EN: "Free PDF" — label of the link to the full text where it is freely
  // available.
  refOpenAccessPdf: 'PDF zdarma',

  // EN: "Open the PDF" — the clickable text of that link.
  refOpenAccessPdfLinkText: 'Otevřít PDF',

  // EN: "The study's page" — label of the link to wherever the paper lives.
  // Always shown, so there is a way through to the paper even when it has no
  // DOI.
  refPaperPage: 'Stránka studie',

  // EN: "Open the study's page" — the clickable text of that link.
  refPaperPageLinkText: 'Otevřít stránku studie',

  // EN: "What to watch out for" — label of the one honest line about the
  // study's limits (small sample, preprint, contested topic).
  refLimitations: 'Na co si dát pozor',

  // ---- Footer: what went wrong today (§9) ------------------------------

  // EN: "What did not work today" — heading of the footer section listing
  // sources that failed during the run.
  degradationHeading: 'Co dnes nefungovalo',

  // EN: "Some sources did not respond today. It may have affected which
  // studies were chosen:" — introduces the list below.
  degradationIntro: 'Některé zdroje dnes neodpovídaly. Mohlo to ovlivnit, které studie se vybraly:',

  // EN: the OpenAlex catalogue was unreachable — the pool of papers to choose
  // from was smaller than usual.
  degradationOpenAlex:
    'Databáze studií OpenAlex dnes neodpovídala, takže jsme vybírali z menšího počtu prací než obvykle.',

  // EN: arXiv (the preprint server) was unreachable — the newest work may be
  // missing.
  degradationArxiv:
    'Server arXiv s předběžnými verzemi studií dnes neodpovídal, takže tu nemusí být ty nejčerstvější práce.',

  // EN: Semantic Scholar (which supplies a ready-made one-sentence summary)
  // was unreachable — the explanations were written from the authors'
  // abstracts alone.
  degradationSemanticScholar:
    'Služba Semantic Scholar, která pomáhá se stručným shrnutím, dnes neodpovídala. Vysvětlení proto vycházejí jen z abstraktů, tedy ze shrnutí od samotných autorů.',

  // EN: the language model that writes the explanations partly failed — some
  // texts may be shorter or simpler than usual.
  degradationAnthropic:
    'Program, který vysvětlení píše, dnes částečně selhával. Některé texty proto mohou být kratší nebo stručnější než obvykle.',

  // EN: "This page was created on {date}." Last line of every day page.
  footerGenerated: 'Tato stránka vznikla {date}.',

  // EN: "The studies are chosen and explained by a computer program from
  // publicly available records. If something matters to you, open the original
  // study and check it." Honesty note in the footer (§2).
  footerHowItWorks:
    'Studie vybírá a vysvětluje počítačový program z veřejně dostupných záznamů. Když je pro vás něco důležité, otevřete si původní studii a ověřte si to.',

  // ---- Dates ----------------------------------------------------------

  // EN: month names in the form Czech dates use (genitive: "19. srpna 2026"),
  // January through December.
  monthsInDates: [
    'ledna', // January
    'února', // February
    'března', // March
    'dubna', // April
    'května', // May
    'června', // June
    'července', // July
    'srpna', // August
    'září', // September
    'října', // October
    'listopadu', // November
    'prosince', // December
  ],

  // EN: how a full date reads, e.g. "19. srpna 2026".
  datePattern: '{day}. {month} {year}',
};
