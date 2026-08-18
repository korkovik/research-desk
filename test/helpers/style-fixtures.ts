/**
 * Fixtures for the §2 style-checker tests (TEST-SCENARIOS section C).
 *
 * The negative controls below are the real test. A checker that flags
 * everything is as useless as one that flags nothing, so each of them is a
 * realistic 150–250-word Czech popular-science passage in exactly the register
 * §2 asks for — short sentences, active voice, every number anchored, every
 * technical term either avoided or glossed in the same sentence. If any of them
 * starts failing, the checker has drifted, not the text.
 *
 * All Czech in this file was written by the implementing agent and is listed in
 * the handover for native-speaker review.
 */
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.js';
import type { StyleConfig } from '../../src/config.js';
import type { PaperSummary } from '../../src/types.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function styleConfig(): StyleConfig {
  return loadConfig(repoRoot).style;
}

/** A summary with every block empty, so a test can fill only what it exercises. */
export function emptySummary(): PaperSummary {
  return {
    nadpis: '',
    oCoJde: '',
    podrobneVysvetleni: '',
    prikladZeZivota: '',
    prikladJeMotivace: false,
    procJeToDulezite: '',
    poznamkaKOmezenim: '',
  };
}

export function summaryWith(overrides: Partial<PaperSummary>): PaperSummary {
  return { ...emptySummary(), ...overrides };
}

// ---------------------------------------------------------------------------
// Negative control 1 — Příroda a klima (Wednesday). Contains `zlomová linie`
// nowhere, but is the passage the geological-fault test sits next to.
// ---------------------------------------------------------------------------
export const CONTROL_LEDOVEC: PaperSummary = {
  nadpis: 'Ledovec nad městem taje rychleji, když fouká teplý vítr',
  oCoJde:
    'Vědci v Norsku chtěli vědět, proč led na malém ledovci ubývá rychleji než dřív. ' +
    'Celé léto ho měřili přímo na místě. Ukázalo se, že za tím stojí hlavně vítr, ne slunce.',
  podrobneVysvetleni:
    'Tým chodil na ledovec nad městem Tromsø každý týden po celé léto. Do ledu zapichoval tenké tyče a sledoval, ' +
    'jak moc z nich vyčnívá. Čím víc tyč trčela, tím víc ledu zmizelo. Vedle toho měřil teplotu, sílu větru a déšť. ' +
    'Za jedno léto ledovec ztratil vrstvu vysokou půldruhého metru, tedy zhruba výšku dospělého člověka. ' +
    'Nejvíc ledu zmizelo ve dnech, kdy od pevniny foukal teplý vítr. Samotné slunce hrálo menší roli, než tým čekal. ' +
    'Teplý vítr totiž odnáší od ledu chladnou vrstvu vzduchu a led pak taje i v noci. Vědci proto navrhují měřit vítr ' +
    'stejně pečlivě jako teplotu. Dosud se sledovala hlavně teplota, protože se snáz měří. Autoři sami píšou, ' +
    'že měřili jeden ledovec a jedno léto. Než z toho půjde dělat obecné závěry, bude potřeba víc míst a víc let.',
  prikladZeZivota:
    'Z ledovce teče voda do řeky, ze které pije celé město. Když led zmizí dřív, řeka na konci léta vysychá. ' +
    'Vodárna v Tromsø už dnes hledá, kde vezme vodu, až ledovec zeslábne.',
  prikladJeMotivace: false,
  procJeToDulezite:
    'Kdo plánuje zásoby vody na léto, potřebuje vědět, kdy led roztaje. Vítr do těch výpočtů zatím skoro nikdo nepočítal.',
  poznamkaKOmezenim: 'Jde o měření na jednom ledovci během jednoho léta, takže výsledek nemusí platit jinde.',
};

// ---------------------------------------------------------------------------
// Negative control 2 — Zdraví a medicína (Tuesday). This one carries real
// numbers, all anchored per §7.3, and states the smallness of the sample in one
// plain sentence per §2.
// ---------------------------------------------------------------------------
export const CONTROL_SPANEK: PaperSummary = {
  nadpis: 'Když děti chodí spát dřív, lépe se jim ráno počítá',
  oCoJde:
    'Vědci chtěli vědět, jestli dřívější večerka pomůže dětem soustředit se ve škole. ' +
    'Zkusili to na jedné základní škole během podzimu. Ukázalo se, že rozdíl je vidět už po několika týdnech.',
  podrobneVysvetleni:
    'Do pokusu se přihlásilo 240 dětí, tedy zhruba deset školních tříd. Rodiče u jedné skupiny posunuli večerku ' +
    'o hodinu dopředu. Druhá skupina nechala všechno při starém. Obě skupiny nosily šest týdnů na ruce hodinky, ' +
    'které zaznamenávaly, kdy dítě usnulo a kdy se probudilo. Na začátku a na konci pak děti psaly stejný test ' +
    'z počtů. Děti, které chodily spát dřív, spaly navíc čtyřicet minut za noc. V testu udělaly o dvanáct procent ' +
    'méně chyb, tedy zhruba o jednu chybu z osmi. Rozdíl se ukázal hlavně v úlohách, kde bylo potřeba držet ' +
    'v hlavě několik čísel najednou. U čtení se nic takového nestalo. Autoři upozorňují, že šlo o jedinou školu ' +
    'a o jeden podzim, takže jde zatím o první náznak. Také připomínají, že rodiče věděli, do které skupiny ' +
    'jejich dítě patří, a mohli test nevědomky ovlivnit.',
  prikladZeZivota:
    'Představte si dítě, které píše ráno pětiminutovku z počtů. Podle této studie mu hodina spánku navíc ' +
    'ušetří asi jednu chybu z osmi. Rodičům to dává hmatatelný důvod, proč večer zhasnout dřív.',
  prikladJeMotivace: false,
  procJeToDulezite:
    'Večerka je jedna z mála věcí, které rodina opravdu řídí sama. Studie ukazuje, že i malý posun se ve škole projeví.',
  poznamkaKOmezenim: 'Šlo o jednu školu a 240 dětí, tedy o malý vzorek, a rodiče o rozdělení do skupin věděli.',
};

// ---------------------------------------------------------------------------
// Negative control 3 — Umělá inteligence (Monday). Uses two terms §2 would
// normally forbid, each with a plain-words gloss in the same sentence AND the
// English original in parentheses on first use — the shape §2 actually asks for.
// ---------------------------------------------------------------------------
export const CONTROL_POCITACE: PaperSummary = {
  nadpis: 'Počítač pozná nemocný list dřív než sadař',
  oCoJde:
    'Vědci zkoušeli, jestli program v mobilu pozná na fotce nemocný jabloňový list. ' +
    'Sbírali snímky přímo v sadech na jihu Moravy. Zajímalo je hlavně to, jestli program obstojí i za deště.',
  podrobneVysvetleni:
    'Tým nafotil v šesti sadech asi třicet tisíc listů, tedy zhruba tolik, kolik jich má jeden vzrostlý strom. ' +
    'Každý snímek pak zkušený sadař označil jako zdravý, nebo nemocný. Na těchto fotkách se program učil, ' +
    'co má hledat. Šlo o neuronovou síť (neural network), tedy program, který se sám učí z příkladů a nikdo mu ' +
    'nepíše přesná pravidla. Když měl program hotovo, dostal fotky ze sadu, který nikdy neviděl. Správně určil ' +
    'devět listů z deseti. Sadaři na stejných fotkách trefili osm listů z deseti, ale byli pomalejší. ' +
    'Za deště a v protisvětle se program pletl mnohem častěji. Autoři proto radí fotit za sucha a ze stínu. ' +
    'Píšou také, že testovali jen dvě odrůdy jabloní a jedinou chorobu. U jiných odrůd může program dopadnout hůř.',
  prikladZeZivota:
    'Sadař projde řadu stromů s mobilem v ruce a fotí listy, které mu přijdou divné. Program mu na místě řekne, ' +
    'na kterých stromech se choroba už usadila. Postřik pak jde tam, kde je opravdu potřeba.',
  prikladJeMotivace: false,
  procJeToDulezite:
    'Postřik na celý sad stojí peníze a zatěžuje půdu. Když sadař ví, kde je choroba, může postřikovat jen část sadu.',
  poznamkaKOmezenim: 'Program se učil na dvou odrůdách jabloní a jedné chorobě, u jiných může selhat.',
};

export const NEGATIVE_CONTROLS: ReadonlyArray<{ name: string; summary: PaperSummary }> = [
  { name: 'ledovec (Příroda a klima)', summary: CONTROL_LEDOVEC },
  { name: 'spánek (Zdraví a medicína)', summary: CONTROL_SPANEK },
  { name: 'sadař (Umělá inteligence)', summary: CONTROL_POCITACE },
];

// ---------------------------------------------------------------------------
// RISK-VOICE-01's fixture set: 10 paragraphs with one banned term each, and 10
// clean ones. The banned-term paragraphs cover case, diacritic and inflection
// variants, which is the part a naive `indexOf` would fail.
// ---------------------------------------------------------------------------
export const HYPE_POSITIVE: ReadonlyArray<{ text: string; expectMatch: string }> = [
  { text: 'Tým mluví o revolučním postupu při čištění vody.', expectMatch: 'revolučním' },
  { text: 'Autoři to označili za PRŮLOM v léčbě cukrovky.', expectMatch: 'PRŮLOM' },
  { text: 'Po tomto průlomu se změnilo plánování měst.', expectMatch: 'průlomu' },
  { text: 'Šlo o převratný způsob, jak měřit hloubku moře.', expectMatch: 'převratný' },
  { text: 'Výsledky jsou podle autorů zázračné.', expectMatch: 'zázračné' },
  { text: 'Pro obor to byl zlomový okamžik.', expectMatch: 'zlomový okamžik' },
  { text: 'Tahle metoda mění pravidla hry v celém oboru.', expectMatch: 'mění pravidla hry' },
  { text: 'Vědci hledali svatý grál mezi bateriemi.', expectMatch: 'svatý grál' },
  { text: 'Poprvé v historii se podařilo změřit celý cyklus.', expectMatch: 'Poprvé v historii' },
  { text: 'The team reports a groundbreaking method for water cleaning.', expectMatch: 'groundbreaking' },
];

/** Ten clean paragraphs. None may produce a hype finding of any severity. */
export const HYPE_NEGATIVE: readonly string[] = [
  'Vědci měřili, kolik vody spotřebuje pračka během jednoho praní.',
  'Tým sledoval, jak se v zimě chovají sýkorky u krmítka.',
  'Studie porovnala ceny chleba ve třech krajích během jednoho roku.',
  'Autoři zjistili, že déšť odnesl z pole část hnojiva do potoka.',
  'Měření ukázalo, že v panelovém domě je v létě nejtepleji pod střechou.',
  'Výzkumníci se ptali učitelů, kolik času stráví opravováním testů.',
  'Skupina lékařů popsala, jak se pacienti vrací do práce po zlomenině nohy.',
  'Tým testoval, jestli nová okna sníží hluk z ulice.',
  'Studie sledovala, jak dlouho vydrží nabitá baterie v mrazu.',
  'Autoři popsali, čím se živí ryby v přehradě na konci léta.',
];
