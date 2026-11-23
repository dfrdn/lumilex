/**
 * The places an international registration can designate: countries by
 * their ISO 3166 two-letter code, and the regional offices by the codes WIPO
 * uses for them.
 */
const REGIONAL: Record<string, string> = {
  EM: 'European Union',
  BX: 'Benelux',
  OA: 'OAPI',
};

/** Codes people type for an office WIPO codes otherwise. */
const ALIASES: Record<string, string> = { EU: 'EM' };

const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regionName = (c: string) => {
  const name = regions.of(c);
  return name && name !== 'Unknown Region' ? name : null;
};

const normalise = (code: string) => {
  const c = code.trim().toUpperCase();
  return ALIASES[c] ?? c;
};

/** A designated country's name: "United States" for US, "European Union" for EM. */
export function countryName(code: string): string {
  const c = normalise(code);
  return REGIONAL[c] ?? regionName(c) ?? c;
}

/** Whether a code names a country or regional office we can show. */
export function isKnownCountry(code: string): boolean {
  const c = normalise(code);
  return /^[A-Z]{2}$/.test(c) && c !== 'PH' && (c in REGIONAL || !!regionName(c));
}

/**
 * The codes in a typed list ("US, JP, em"), upper-cased and without repeats,
 * with the ones that aren't a country or regional office set apart. The
 * Philippines is the office of origin, so it can't be designated.
 */
export function parseCountries(text: string): { codes: string[]; unknown: string[] } {
  const parts = [...new Set(text.split(/[\s,;]+/).map(normalise).filter(Boolean))];
  return { codes: parts.filter(isKnownCountry), unknown: parts.filter((p) => !isKnownCountry(p)) };
}

/** Names that take "the" in a sentence: "in the United States", "in the European Union". */
const WITH_THE = /^(United |Republic|Netherlands|Philippines|European Union|Benelux|Czech|Dominican|Central African|Bahamas|Gambia|Maldives|Marshall|Solomon|Comoros|Seychelles)/;

/** A designated country as a sentence names it: "the United States", "Japan", "the OAPI member states". */
export function countryInSentence(code: string): string {
  if (normalise(code) === 'OA') return 'the OAPI member states';
  const name = countryName(code);
  return WITH_THE.test(name) ? `the ${name}` : name;
}

/** The office that examines a country's designation, as a letter names it. */
export function designatedOffice(code: string): string {
  return `the trademark office of ${countryInSentence(code)}`;
}
