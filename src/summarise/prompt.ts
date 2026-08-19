/**
 * Every word this project sends to Claude.
 *
 * Kept in one file per language and selected by `config.output.language`, for
 * the same reason the Czech interface strings are kept in one file: neither the
 * author of this code nor the owner of the project is a native Czech speaker,
 * and prompt wording that nobody can review in one pass is wording nobody
 * reviews. §2's voice rules live here in the generator prompt AND, separately,
 * in the deterministic checker under `src/checks/` — the prompt asks, the
 * checker enforces. A rule that exists only as an instruction is a hope.
 *
 * NOTE FOR REVIEW: the Czech below is machine-written. It is instruction text,
 * not reader-facing text — a reader never sees it — but bad Czech here produces
 * bad Czech downstream, so it belongs in the same review pass as
 * `src/render/strings.cs.ts`.
 */
import type { SourceText } from './verify.js';

export interface PromptPack {
  language: string;
  summariserSystem: string;
  renderSummariserUser(source: SourceText, extra: SummaryContext): string;
  motivationSystem: string;
  renderMotivationUser(source: SourceText): string;
  /**
   * The example-only retry (DESIGN-NOTES C.5.5). It must NOT reuse the
   * motivation prompt: that one ends by asking for the authors' reason for
   * doing the study, and a model that follows it returns a motivation, which
   * then gets stored as an ordinary example and rendered WITHOUT §7.4's
   * mandatory "Autoři to zmiňují jako důvod…" label. A motivation presented as
   * a finding is exactly what A19 forbids.
   */
  renderExampleRetryUser(source: SourceText, corrections: string): string;
  /** Appended to a regeneration call: what was wrong last time. */
  renderCorrections(hardFindings: string[], rejectedSpans: string[]): string;
}

export interface SummaryContext {
  /** §4.3 — a preprint must be described as not peer reviewed, in plain words. */
  isPreprint: boolean;
  /** Czech label of the day's category, for register, not for content. */
  categoryLabel: string;
}

// ---------------------------------------------------------------------------
// Summariser — §7's six blocks, under §2's voice rules.
// ---------------------------------------------------------------------------

const CS_SUMMARISER_SYSTEM = `Píšeš pro české čtenáře bez vědeckého vzdělání: pro rodiny a pro učitele
základních a středních škol. Nepíšeš pro vědce.

CÍL: čtenář po přečtení dokáže objev vlastními slovy vysvětlit někomu dalšímu.

JAZYK A STYL
- Česky. Krátké věty. Činný rod („vědci sledovali", ne „bylo sledováno").
- Úroveň čtení patnáctiletého člověka, kterému to jde bez námahy.
- Žádný odborný termín bez vysvětlení. Když se termínu nejde vyhnout, vysvětli
  ho běžnými slovy v téže větě a při prvním použití uveď v závorce anglický
  originál — čeští čtenáři ho potkají jinde. Závorka s anglickým originálem
  ale NENÍ vysvětlení; musíš udělat obojí.
- ŽÁDNÁ senzacechtivost. Nikdy nepiš „revoluční", „průlom", „převratný",
  „mění pravidla hry" ani nic v tomto duchu. Napiš prostě, co se změnilo.
- Poctivá nejistota. Když je výsledek předběžný, ze vzorku pár desítek lidí,
  nebo je oblast sporná, napiš to jednou jednoduchou větou. Nevynechávej to
  kvůli hezčímu příběhu.
- Každé číslo dostane vysvětlení běžnými slovy: „o 12 % — tedy zhruba jeden
  člověk z osmi".

BLOKY (v tomto pořadí)
1. Nadpis — přepsaný titulek běžnými slovy. Ne titulek práce. Jedna řádka.
2. O co jde — 2 až 3 věty: na co se ptali a co zjistili. Bez čísel.
3. Podrobné vysvětlení — 150 až 250 slov: jak to dělali, co vyšlo, co to
   znamená. Čísla ano, ale každé s vysvětlením.
4. Příklad ze života — konkrétní ukázka.
5. Proč je to důležité — 1 až 2 věty pro běžného čtenáře.
6. Poznámka k omezením — jedna poctivá věta.

PRAVIDLO PRO PŘÍKLAD ZE ŽIVOTA — TOHLE JE NEJDŮLEŽITĚJŠÍ PRAVIDLO CELÉ PRÁCE
Příklad musí vycházet ze samotné práce: z jejího vlastního použití, z prostředí,
kde se studie dělala, z testovaného scénáře, nebo z důvodu, který autoři uvádějí.
Smíš ho přeformulovat pro laika, ale podstata musí být dohledatelná v abstraktu
nebo v jednovětém shrnutí.

Když práce žádné konkrétní použití neobsahuje, NEVYMÝŠLEJ SI HO. Použij důvod,
proč autoři studii dělali, a napiš to tak, aby bylo jasné, že jde o důvod, ne
o zjištění.

Vymyšlený příklad je nejhorší chyba, jaké se tu můžeš dopustit. Je horší než
kdyby článek nevyšel vůbec. Nepřidávej místo, věk, počet, zemi, prostředí ani
následek, který ve zdroji není. Když si nejsi jistý, napiš méně.`;

// DESIGN-NOTES C.5.6. The §7.4 label itself is NOT generated — it is prepended by
// the renderer, so a model that forgets the instruction cannot lose the labelling
// requirement the spec makes mandatory.
const CS_MOTIVATION_SYSTEM = `Píšeš česky pro čtenáře bez vědeckého vzdělání.

Práce neobsahuje konkrétní příklad ze života, který by šlo doložit. Napiš proto
1 až 3 věty o tom, co autoři sami uvádějí jako důvod, proč studii dělali.

Vycházej výhradně z úvodní části abstraktu. Nepiš, k čemu by výsledek mohl být
jednou dobrý, pokud to autoři neříkají. Nepiš žádné číslo, které v abstraktu není.

Nepiš úvodní větu „Autoři to zmiňují jako důvod, proč studii dělali" — tu doplní
systém sám. Žádná senzacechtivost, žádné nevysvětlené odborné termíny.`;

function renderSource(source: SourceText): string {
  // The abstract goes in verbatim. DESIGN-NOTES C.5.3 is explicit that truncating
  // it turns supported claims into unsupported ones later, in a way no log would
  // explain — so if it ever has to be cut, that must be recorded, not silent.
  return [
    '## ZDROJ (anglicky, doslova)',
    '',
    '### Název práce',
    source.title,
    '',
    '### Abstrakt',
    source.abstract,
    '',
    '### TLDR (automatické shrnutí, Semantic Scholar)',
    source.tldr ?? '(není k dispozici)',
    '',
    '### Kde vyšlo',
    `${source.venue} | typ: ${source.type} | datum: ${source.date}`,
  ].join('\n');
}

export const CS_PROMPTS: PromptPack = {
  language: 'cs',
  summariserSystem: CS_SUMMARISER_SYSTEM,
  motivationSystem: CS_MOTIVATION_SYSTEM,

  renderSummariserUser(source, extra) {
    const preprintLine = extra.isPreprint
      ? 'Tato práce je preprint: zatím neprošla recenzním řízením. Napiš to v poznámce ' +
        'k omezením běžnými slovy.'
      : '';
    return [
      renderSource(source),
      '',
      `Kategorie dne: ${extra.categoryLabel}`,
      preprintLine,
      '',
      'Napiš šest bloků podle pravidel. Vycházej jen z toho, co je ve zdroji výše.',
    ]
      .filter((line) => line !== '')
      .join('\n');
  },

  renderMotivationUser(source) {
    return `${renderSource(source)}\n\nNapiš 1 až 3 věty o důvodu, proč studie vznikla.`;
  },

  renderExampleRetryUser(source, corrections) {
    return [
      renderSource(source),
      '',
      corrections,
      '',
      'Napiš nový „Příklad ze života". Nic jiného nepiš.',
    ].join('\n');
  },

  // DESIGN-NOTES C.5.5. The verifier's raw output is never shown to the generator
  // — only the rejected spans and the Czech reasons. Handing over the full claim
  // analysis would teach the generator to write for the verifier rather than for
  // the reader, and the two are not the same target.
  //
  // One deliberate departure from C.5.5: its fragment ends by telling the model
  // that if the paper has no concrete example it may write the authors' stated
  // reason instead. That is right as an outcome and wrong here — a motivation
  // returned through this path is stored as an ordinary example and rendered
  // without §7.4's mandatory label, which is precisely what A19 forbids. The
  // pipeline has a separate, labelled rung for the motivation fallback, so this
  // one asks for a shorter example rather than a different kind of text.
  renderCorrections(hardFindings, rejectedSpans) {
    const parts: string[] = [];
    if (hardFindings.length > 0) {
      parts.push(
        '## Co je potřeba opravit',
        ...hardFindings.map((finding) => `- ${finding}`),
        'Oprav jen uvedená místa. Zbytek nech beze změny.',
        '',
      );
    }
    if (rejectedSpans.length > 0) {
      parts.push(
        '## Předchozí příklad byl odmítnut',
        '',
        'Tyto části nejsou v práci doložené:',
        ...rejectedSpans.map((span) => `- „${span}"`),
        '',
        'Napiš příklad znovu. Použij výhradně to, co je v abstraktu nebo v TLDR:',
        'skutečné prostředí studie, skutečné účastníky, skutečný testovaný scénář nebo',
        'použití, které autoři sami uvádějí.',
        '',
        'Nedoplňuj místo, věk, počet, číslo ani praktické využití, které v práci nejsou.',
        'Když toho práce nabízí málo, napiš raději kratší příklad. Nikdy nedoplňuj nic,',
        'co v ní není.',
      );
    }
    return parts.join('\n');
  },
};

const PACKS: Record<string, PromptPack> = { cs: CS_PROMPTS };

export function promptPackFor(language: string): PromptPack {
  const pack = PACKS[language];
  if (!pack) {
    throw new Error(
      `no prompt pack for language "${language}" — add one to src/summarise/prompt.ts ` +
        '(§2: the output language is a config value, so this is a missing translation, not a bug)',
    );
  }
  return pack;
}

// ---------------------------------------------------------------------------
// Verifier (§7.4 / §11 step 8), canonical text from DESIGN-NOTES C.5.
//
// Deliberately NOT part of PromptPack: the verifier's job does not change with
// the output language, and its instructions must stay byte-identical for every
// paper, or the golden-set calibration in test/ stops meaning anything. The
// version tags below are the handle for that — change the text, bump the tag,
// re-run the golden set.
//
// The language split is load-bearing, not stylistic (DESIGN-NOTES C.5.1):
//   • quotes are copied in ENGLISH because the code checks them by exact
//     substring against the English abstract, and a "translated quote" is the
//     obvious loophole for a verifier that wants to agree;
//   • claimText is English so the code-side relevance rule compares like with
//     like;
//   • the instructions are Czech because the text being judged is Czech, and
//     instructions in the same language keep the model on the actual wording
//     rather than an internally translated gist — and the gist of a fabricated
//     example is usually right, which is exactly how one gets through.
// ---------------------------------------------------------------------------

export const VERIFIER_PROMPT_VERSION = 'verifier.system.v1';
export const CHALLENGE_PROMPT_VERSION = 'verifier.challenge.v1';

const VERIFIER_PREAMBLE = `Jsi ověřovatel faktů. Tvým jediným úkolem je zjistit, zda je každý prvek
předloženého českého textu doložen ve zdrojovém anglickém textu.

ZDROJ je jediná pravda, kterou smíš použít. Nesmíš použít nic, co víš o světě,
o vědě, o pravděpodobnosti ani o tom, co je rozumné. Pokud tvrzení není ve zdroji,
je NEDOLOŽENÉ — i kdyby bylo zjevně pravdivé.

Výchozí verdikt je NEDOLOŽENÉ. Doložené smíš označit jen tehdy, když dokážeš
zkopírovat doslovný úsek zdroje, který dané tvrzení vyslovuje.

Zakázané způsoby uvažování — pokud je použiješ, děláš chybu:
- „To je pravděpodobné." / „To dává smysl." / „To je realistické."
- „Autoři to sice neříkají, ale vyplývá to z toho."
- „Obecně se ví, že…" / „Je známo, že…"
- „Studie tohoto typu obvykle…"
- „Je to jen jiný způsob, jak říct totéž." — pokud to zdroj neříká.
- Doplnění místa, prostředí, věku, druhu, počtu, čísla nebo praktického použití,
  které ve zdroji není.
- Vysvětlení příčiny („protože…", „díky tomu, že…"), které zdroj neuvádí.

Pokud musíš cokoliv domýšlet, aby tvrzení sedělo, je NEDOLOŽENÉ.

JAZYK:
- Pole \`claimText\` piš ANGLICKY.
- Pole \`sourceQuote\` kopíruj ANGLICKY, přesně tak, jak stojí ve zdroji.
  Nikdy nepřekládej. Nikdy neupravuj interpunkci ani velikost písmen.
- Pole \`exampleSpan\` kopíruj ČESKY, doslovně z posuzovaného textu.
- Pole \`unsupportedReasonsCs\` piš ČESKY.
`;

const VERIFIER_PROCEDURE = `
POSTUP:
1. Rozlož český text na atomická tvrzení. Samostatné tvrzení je:
   - každé místo nebo prostředí (typ \`setting\`),
   - každý údaj o tom, kdo nebo co bylo zkoumáno (typ \`population\`),
   - každý popsaný zásah nebo činnost (typ \`action\`),
   - každé číslo, podíl nebo slovo o velikosti („polovina", „dvakrát") (typ \`quantity\`),
   - každý výsledek nebo účinek (typ \`outcome\`),
   - každé praktické použití v běžném životě (typ \`application\`),
   - každé vysvětlení příčiny (typ \`mechanism\`),
   - motivace autorů, pokud je text takto uveden (typ \`motivation\`).
   Typicky vznikne 3 až 8 tvrzení. Nikdy nevynechávej žádnou větu.
2. Ke každému tvrzení buď zkopíruj doslovný úsek zdroje (15 až 300 znaků), který
   ho vyslovuje, nebo ho označ jako nedoložené a citaci nech prázdnou (null).
3. Citace musí být doslovná. Vymyšlená nebo pozměněná citace je sama o sobě chyba
   a odhalí ji automatická kontrola.
4. Úseky \`exampleSpan\` musí dohromady pokrýt celý český text.

Odpověz pouze strukturovaným výstupem. Nepiš žádný další komentář.`;

const CHALLENGE_PROCEDURE = `
POSTUP:
Tento text už jednou prošel kontrolou a byl označen za doložený. Předpokládej, že
předchozí kontrola byla příliš shovívavá. Tvým úkolem je najít nejslabší místo.

1. Rozlož český text na atomická tvrzení stejně jako dřív.
2. U každého tvrzení se ptej: je TOTO KONKRÉTNÍ slovo ve zdroji? Místo, prostředí,
   kdo byl zkoumán, jak velký byl účinek, k čemu se to v praxi použije, proč to tak je.
3. Pokud kterýkoliv z těchto prvků ve zdroji chybí, označ tvrzení jako nedoložené
   a česky napiš, co přesně chybí.
4. Neschvaluj text jen proto, že ho už někdo schválil.

Odpověz pouze strukturovaným výstupem. Nepiš žádný další komentář.`;

export const VERIFIER_SYSTEM_PROMPT = VERIFIER_PREAMBLE + VERIFIER_PROCEDURE;
export const CHALLENGE_SYSTEM_PROMPT = VERIFIER_PREAMBLE + CHALLENGE_PROCEDURE;

/** Rendered as the literal string when a field is absent, so no header dangles. */
const ABSENT = '(není k dispozici)';

export function renderVerifierUserMessage(source: SourceText, example: string): string {
  return `## ZDROJ (anglicky — jediné, z čeho smíš citovat)

### Název práce
${source.title}

### Abstrakt
${source.abstract}

### TLDR (automatické shrnutí, Semantic Scholar)
${source.tldr ?? ABSENT}

### Kde vyšlo
${source.venue} | typ: ${source.type} | datum: ${source.date}

## POSUZOVANÝ TEXT (česky — „Příklad ze života")

${example}

## ÚKOL

Rozlož POSUZOVANÝ TEXT na atomická tvrzení a u každého rozhodni, zda je doloženo
ve ZDROJI. Citace kopíruj v angličtině, přesně tak, jak jsou ve zdroji.
Výchozí verdikt je „unsupported". Nic nedoplňuj z vlastních znalostí.`;
}
