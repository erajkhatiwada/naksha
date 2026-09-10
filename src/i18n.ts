/**
 * Bilingual labelling (spec §13).
 *
 * Every user-supplied label can carry a Devanagari counterpart, and every
 * district already ships with one. `lang` selects which is drawn; the other
 * still reaches screen readers, so switching language never hides information.
 */
import type { Region } from "./raster.ts";

export type Lang = "en" | "np";

/** Anything that can carry a name in both scripts. */
export interface Bilingual {
  label?: string;
  /** Devanagari label, e.g. "काठमाडौँ". */
  labelNp?: string;
}

/**
 * The label to draw, falling back to the other language when one is missing.
 *
 * Falling back matters: consumers commonly have Devanagari for major cities
 * and English for everything else. Rendering a blank pin would be worse than
 * rendering the language the caller didn't ask for.
 */
export function pickLabel(item: Bilingual, lang: Lang = "en"): string | undefined {
  return lang === "np" ? (item.labelNp ?? item.label) : (item.label ?? item.labelNp);
}

/**
 * Both names, for accessible descriptions and tooltips.
 * Returns just one when they are identical or only one exists.
 */
export function bothLabels(item: Bilingual): string | undefined {
  const { label, labelNp } = item;
  if (label && labelNp && label !== labelNp) return `${label} (${labelNp})`;
  return label ?? labelNp;
}

/** A district's name in the requested language. */
export function regionName(region: Region, lang: Lang = "en"): string {
  return lang === "np" ? region.nameNp : region.name;
}

/** A district's province name in the requested language. */
export function regionProvince(region: Region, lang: Lang = "en"): string {
  return lang === "np" ? region.provinceNameNp : region.provinceName;
}

/** A district's headquarters in the requested language, if known. */
export function regionHq(region: Region, lang: Lang = "en"): string | null {
  return (lang === "np" ? region.hqNp : region.hq) ?? region.hq;
}

/** A district as "Kathmandu (काठमाडौँ)". */
export function regionBoth(region: Region): string {
  return region.name === region.nameNp ? region.name : `${region.name} (${region.nameNp})`;
}
