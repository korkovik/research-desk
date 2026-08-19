/**
 * The structured-output contracts for the two Claude calls.
 *
 * Both are Zod schemas rather than free text because a regex over prose that
 * half-parses a malformed answer is exactly how a fabricated example would slip
 * through: a partial parse looks like a partial success, and the pipeline would
 * carry on. A schema violation is a hard failure with nowhere to hide.
 *
 * The `.describe()` strings are read by the model. They are part of the prompt,
 * not documentation — word them as instructions.
 */
import { z } from 'zod';

/** §7 — the six output blocks, as the summariser returns them. */
export const SummarySchema = z.object({
  nadpis: z
    .string()
    .min(10)
    .max(140)
    .describe('§7.1 Nadpis: přepsaný titulek běžnými slovy, jedna řádka, nejvýše 14 slov.'),
  oCoJde: z
    .string()
    .min(40)
    .describe('§7.2 O co jde: 2–3 věty. Na co se vědci ptali a co zjistili. ŽÁDNÁ čísla.'),
  podrobneVysvetleni: z
    .string()
    .min(200)
    .describe(
      '§7.3 Podrobné vysvětlení: 150–250 slov. Jak to dělali, co vyšlo, co to znamená. ' +
        'Čísla jsou povolená, ale u každého čísla musí být vysvětlení běžnými slovy ' +
        '(„o 12 % — tedy zhruba jeden člověk z osmi").',
    ),
  prikladZeZivota: z
    .string()
    .min(40)
    .describe(
      '§7.4 Příklad ze života. Buď to, co studie opravdu dělala nebo měřila, ' +
        'nebo běžná situace, na které si to čtenář představí. Který z těch dvou ' +
        'to je, uveď v poli prikladTyp.',
    ),
  prikladTyp: z
    .enum(['ze-studie', 'ilustrace'])
    .describe(
      '„ze-studie" = příklad popisuje, co studie opravdu dělala, měřila nebo ' +
        'zjistila; každý prvek musí být v abstraktu. „ilustrace" = běžná situace, ' +
        'kterou sis vymyslel ty, aby si to čtenář uměl představit — v takovém ' +
        'případě NESMÍ tvrdit nic o studii: žádné její číslo, výsledek, místo ' +
        'ani koho sledovala.',
    ),
  procJeToDulezite: z
    .string()
    .min(30)
    .describe('§7.5 Proč je to důležité: 1–2 věty pro běžného čtenáře.'),
  poznamkaKOmezenim: z
    .string()
    .min(20)
    .describe(
      '§7.6 Jedna poctivá věta o omezeních: velikost vzorku, preprint bez recenze, ' +
        'sporná oblast. Pokud je výsledek předběžný, řekni to.',
    ),
});

export type SummaryPayload = z.infer<typeof SummarySchema>;

/**
 * §7.4's example block, regenerated on its own.
 *
 * When verification rejects an example, only that block is regenerated — not the
 * whole summary. The six blocks are rendered under separate headings, so a fresh
 * example does not have to flow out of the previous paragraph, and rewriting five
 * blocks that already passed their checks would risk breaking them to fix one.
 */
export const ExampleSchema = z.object({
  prikladZeZivota: z
    .string()
    .min(40)
    .describe(
      'Nový §7.4 Příklad ze života. Buď to, co studie opravdu dělala nebo měřila ' +
        '(pak musí být každý prvek ve zdroji), nebo tvoje vlastní přirovnání, ' +
        'které o studii netvrdí nic. Který to je, uveď v prikladTyp.',
    ),
  prikladTyp: z
    .enum(['ze-studie', 'ilustrace'])
    .describe(
      'Když se předchozí pokus nepodařilo doložit, přirovnání („ilustrace") je ' +
        'často lepší volba než další pokus popsat studii.',
    ),
});

export type ExamplePayload = z.infer<typeof ExampleSchema>;

/** §7.4 fallback: the authors' stated motivation, generated on its own. */
export const MotivationSchema = z.object({
  motivace: z
    .string()
    .min(30)
    .describe(
      'Jedna až tři české věty o tom, proč autoři studii dělali, čerpané VÝHRADNĚ ' +
        'z abstraktu. Nepřidávej nic, co v abstraktu není. Nepiš úvodní návěští — ' +
        'to doplní program sám.',
    ),
});

export type MotivationPayload = z.infer<typeof MotivationSchema>;

/** DESIGN-NOTES C.2.1 — the claim taxonomy the verifier must use. */
export const CLAIM_TYPES = [
  'setting',
  'population',
  'action',
  'quantity',
  'outcome',
  'application',
  'mechanism',
  'motivation',
  'other',
] as const;

export const QUOTE_FIELDS = ['title', 'abstract', 'tldr', 'venue'] as const;
export type QuoteField = (typeof QUOTE_FIELDS)[number];

export const ClaimSchema = z.object({
  id: z.string().min(1).max(8).describe('„c1", „c2", … postupně, bez opakování.'),
  claimText: z
    .string()
    .min(3)
    .max(200)
    .describe('Jedno tvrzení, anglicky, vlastními slovy. Jeden podmět, jeden výrok.'),
  claimType: z.enum(CLAIM_TYPES),
  exampleSpan: z
    .string()
    .min(4)
    .describe(
      'Zkopíruj PŘESNÉ znaky z českého příkladu, ze kterých toto tvrzení pochází. ' +
        'Nepřekládej, neparafrázuj, neopravuj překlepy.',
    ),
  verdict: z.enum(['supported', 'unsupported']),
  sourceQuote: z
    .string()
    .nullable()
    .describe(
      'Zkopíruj PŘESNÉ znaky ze zdrojového anglického textu, 15–300 znaků. ' +
        'Nepřesná kopie se počítá jako vymyšlená citace. Musí být null, ' +
        'když je verdikt „unsupported".',
    ),
  quoteField: z
    .enum(QUOTE_FIELDS)
    .nullable()
    .describe('Ze kterého zdrojového pole citace pochází. null právě tehdy, když je citace null.'),
});

export type ClaimPayload = z.infer<typeof ClaimSchema>;

export const VerificationSchema = z.object({
  // Zero is allowed because of illustration mode: an everyday framing that
  // asserts nothing about the study has no claims to decompose, and that is the
  // correct answer rather than a malformed one.
  claims: z.array(ClaimSchema).max(15),
  modelOverallVerdict: z
    .enum(['supported', 'unsupported'])
    .describe('Tvůj celkový názor. Program si závěr počítá sám — tohle je jen pro záznam.'),
  unsupportedReasonsCs: z
    // 160 characters was the design's figure; a single Czech sentence naming
    // what is missing routinely runs longer, and truncating the reason degrades
    // the regeneration prompt it feeds.
    .array(z.string().max(400))
    .max(10)
    .describe('Česky, stručně: co konkrétně ve zdroji chybí. Prázdné pole, když je vše doložené.'),
});

export type VerificationPayload = z.infer<typeof VerificationSchema>;
