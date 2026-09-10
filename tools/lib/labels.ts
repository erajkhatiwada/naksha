/**
 * Bilingual district and province names (spec §13).
 *
 * OCHA's boundary file carries English only, so Devanagari comes from
 * sagautam5/local-states-nepal (MIT). Joining the two is the delicate part:
 * a silent mis-join would print the wrong Devanagari name on a district and
 * nobody reading the English would notice.
 */

export interface BilingualDistrict {
  name: string;
  nameNp: string;
  hq: string | null;
  hqNp: string | null;
  province: number;
}

interface SourceRow {
  id: number;
  province_id: number;
  name: string;
  headquarter?: string;
}

/**
 * OCHA spelling -> local-states-nepal spelling, for the 13 districts whose
 * romanisation differs.
 *
 * Deliberately an explicit table rather than fuzzy string matching. Fuzzy
 * matching would silently re-pair districts if either source is ever renamed,
 * and "Rukum East" vs "Rukum West" is exactly the kind of pair it would get
 * wrong. Every entry below was checked against the province number and OCHA
 * p-code before being written down.
 */
const ALIASES: Record<string, string> = {
  // Romanisation variants.
  Achham: "Acham",
  Chitawan: "Chitwan",
  Kabhrepalanchok: "Kavrepalanchok",
  Kapilbastu: "Kapilvastu",
  Makawanpur: "Makwanpur",
  Panchthar: "Pachthar",
  Parbat: "Parwat",
  Ramechhap: "Ramechap",
  Tanahu: "Tanahun",
  // The post-2015 splits, which the two sources name differently.
  // OCHA keeps the parent name plus a direction; Nepal's current official
  // names are Nawalpur and Parasi.
  "Nawalparasi East": "Nawalpur", // NP0447, both P4
  "Nawalparasi West": "Parasi", // NP0547, both P5
  "Rukum East": "Eastern Rukum", // NP0552, both P5
  "Rukum West": "Western Rukum", // NP0652, both P6
};

/**
 * Devanagari corrections applied on top of the upstream data.
 *
 * Upstream writes the Rukum pair inconsistently — "पूर्वी रूकुम" is
 * adjective-first with रू, while "रुकुम पश्चिम" is noun-first with रु. In a
 * bilingual UI the two sit side by side in the same list, so they are
 * normalised to the official noun-first form.
 */
const DEVANAGARI_OVERRIDES: Record<string, string> = {
  "Rukum East": "रुकुम पूर्व",
  "Rukum West": "रुकुम पश्चिम",
};

/**
 * Headquarters whose Devanagari row upstream repeats the *district* name
 * instead of the headquarters town. English is correct in both cases.
 *
 * Any new occurrence throws rather than being papered over — see the check in
 * joinBilingual.
 */
const HQ_NP_OVERRIDES: Record<string, string> = {
  Jhapa: "भद्रपुर", // en says Bhadrapur, np said झापा
  Morang: "विराटनगर", // en says Biratnagar, np said मोरंग
};

/**
 * Repair Devanagari that was typed as a base vowel sign plus a matra instead
 * of the single composed codepoint.
 *
 * `काेशी` is क + ा + े, which *looks* like कोशी but is a different string, so
 * equality checks and search silently fail against correctly typed input.
 * Unicode normalisation does not fix this: 093E+0947 is not canonically
 * equivalent to 094B.
 */
export function fixDevanagari(text: string): string {
  return text
    .normalize("NFC")
    .replace(/ाे/g, "ो") // ा + े -> ो
    .replace(/ाै/g, "ौ") // ा + ै -> ौ
    .replace(/ाॅ/g, "ॉ") // ा + ॅ -> ॉ
    .trim();
}

export interface JoinResult {
  districts: Map<string, BilingualDistrict>;
  provinces: Map<number, { name: string; nameNp: string }>;
  notes: string[];
}

/**
 * Join OCHA district names to the bilingual source.
 *
 * Throws if any district is unmatched, matched twice, or disagrees on
 * province — a build failure is far better than shipping a wrong name.
 */
export function joinBilingual(
  ochaNames: { name: string; province: number; pcode: string | null }[],
  districtsEn: SourceRow[],
  districtsNp: SourceRow[],
  provincesEn: SourceRow[],
  provincesNp: SourceRow[],
): JoinResult {
  const npById = new Map(districtsNp.map((d) => [d.id, d]));
  const byName = new Map(districtsEn.map((d) => [d.name, d]));
  const notes: string[] = [];

  const districts = new Map<string, BilingualDistrict>();
  const claimed = new Map<number, string>();

  for (const region of ochaNames) {
    const target = ALIASES[region.name] ?? region.name;
    const en = byName.get(target);
    if (!en) {
      throw new Error(
        `no bilingual match for "${region.name}" (looked for "${target}"). ` +
          `Add an entry to ALIASES in tools/lib/labels.ts.`,
      );
    }
    const previous = claimed.get(en.id);
    if (previous) {
      throw new Error(`"${target}" claimed by both "${previous}" and "${region.name}"`);
    }
    claimed.set(en.id, region.name);

    if (en.province_id !== region.province) {
      throw new Error(
        `province mismatch for "${region.name}": OCHA says ${region.province}, ` +
          `bilingual source says ${en.province_id}`,
      );
    }

    const np = npById.get(en.id);
    if (!np) throw new Error(`no Devanagari row for id ${en.id} ("${target}")`);

    const override = DEVANAGARI_OVERRIDES[region.name];
    const nameNp = fixDevanagari(override ?? np.name);
    if (override && fixDevanagari(np.name) !== override) {
      notes.push(`normalised ${region.name}: "${np.name}" -> "${override}"`);
    }
    if (!override && fixDevanagari(np.name) !== np.name.normalize("NFC")) {
      notes.push(`repaired Devanagari encoding for ${region.name}`);
    }
    if (ALIASES[region.name]) {
      notes.push(`aliased ${region.name} -> ${target} (both P${region.province})`);
    }

    const hq = en.headquarter ?? null;
    let hqNp = np.headquarter ? fixDevanagari(np.headquarter) : null;

    // Catch the upstream pattern where the Devanagari headquarters silently
    // repeats the district name while English names a different town.
    if (hq && hq !== en.name && hqNp === nameNp) {
      const override = HQ_NP_OVERRIDES[region.name];
      if (!override) {
        throw new Error(
          `Devanagari headquarters for "${region.name}" repeats the district name ` +
            `("${hqNp}") while English says "${hq}". Add it to HQ_NP_OVERRIDES ` +
            `in tools/lib/labels.ts after checking the correct spelling.`,
        );
      }
      hqNp = override;
      notes.push(`corrected ${region.name} HQ: "${np.headquarter}" -> "${override}" (en: ${hq})`);
    }

    districts.set(region.name, {
      name: region.name,
      nameNp,
      hq,
      hqNp,
      province: region.province,
    });
  }

  const provNp = new Map(provincesNp.map((p) => [p.id, p]));
  const provinces = new Map<number, { name: string; nameNp: string }>();
  for (const p of provincesEn) {
    const np = provNp.get(p.id);
    if (!np) throw new Error(`no Devanagari name for province ${p.id}`);
    const fixed = fixDevanagari(np.name);
    if (fixed !== np.name.normalize("NFC")) {
      notes.push(`repaired Devanagari encoding for province ${p.id} ("${np.name}")`);
    }
    provinces.set(p.id, { name: p.name, nameNp: fixed });
  }

  return { districts, provinces, notes };
}
