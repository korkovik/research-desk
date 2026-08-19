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
 * This IS the one strings file DESIGN-NOTES D.6 asks for; it lives here rather
 * than at `src/i18n/cs.json` because TypeScript can then make a missing key a
 * compile error, which JSON cannot. The degradation and shortfall wordings D.6
 * drafted are carried over verbatim, with the two changes D.6 itself suggested.
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
  // Shortened after seeing it rendered: it repeated "vědeckých studií" and
  // "běžnými slovy" from siteIntro directly above it, so the reader met the
  // same sentence twice.
  indexIntro: 'Každý den vybíráme několik nových studií. Níže jsou všechna dosavadní vydání, od nejnovějšího.',

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

  // EN: block 3 heading — "Detailed explanation". The longer text with the
  // numbers in it.
  blockDetail: 'Podrobné vysvětlení',

  // EN: block 5 heading — "Why it matters".
  blockWhyItMatters: 'Proč je to důležité',

  // EN: block 6 heading — "I want to know more". The references: authors,
  // journal, date, links, limitations.
  blockReferences: 'Chci vědět víc',

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

  // EN: "Today we only found {produced} studies that met the selection
  // conditions. We would rather publish fewer of them than pad the issue with
  // older or unrelated articles." Shown in the body of the day page, never
  // hidden (§3). Wording taken from DESIGN-NOTES D.6 (DEG_SHORTFALL).
  // PLURALS: {produced} is only ever 3 or 4 today (§9's minimum is 3, the
  // target is 5) and Czech takes "studie" for both. If the minimum ever drops
  // to 1 or 2, this sentence needs "studii" / "studie" forms.
  shortfallNotice:
    'Dnes se podařilo najít jen {produced} studie, které splnily podmínky výběru. Raději jich zveřejňujeme méně, než abychom doplňovali starší nebo nesouvisející články.',

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

  // EN: "A note on today's issue" — heading of the footer section listing what
  // failed during the run. Deliberately calm rather than alarming: §9 says fail
  // visibly, not loudly. Wording from DESIGN-NOTES D.6.
  degradationHeading: 'Poznámka k dnešnímu vydání',

  // EN: "Part of the database we choose studies from was unavailable today. The
  // selection therefore comes from a smaller number of works than usual."
  // Wording from DESIGN-NOTES D.6 (DEG_OPENALEX).
  degradationOpenAlex:
    'Část databáze, ze které vybíráme studie, dnes nebyla dostupná. Výběr proto vychází z menšího počtu prací než obvykle.',

  // EN: "The server where researchers publish work before review did not
  // respond today. Today's selection therefore contains only work from
  // peer-reviewed journals." DESIGN-NOTES D.6 (DEG_ARXIV), using the plainer
  // alternative it suggests, because a reader does not know the word "preprint"
  // from a footer alone.
  degradationArxiv:
    'Server, kde vědci zveřejňují práce ještě před recenzí, dnes neodpovídal. Dnešní výběr proto obsahuje jen práce z recenzovaných časopisů.',

  // EN: "Automatic short summaries were unavailable today. The explanations are
  // therefore written straight from the papers' abstracts, that is from the
  // summaries the authors wrote themselves." DESIGN-NOTES D.6 (DEG_TLDR), with
  // "abstrakt" glossed per §2's jargon rule.
  degradationSemanticScholar:
    'Automatická krátká shrnutí dnes nebyla dostupná. Vysvětlení jsou proto napsaná přímo podle abstraktů, tedy podle shrnutí od samotných autorů.',

  // EN: "For some studies we could not prepare the text today. We left them out
  // of the issue rather than publishing something half-finished."
  // DESIGN-NOTES D.6 (DEG_ANTHROPIC), reworded from "one study" because this
  // notice covers however many papers were affected.
  degradationAnthropic:
    'U některých studií se dnes nepodařilo připravit text. Do vydání jsme je proto nezařadili.',

  // EN: "Part of one text was left in English." Shown when §2's
  // untranslated-English check still failed after the regeneration budget was
  // spent. D.6 drafted this with "we are sorry, we will fix it" on the end;
  // that is a promise an unattended pipeline cannot keep, so it is dropped.
  degradationTranslation:
    'V jednom z dnešních textů zůstala část v angličtině. Program ji nedokázal přeložit.',

  // EN: "We had to close today's edition before we had gone through every study
  // we found." Shown when the run hit its per-run call ceiling (D.6 DEG_BUDGET).
  degradationBudget:
    'Dnešní vydání jsme museli uzavřít dřív, než jsme prošli všechny nalezené studie.',

  // EN: "This page was created on {date}." Last line of every day page.
  footerGenerated: 'Tato stránka vznikla {date}.',

  // EN: "These pages are prepared by a computer program from publicly available
  // records of research. If something matters to you, open the original study
  // and check it for yourself." Honesty note in the footer (§2).
  // REVIEWER: an earlier draft read "Studie vybírá a vysvětluje počítačový
  // program…", where "studie" can be read as the subject and the sentence flips
  // meaning. Please watch for the same trap if you rewrite this.
  footerHowItWorks:
    'Tyto stránky připravuje počítačový program z veřejně dostupných záznamů o studiích. Když je pro vás něco důležité, otevřete si původní studii a přečtěte si ji sami.',

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
