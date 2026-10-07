/**
 * Landing page demo. Runs the real library in the browser — nothing here is
 * pre-rendered or faked.
 */
import {
  attachInteractions,
  buildGrid,
  nepalRaster,
  renderSvg,
  clusterPoints,
  districtById,
  districtAt,
  describePlace,
  distanceKm,
  hitTest,
  eventPoint,
  unproject,
  zoomBbox,
  panBbox,
  clampBbox,
  districtBbox,
  padBbox,
  fitAspect,
  bboxSizeKm,
  bboxContains,
  NEPAL_BBOX,
  MIN_ZOOM_SPAN,
  darkTheme,
  lightTheme,
  DISTRICTS,
  VIEWS,
  pickLabel,
  regionAnchor,
  regionName,
  regionProvince,
  colorScale,
  sizeScale,
  formatValue,
  type Cluster,
  type Dot,
  type Theme,
  type MapPoint,
  type Route,
  type Lang,
  type Grid,
  type LabelPlacement,
  type LngLat,
  type Bbox,
  type ViewName,
  type Legend,
  type RenderOptions,
} from "../src/index.ts";

// ---------------------------------------------------------------- data ---

/**
 * Devanagari names for district headquarters below are the ones naksha itself
 * ships; the neighbourhood and town names (Thamel, Butwal, Damak…) are
 * transliterations written for this demo and are worth a native-speaker check.
 */
/** A demo place always carries both scripts, unlike the library's optional pair. */
interface Place extends MapPoint {
  label: string;
  labelNp: string;
}

const place = (lng: number, lat: number, label: string, labelNp: string): Place => ({
  lng,
  lat,
  label,
  labelNp,
});

const KTM = place(85.3591, 27.6966, "Kathmandu", "काठमाडौँ");

/** Destinations reached from a single hub. */
const HUBS = [
  place(83.982, 28.201, "Pokhara", "पोखरा"),
  place(87.264, 26.4815, "Biratnagar", "विराटनगर"),
  place(81.667, 28.1036, "Nepalgunj", "नेपालगंज"),
  place(80.5819, 28.7533, "Dhangadhi", "धनगढी"),
  place(86.7314, 27.6869, "Lukla", "लुक्ला"),
  place(83.416, 27.5056, "Bhairahawa", "भैरहवा"),
  place(88.0794, 26.5708, "Bhadrapur", "भद्रपुर"),
  place(84.4294, 27.6781, "Bharatpur", "भरतपुर"),
];

/**
 * An illustrative network of locations across the country. Every coordinate is
 * a real settlement and resolves inside its correct district; all seven
 * provinces are represented.
 */
const LOCATIONS: Place[] = [
  // The Kathmandu valley, where a real network concentrates. Several of these
  // sit within a single 11 km dot and are expected to cluster.
  place(85.3095, 27.7154, "Thamel", "ठमेल"),
  place(85.311, 27.704, "New Road", "न्यूरोड"),
  place(85.34, 27.689, "Baneshwor", "बानेश्वर"),
  place(85.345, 27.718, "Chabahil", "चाबहिल"),
  place(85.281, 27.6935, "Kalanki", "कलंकी"),
  place(85.348, 27.678, "Koteshwor", "कोटेश्वर"),
  place(85.324, 27.667, "Lagankhel", "लगनखेल"),
  place(85.312, 27.673, "Jawalakhel", "जावलाखेल"),
  place(85.4298, 27.671, "Bhaktapur", "भक्तपुर"),
  place(83.9856, 28.2096, "Pokhara", "पोखरा"),
  place(87.2718, 26.4525, "Biratnagar", "विराटनगर"),
  place(84.88, 27.0104, "Birgunj", "विरगंज"),
  place(84.4333, 27.6833, "Bharatpur", "भरतपुर"),
  place(83.4484, 27.7006, "Butwal", "बुटवल"),
  place(87.2797, 26.8065, "Dharan", "धरान"),
  place(81.6167, 28.05, "Nepalgunj", "नेपालगंज"),
  place(80.5898, 28.6953, "Dhangadhi", "धनगढी"),
  place(85.925, 26.7288, "Janakpur", "जनकपुर"),
  place(85.0322, 27.4287, "Hetauda", "हेटौडा"),
  place(87.2718, 26.6646, "Itahari", "इटहरी"),
  place(83.45, 27.5, "Siddharthanagar", "सिद्धार्थनगर"),
  place(82.4879, 28.0334, "Ghorahi", "घोराही"),
  place(82.2975, 28.131, "Tulsipur", "तुलसीपुर"),
  place(81.6337, 28.6, "Birendranagar", "बिरेन्द्रनगर"),
  place(87.7, 26.66, "Damak", "दमक"),
  place(88.15, 26.64, "Kakarbhitta", "काँकडभिट्टा"),
  place(86.4833, 26.72, "Lahan", "लहान"),
  place(86.75, 26.54, "Rajbiraj", "राजविराज"),
  place(85.27, 26.77, "Gaur", "गौर"),
  place(85.0, 27.0333, "Kalaiya", "कलैया"),
  place(83.5892, 28.2719, "Baglung", "बाग्लुंग"),
  place(83.55, 27.8667, "Tansen", "तानसेन"),
  place(80.5833, 29.3, "Dadeldhura", "डडेलधुरा"),
  place(82.1833, 29.2747, "Jumla", "जुम्ला"),
  place(87.928, 26.9094, "Ilam", "ईलाम"),
  place(84.6333, 28.0, "Gorkha", "गोर्खा"),
  place(83.5667, 28.35, "Beni", "बेनी"),
  place(84.2333, 28.55, "Chame", "चामे"),
];

/** Province palette, legible on both themes. */
const PROVINCE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899",
];

// ------------------------------------------------------ illustrative data ---

/**
 * Made-up figures for the Data view, and labelled as such on the page.
 *
 * Generated rather than typed in so they have a believable shape — highest
 * around the cities, fading with distance — without anyone mistaking them for
 * real statistics. Seeded, so every visit draws the same map.
 */
const ILLUSTRATIVE = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // City, and how strongly it pulls: weights are invented for the demo.
  const pulls: [Place, number][] = [
    [KTM, 12], [HUBS[0], 6], [HUBS[1], 6], [HUBS[7], 4], [HUBS[2], 3], [HUBS[3], 3], [HUBS[5], 2],
    [HUBS[6], 1], ...LOCATIONS.filter((p) => ["Birgunj", "Butwal", "Janakpur", "Dharan", "Hetauda"].includes(p.label))
      .map((p) => [p, 3] as [Place, number]),
  ];
  const near = (at: LngLat, km: number) =>
    pulls.reduce((n, [p, w]) => n + w * Math.exp(-distanceKm(at, p) / km), 0);
  const orders = new Map<number, number>();
  const stores = new Map<number, number>();
  for (const d of DISTRICTS) {
    const bb = districtBbox(d.id)!;
    const at = d.hqAt ?? { lng: (bb.lo + bb.hi) / 2, lat: (bb.la + bb.ha) / 2 };
    orders.set(d.id, Math.round(4 + 9 * near(at, 45) * (0.8 + 0.4 * rnd())));
    stores.set(d.id, Math.round(2 + 14 * near(at, 70) * (0.7 + 0.6 * rnd())));
  }
  const customers: LngLat[] = [];
  for (const [p, w] of pulls) {
    const km = 3 + Math.sqrt(w) * 2.2;
    for (let i = 0; i < w * 140; i++) {
      customers.push({
        lng: p.lng + (gauss() * km) / (111.32 * Math.cos((p.lat * Math.PI) / 180)),
        lat: p.lat + (gauss() * km) / 111.32,
      });
    }
  }
  return { orders, stores, customers };
})();

// -------------------------------------------------------------- finder ---

/**
 * Devanagari typed into a search box is not reliably composed — the same
 * repair naksha's own `findDistrict` applies, so कोशी typed with a decomposed
 * vowel still matches the shipped name.
 */
const npKey = (s: string) => s.normalize("NFC").replace(/ाे/g, "ो").replace(/ाै/g, "ौ");

interface Entry {
  kind: "district" | "city";
  name: string;
  nameNp: string;
  /** The district this entry points at. */
  regionId: number;
  /**
   * Exact position, when the entry has one. 74 of the 77 district HQs now ship
   * a coordinate (`Region.hqAt`); the three without one — the districts created
   * by the 2015 Rukum and Nawalparasi splits — resolve to their district and
   * are pointed at through it.
   */
  at?: LngLat;
  /**
   * Both scripts in one string, space-joined. A match right after a space
   * counts as a prefix hit, so "east" ranks Rukum East as highly as "rukum"
   * does, and the Devanagari half is reachable by prefix too.
   */
  hay: string;
}

/**
 * Districts, then the demo's own places, then every district HQ.
 *
 * Order is the dedupe rule: a place that appears in more than one source is
 * kept from the first that has it, and the demo's places come before the bare
 * HQ names because they carry real coordinates.
 */
function buildIndex(): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<Entry, "hay">) => {
    const key = `${e.kind}:${e.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...e, hay: `${e.name.toLowerCase()} ${npKey(e.nameNp)}` });
  };

  for (const d of DISTRICTS)
    add({ kind: "district", name: d.name, nameNp: d.nameNp, regionId: d.id });

  for (const p of [KTM, ...HUBS, ...LOCATIONS]) {
    const d = districtAt(p);
    // A town sharing its district's name adds a duplicate row, not a place.
    if (!d || d.name.toLowerCase() === p.label.toLowerCase()) continue;
    add({
      kind: "city",
      name: p.label,
      nameNp: p.labelNp,
      regionId: d.id,
      at: { lng: p.lng, lat: p.lat },
    });
  }

  for (const d of DISTRICTS) {
    if (!d.hq || d.hq.toLowerCase() === d.name.toLowerCase()) continue;
    add({
      kind: "city",
      name: d.hq,
      nameNp: d.hqNp ?? d.hq,
      regionId: d.id,
      at: d.hqAt ?? undefined,
    });
  }

  return out;
}

const INDEX = buildIndex();
const CITY_COUNT = INDEX.filter((e) => e.kind === "city").length;

/** Up to `limit` matches, prefix hits first and districts ahead of cities. */
function search(query: string, limit = 8): Entry[] {
  const en = query.trim().toLowerCase();
  if (!en) return [];
  const np = npKey(query.trim());

  const hits: { e: Entry; rank: number }[] = [];
  for (const e of INDEX) {
    const a = e.hay.indexOf(en);
    const b = np === en ? -1 : e.hay.indexOf(np);
    const pos = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    if (pos < 0) continue;
    const prefix = pos === 0 || e.hay[pos - 1] === " ";
    hits.push({ e, rank: (prefix ? 0 : 100) + (e.kind === "district" ? 0 : 1) });
  }
  hits.sort((x, y) => x.rank - y.rank || x.e.name.localeCompare(y.e.name));
  return hits.slice(0, limit).map((h) => h.e);
}

// --------------------------------------------------------------- state ---

type Mode = "routes" | "network" | "districts" | "data" | "find";

const MODES: Mode[] = ["routes", "network", "districts", "data", "find"];

/** What the Data view puts on the dots. `both` is size and colour at once. */
type Encoding = "colour" | "size" | "both" | "density";
const ENCODINGS: Encoding[] = ["colour", "size", "both", "density"];

/** `?mode=data&encoding=density&scale=log&spread=smoothed` deep-links it. */
function initialEncoding(): Encoding {
  const requested = new URLSearchParams(location.search).get("encoding");
  return ENCODINGS.includes(requested as Encoding) ? (requested as Encoding) : "colour";
}

/**
 * How the map answers the pointer.
 *
 * `hover` and `click` are deliberately different mechanisms, not the same one
 * on a different event: hover paints the library's own overlay and touches
 * nothing else, while click stores a selection and re-renders with
 * `regionColor`. Switching between them shows both APIs and the cost of each —
 * the readout's build times don't move either way.
 */
type Interact = "hover" | "click" | "off";

const INTERACTIONS: Interact[] = ["hover", "click", "off"];

/** `?mode=find&q=Jumla&lang=np&interact=click` deep-links a demo view. */
function initialMode(): Mode {
  const requested = new URLSearchParams(location.search).get("mode");
  return MODES.includes(requested as Mode) ? (requested as Mode) : "routes";
}

function initialInteract(): Interact {
  const requested = new URLSearchParams(location.search).get("interact");
  return INTERACTIONS.includes(requested as Interact) ? (requested as Interact) : "hover";
}

function initialLang(): Lang {
  return new URLSearchParams(location.search).get("lang") === "np" ? "np" : "en";
}

/**
 * `?view=bagmati` opens on a viewport other than the whole country.
 *
 * Zoom here is the library's own: a bounding box, not a scale factor. Each
 * option re-samples its own box at the same dot budget, so the dot count and
 * the render cost stay flat while the ground resolution changes by 40x.
 */
function initialView(): ViewName {
  const requested = new URLSearchParams(location.search).get("view");
  return requested && requested in VIEWS ? (requested as ViewName) : "nepal";
}

/**
 * `?overview=always|zoomed|off` controls the overview map.
 *
 * Three options because there are three defensible answers and the choice is
 * the consumer's, not the library's: an overview is a second render, so showing
 * it is a decision about the surrounding page rather than about the map.
 * `always` is the default here — it is the one that shows what the feature is.
 */
type Overview = "always" | "zoomed" | "off";

const OVERVIEWS: Overview[] = ["always", "zoomed", "off"];

function initialOverview(): Overview {
  const requested = new URLSearchParams(location.search).get("overview");
  return OVERVIEWS.includes(requested as Overview) ? (requested as Overview) : "always";
}

/**
 * `?corner=top-right|top-left|bottom-right|bottom-left` moves the overview.
 *
 * A demo control rather than a library option, and deliberately so: the
 * overview here is its own element, so where it sits is a CSS class and nothing
 * the renderer knows about. The library's own `inset` option is the other
 * answer — it puts a miniature inside the SVG itself, which is what you want
 * when there is no DOM to position.
 */
type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

const CORNERS: Corner[] = ["top-right", "top-left", "bottom-right", "bottom-left"];

function initialCorner(): Corner {
  const requested = new URLSearchParams(location.search).get("corner");
  return CORNERS.includes(requested as Corner) ? (requested as Corner) : "top-right";
}

/** Highlight granularity — the library's `HighlightOptions.mode`. */
type Highlight = "dot" | "region";

const HIGHLIGHTS: Highlight[] = ["dot", "region"];

function initialHighlight(): Highlight {
  const requested = new URLSearchParams(location.search).get("highlight");
  return HIGHLIGHTS.includes(requested as Highlight) ? (requested as Highlight) : "dot";
}

const PLACEMENTS: LabelPlacement[] = ["above", "avoid-region", "clear", "none"];

function initialPlacement(): LabelPlacement {
  const requested = new URLSearchParams(location.search).get("labels");
  return PLACEMENTS.includes(requested as LabelPlacement)
    ? (requested as LabelPlacement)
    : "above";
}

/**
 * `?context=on` paints the district behind a place hit.
 *
 * Off by default: a place hit is one coordinate, and colouring the ~40 dots
 * around it states something the search did not ask about.
 */
function initialContext(): boolean {
  return new URLSearchParams(location.search).get("context") === "on";
}

/** A `?q=` that matches something selects it outright, so links land on a place. */
function initialFind(): Entry | null {
  const q = new URLSearchParams(location.search).get("q");
  return q ? (search(q, 1)[0] ?? null) : null;
}

/** What a click has pinned. Hover state is transient and never lives here. */
type Selection =
  | { kind: "region"; id: number; dot: Dot }
  | { kind: "cluster"; cluster: Cluster }
  | { kind: "route"; index: number }
  | null;

const state = {
  mode: initialMode(),
  accent: "#dc2626",
  /**
   * The base dot colour, or `null` to follow the page theme's own.
   *
   * The sentinel is the point: light and dark ship different defaults, so a
   * dot colour that were merely *initialised* from the current theme would
   * freeze at the first one and stop tracking the toggle. Once picked, the
   * choice is explicit and deliberately survives a theme switch.
   */
  dot: null as string | null,
  /** Label text colour, null to follow the page theme. See `wireColor`. */
  labelColor: null as string | null,
  /** Leader-line colour, null to follow the page theme. */
  leader: null as string | null,
  /**
   * Which label-placement rule to render with. The alternatives stay switchable
   * so the trade-off can be seen rather than argued about: `above` erases a
   * mean of 12 dots per label, and every rule that fixes that pays for it in
   * distance from the pin.
   */
  placement: initialPlacement(),
  /**
   * Whether a place hit in the find view also paints its district.
   *
   * A district hit ignores this and always paints: there its dots *are* the
   * answer. For a place the district is background, and background that shares
   * the accent colour with the pin reads as part of the selection.
   */
  context: initialContext(),
  /** The Data view's encoding, colour scale and density smoothing. */
  encoding: initialEncoding(),
  scale: new URLSearchParams(location.search).get("scale") === "log" ? ("log" as const) : ("quantile" as const),
  spread: new URLSearchParams(location.search).get("spread") === "smoothed" ? 1 : 0,
  lang: initialLang(),
  /**
   * The bounding box the grid samples — the whole of zoom, since a viewport
   * here is a box and never a scale factor (spec §6).
   *
   * Free-form rather than a `ViewName`: the named views are starting points on
   * a ladder the zoom buttons then step off. `syncView` puts the select back in
   * step, or marks it Custom when the box no longer matches any of them.
   */
  bbox: VIEWS[initialView()] as Bbox,
  /**
   * The box whose dot lattice the field is sampled on.
   *
   * Re-pinned by every zoom, named view and reset — anything that rebuilds the
   * map — and deliberately *not* by a drag. Holding it still through a drag is
   * what lets the viewport slide between dots: the dots keep their ground
   * positions, the silhouette translates rather than re-forming, and the map
   * glides instead of stepping a whole dot at a time.
   */
  lattice: VIEWS[initialView()] as Bbox,
  find: initialFind() as Entry | null,
  /** Whether the overview map is drawn. See `initialOverview`. */
  overview: initialOverview(),
  /** Which corner of the stage it sits in. See `initialCorner`. */
  corner: initialCorner(),
  interact: initialInteract(),
  /**
   * Whether a hit lights one dot or the whole district around it.
   *
   * Both are real library modes and they answer different questions, so the
   * choice is the page's rather than baked in. `dot` is the default because it
   * is the only one that shows *which* dot the readout is quoting a coordinate
   * for; `region` answers "what am I pointing at" and says nothing about where
   * inside the district the pointer is.
   */
  highlight: initialHighlight(),
  selected: null as Selection,
};

const raster = nepalRaster();

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const stage = $<HTMLElement>("#stage");
const readout = $<HTMLElement>("#readout");
const hint = $<HTMLElement>("#hint");
const minimap = $<HTMLElement>("#minimap");
const minimapMap = $<HTMLElement>("#minimap-map");

// Dark is the base theme, so anything that is not an explicit "light" is dark —
// including the attribute being absent, which is what a visitor sees if the
// boot script threw on a blocked localStorage.
const isDark = () => document.documentElement.dataset.theme !== "light";

// The renderer takes hex strings, so map colours would otherwise be duplicated
// between here and the stylesheet — and a CSS edit would silently do nothing.
// Read them back from the custom properties instead, one source of truth.
const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** `#rrggbb` -> `#rrggbbaa`. Any other notation is returned untouched. */
const fade = (color: string, alpha: number) =>
  /^#[0-9a-f]{6}$/i.test(color)
    ? color +
      Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")
    : color;

function mapTheme(background: string): Partial<Theme> {
  const dark = isDark();
  return {
    ...(dark ? darkTheme : lightTheme),
    background,
    dot: state.dot ?? defaultDot(),
    route: state.accent,
    pin: state.accent,
    cluster: state.accent,
    // The halo punches a hole in the dot field so a pin reads cleanly, which
    // only works if it is the surface actually behind the map: the page when
    // the SVG background is transparent, the given background otherwise.
    pinHalo:
      background === "transparent" ? cssVar("--ground", dark ? "#080b12" : "#eeeff0") : background,
    label: state.labelColor ?? cssVar("--text", dark ? "#e9eef8" : "#0f172a"),
    leader: state.leader ?? cssVar("--text", dark ? "#e9eef8" : "#0f172a"),
  };
}

/**
 * The dot colour when none has been picked.
 *
 * The page's blue everywhere except the density view, where it would sit
 * inside the shading ramp and an empty dot would read as a value. There it is
 * the theme's own neutral, so "no customers" looks like nothing at all.
 */
function defaultDot(): string {
  const dark = isDark();
  if (state.mode === "data" && state.encoding === "density") return (dark ? darkTheme : lightTheme).dot;
  return cssVar("--map-dot", dark ? "#6092d7" : "#6a6b6c");
}

/**
 * The dots the viewBox actually shows.
 *
 * A dot owns the cell `[col, col+1]` and is drawn at its centre, so it is on
 * screen when that centre falls inside the window. Everything else in the
 * field is the one-dot margin `align` samples so the viewport can slide
 * between dots, and the viewBox clips it.
 */
function visibleDots(grid: Grid): Dot[] {
  const { x, y, cols, rows } = grid.viewBox;
  return grid.dots.filter(
    (d) =>
      d.col + 0.5 >= x && d.col + 0.5 <= x + cols && d.row + 0.5 >= y && d.row + 0.5 <= y + rows,
  );
}

/** Which views ask the renderer for labels — see `render`. */
const drawsLabels = () => state.mode === "routes" || state.mode === "find";

/**
 * Radius of a highlighted dot, in dot units.
 *
 * Noticeably fatter than the theme's 0.3, not just recoloured: in the districts
 * view the accent lands on a palette that already contains a red, and a
 * same-size colour swap is ambiguous. Swelling is not.
 *
 * Shared, because the hover overlay and the pinned marker are the same gesture
 * seen twice — if they drifted apart in size, clicking a dot would appear to
 * move it.
 */
const HIGHLIGHT_RADIUS = 0.44;

// --------------------------------------------------------------- render ---

function render() {
  const t0 = performance.now();
  const grid = buildGrid(raster, { bbox: state.bbox, align: state.lattice });
  const gridMs = performance.now() - t0;

  let routes: Route[] = [];
  let points: MapPoint[] = [];
  let regionColor: ((id: number) => string | undefined) | undefined;
  let regionRadius: RenderOptions["regionRadius"];
  let density: RenderOptions["density"];
  const legend: Legend[] = [];
  let labels = false;

  if (state.mode === "routes") {
    routes = HUBS.map((h) => ({ stops: [KTM, h], label: `Kathmandu – ${h.label}` }));
    points = [KTM, ...HUBS];
    labels = true;
  } else if (state.mode === "network") {
    points = LOCATIONS;
  } else if (state.mode === "districts") {
    regionColor = (id) => {
      const d = districtById(id);
      return d ? PROVINCE_COLORS[(d.province - 1) % 7] : undefined;
    };
  } else if (state.mode === "data") {
    const { orders, stores, customers } = ILLUSTRATIVE;
    if (state.encoding === "size" || state.encoding === "both") {
      const size = sizeScale(stores.values());
      regionRadius = (id) => size.radius(stores.get(id));
      legend.push(size.legend("Stores"));
    }
    if (state.encoding === "colour" || state.encoding === "both") {
      // The dark ramp runs the other way, so low values sink into the panel.
      const colour = colorScale(orders.values(), {
        mode: state.scale,
        colors: (isDark() ? darkTheme : lightTheme).ramp,
      });
      regionColor = (id) => colour.color(orders.get(id));
      legend.push(colour.legend("Orders per 1,000 people"));
    }
    if (state.encoding === "density") {
      density = { points: customers, spread: state.spread, legend: "Customers per dot" };
    }
  } else {
    const sel = state.find;
    const region = sel ? districtById(sel.regionId) : undefined;
    if (sel && region) {
      // A district hit is its district — the dots are what was searched for.
      // A place hit is a single coordinate, so the district is drawn only when
      // asked for, and then it is context rather than the answer.
      const withRegion = sel.kind === "district" || state.context;
      if (withRegion) regionColor = (id) => (id === sel.regionId ? state.accent : undefined);
      // A city with a coordinate is pinned where it is; one without — every
      // district HQ — is pointed at through its district's own dot.
      // `regionAnchor` returns the whole Dot; the pin only wants where it is.
      const anchor = regionAnchor(grid, sel.regionId);
      const at = sel.at ?? (anchor && { lng: anchor.lng, lat: anchor.lat });
      if (at) {
        // `describePlace` composes "Lahan, Siraha" from the point and the
        // district under it. A district entry carries no separate place name,
        // so it resolves to the district alone rather than doubling up — and a
        // place drawn without its district drops it from the name too, so the
        // label names exactly what is coloured.
        const named = { ...at, label: sel.name, labelNp: sel.nameNp };
        const name = (lang: Lang) =>
          sel.kind !== "city"
            ? describePlace(at, { lang })
            : withRegion
              ? describePlace(named, { lang })
              : pickLabel(named, lang);
        points = [{ ...at, label: name("en"), labelNp: name("np") }];
        labels = true;
      }
    }
  }

  const panel = cssVar("--panel", isDark() ? "#0e131d" : "#f7f7f8");
  const theme = mapTheme(panel);

  // A clicked district paints over whatever the view was already colouring by,
  // and everything else recedes. Recolouring alone is not enough here: the
  // province palette already contains a red, so an accent-red district next to
  // Koshi is a guessing game. Dimming the rest states the selection outright.
  //
  // Only at district granularity: a dot-granular pin is a claim about one dot,
  // and painting its district would overstate it by ~15 dots. That pin is drawn
  // by `markPinnedDot` once the SVG is in the page.
  //
  // Not in the density view, where a density colour outranks `regionColor`:
  // the shaded dots, the ones carrying the data, would stay at full strength
  // while only the empty ones faded. `veilOthers` dims the rest there instead.
  const picked =
    state.highlight === "region" && state.selected?.kind === "region" ? state.selected.id : null;
  if (picked !== null && !density) {
    const base = regionColor;
    regionColor = (id) =>
      id === picked ? state.accent : fade(base?.(id) ?? theme.dot!, 0.22);
  }

  const t1 = performance.now();
  const svg = renderSvg(grid, {
    theme,
    routes,
    points,
    regionColor,
    regionRadius,
    density,
    legend,
    labels,
    labelPlacement: state.placement,
    lang: state.lang,
    animate: state.mode === "routes",
    title: describe(),
  });
  const renderMs = performance.now() - t1;

  // Keep keyboard focus across the re-render.
  const hadFocus = stage.contains(document.activeElement);
  stage.innerHTML = svg;
  markPinnedDot(regionRadius);
  if (picked !== null && density) veilOthers(grid, picked, panel);

  const { clusters, offscreen } = clusterPoints(grid, points);
  const nodes = stage.querySelectorAll("*").length;
  const fmt = (n: number) => n.toLocaleString();

  // An aligned field runs a dot past each edge so the viewport can sit between
  // dots, and those dots are clipped by the viewBox. Counting them would put a
  // district in the "in view" tally that is not on screen, and inflate the dot
  // count by the margin — so the readout counts the window, not the field.
  const seen = visibleDots(grid);
  const dotCount = seen.length;
  const regionCount = new Set(seen.map((d) => d.region)).size;

  let rows: [string, string][];
  if (state.mode === "routes") {
    rows = [
      ["Routes", `${routes.length}`],
      ["Destinations", `${HUBS.length}`],
      ["Dots", fmt(dotCount)],
      ["DOM nodes", fmt(nodes)],
      ["Grid build", `${gridMs.toFixed(1)} ms`],
      ["SVG build", `${renderMs.toFixed(1)} ms`],
    ];
  } else if (state.mode === "network") {
    // Folded from 0 rather than `Math.max(...[])`, which is -Infinity: zoom
    // into a corner of Karnali and the readout shipped "Largest cluster
    // -Infinity" the moment the last location left the viewport.
    const busiest = clusters.reduce((n, c) => Math.max(n, c.points.length), 0);
    rows = [
      ["Locations", `${LOCATIONS.length}`],
      ["Dots used", `${clusters.length}`],
      ["Largest cluster", `${busiest}`],
      ["DOM nodes", fmt(nodes)],
      ["Grid build", `${gridMs.toFixed(1)} ms`],
      ["SVG build", `${renderMs.toFixed(1)} ms`],
    ];
  } else if (state.mode === "data") {
    rows = [
      ["Encoding", { colour: "Colour", size: "Size", both: "Both", density: "Density" }[state.encoding]],
      state.encoding === "density"
        ? ["Customers", fmt(ILLUSTRATIVE.customers.length)]
        : ["Districts", `${DISTRICTS.length}`],
      ["Dot paths", fmt(stage.querySelectorAll(".naksha-dots path").length)],
      ["DOM nodes", fmt(nodes)],
      ["Grid build", `${gridMs.toFixed(1)} ms`],
      ["SVG build", `${renderMs.toFixed(1)} ms`],
    ];
  } else if (state.mode === "districts") {
    rows = [
      ["Districts", `${regionCount}`],
      ["Provinces", "7"],
      ["Dots", fmt(dotCount)],
      ["DOM nodes", fmt(nodes)],
      ["Grid build", `${gridMs.toFixed(1)} ms`],
      ["SVG build", `${renderMs.toFixed(1)} ms`],
    ];
  } else {
    const sel = state.find;
    const d = sel ? districtById(sel.regionId) : undefined;
    rows = d
      ? [
          ["Selected", sel!.kind === "district" ? "District" : "City"],
          ["District", regionName(d, state.lang)],
          ["Province", regionProvince(d, state.lang)],
          ["HQ", (state.lang === "np" ? (d.hqNp ?? d.hq) : d.hq) ?? "—"],
          ["P-code", d.pcode ?? "—"],
          ["Position", sel!.at ? "exact" : "district"],
        ]
      : [
          ["Districts", `${DISTRICTS.length}`],
          ["Places", `${CITY_COUNT}`],
          ["Scripts", "2"],
          ["Dots", fmt(dotCount)],
          ["Grid build", `${gridMs.toFixed(1)} ms`],
          ["SVG build", `${renderMs.toFixed(1)} ms`],
        ];
  }

  // Viewport rows go last and are the same in every view, so the effect of
  // changing the box can be read off one place: the ground resolution moves by
  // 40x across the ladder while the dot count above barely moves at all.
  rows.push(["km/dot", grid.kmPerDot.toFixed(2)]);
  rows.push(["Districts in view", `${regionCount}`]);
  if (points.length) {
    rows.push(["Off-screen", `${offscreen.length} of ${points.length}`]);
  }

  readout.innerHTML = rows.map(([k, v]) => `<div><k>${k}</k><v>${v}</v></div>`).join("");
  // Raw counts per dot, so a hover can say how many customers a dot holds even
  // when the shading is smoothed.
  customersOnDot =
    state.mode === "data" && state.encoding === "density"
      ? new Map(clusterPoints(grid, ILLUSTRATIVE.customers).clusters.map((c) => [c.row * grid.cols + c.col, c.count]))
      : null;
  lastCounts = { shown: points.length - offscreen.length, dots: clusters.length };
  hint.innerHTML = state.selected ? describeSelection() : defaultHint();
  renderMinimap(theme);
  attach(grid, points, routes, regionRadius);
  if (hadFocus) stage.querySelector("svg")?.focus({ preventScroll: true });
}

function describe(): string {
  if (state.mode === "routes") return "Routes radiating from Kathmandu";
  if (state.mode === "network") return "A network of locations across Nepal";
  if (state.mode === "districts") return "Districts of Nepal, coloured by province";
  if (state.mode === "data") return "Illustrative values by district";
  const d = state.find ? districtById(state.find.regionId) : undefined;
  return d ? `${state.find!.name} in ${d.name} district` : "Find a district or place";
}

/**
 * How to drive the map right now, appended to every view's own line.
 *
 * Kept to one short clause: this line sits above the map and its height is
 * reserved, so every word costs vertical space whether or not it is being used.
 */
function verb(): string {
  if (state.interact === "off") return "";
  // On a touch device "hover" and "arrow keys" are advice that cannot be
  // followed, so the short form is both accurate and a line shorter.
  if (matchMedia("(hover: none)").matches) {
    return ` <span class="alt-script">Tap a dot, pin or route. Double-tap a district to zoom to it.</span>`;
  }
  const how = state.interact === "hover" ? "Hover" : "Click";
  return (
    ` <span class="alt-script">${how} a dot, pin or route — or use the arrow keys. ` +
    `Double-click a district to zoom to it.</span>`
  );
}

function defaultHint(): string {
  if (state.mode === "network") {
    const { shown, dots } = lastCounts;
    // Counted against what is drawn, not against the whole set. A point outside
    // the viewport is on no dot at all, so charging it to the overlap turned
    // zooming *in* — the thing that separates locations — into a claim that
    // more of them were colliding: at the tightest view the line read "38
    // locations occupy 0 dots — 38 share one with a neighbour", and the
    // readout beside it said "Largest cluster -Infinity".
    if (shown === 0) {
      return (
        `<b>None of the ${LOCATIONS.length} locations</b> are in this viewport — ` +
        `zoom out to bring them back.` + verb()
      );
    }
    const where =
      shown < LOCATIONS.length
        ? `<b>${shown} of ${LOCATIONS.length} locations</b> are in view on`
        : `<b>${LOCATIONS.length} locations</b> across all seven provinces occupy`;
    return (
      `${where} <b>${dots} dots</b> — ${shown - dots} share one with a neighbour, and ` +
      `the badge reports it rather than hiding the overlap.` + verb()
    );
  }
  if (state.mode === "data") {
    const what = {
      colour: "Each district's dots are coloured by its value, with a legend built from the same scale.",
      size: "Dot <em>area</em> grows with each district's value — area, because that is what the eye compares.",
      both: "Two values on the same dots: size shows one, colour the other.",
      density:
        state.spread > 0
          ? "Each customer is spread over the dots around it, which reads as a heatmap but shades dots that hold no customer of their own."
          : "Each dot is shaded by how many customers snap to it, on a log scale. Zoom in and they spread over finer dots.",
    }[state.encoding];
    return `${what} <span class="alt-script">Illustrative data, generated for this demo.</span>` + verb();
  }
  if (state.mode === "districts") {
    return (
      `Colour is by province, but the grid carries <em>district</em> identity. Hits resolve from ` +
      `the pointer's cell, not from the DOM — so interaction adds no per-dot elements.` + verb()
    );
  }
  if (state.mode === "find") {
    const sel = state.find;
    if (!sel) {
      return (
        `Search <b>${DISTRICTS.length} districts</b> and <b>${CITY_COUNT} places</b> in either script — ` +
        `try <b>Jumla</b>, <b>काठमाडौँ</b> or <b>Chandannath</b>.` + verb()
      );
    }
    const d = districtById(sel.regionId);
    if (!d) return "";
    const district = `<b>${regionName(d, state.lang)}</b> district, ${regionProvince(d, state.lang)}`;
    if (sel.kind === "district") {
      return `${district} — p-code ${d.pcode}, HQ ${state.lang === "np" ? (d.hqNp ?? d.hq) : d.hq}. Every dot shown is one <code>districtAt()</code> lookup.`;
    }
    const primary = state.lang === "np" ? sel.nameNp : sel.name;
    return sel.at
      ? `<b>${primary}</b> sits in ${district} — pinned at its own coordinate, then snapped to the nearest dot.`
      : `<b>${primary}</b> is the HQ of ${district}. naksha ships a coordinate for 74 of the 77 HQs; this district was created by the 2015 split and the upstream point set predates it, so this points at the district rather than faking a position.`;
  }
  return (
    `Arc height scales with <b>√distance</b> — HQ-to-HQ distances span 253×, so a linear ` +
    `rule would flatten the short hops and balloon the long ones.` +
    verb()
  );
}

// --------------------------------------------------------- interaction ---

/**
 * Kept so a hover that ends can restore the view's own default line.
 *
 * Both halves, not just the dot count: the network line subtracts one from the
 * other, and the subtraction is only true of the points actually on the map.
 */
let lastCounts = { shown: 0, dots: 0 };

/**
 * A pasteable `points` entry for a dot's centre.
 *
 * Four decimals is ~11 m, far finer than it needs to be: the grid is ~11 km
 * per dot, so any coordinate within about 5 km of here snaps to this same dot.
 * That is what makes copying it useful — a village naksha has never heard of
 * needs nothing more accurate than this to land on the dot you just clicked.
 */
const coordLiteral = (dot: Dot) => `{ lng: ${dot.lng.toFixed(4)}, lat: ${dot.lat.toFixed(4)} }`;

/**
 * Draw the pinned dot, when a pin means one dot rather than a district.
 *
 * The dot field collapses to one `<path>` per colour, so there is no per-dot
 * element to recolour and `regionColor` cannot express a single dot — it is
 * keyed by region. One `<circle>` can: the viewBox is `0 0 cols rows`, so the
 * cell centre of a dot is exactly `col + 0.5, row + 0.5`.
 *
 * Inserted directly above the dot field rather than appended, so a pin or route
 * crossing the same cell still paints over it — the same order the library's own
 * highlight overlay uses.
 *
 * A dot sized by value is lifted in proportion to its own size, by the same
 * rule the library's overlay follows, so hover and pin still match in the size
 * view and a small district's pin doesn't swell it to the largest.
 */
function markPinnedDot(regionRadius: RenderOptions["regionRadius"]) {
  const sel = state.selected;
  if (state.highlight !== "dot" || sel?.kind !== "region") return;
  const dots = stage.querySelector(".naksha-dots");
  if (!dots?.parentNode) return;
  const sized = regionRadius?.(sel.dot.region);
  const r = sized === undefined ? HIGHLIGHT_RADIUS : (sized * HIGHLIGHT_RADIUS) / lightTheme.dotRadius;
  if (!(r > 0)) return;

  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("cx", String(sel.dot.col + 0.5));
  el.setAttribute("cy", String(sel.dot.row + 0.5));
  el.setAttribute("r", String(r));
  el.setAttribute("fill", state.accent);
  // The dot underneath is still the hit target; this is only paint.
  el.setAttribute("pointer-events", "none");
  dots.parentNode.insertBefore(el, dots.nextSibling);
}

/**
 * Dim every district but the picked one, in the density view.
 *
 * Panel colour at 78% over a dot mixes it to exactly what `fade(color, 0.22)`
 * gives the other views, while leaving the picked district's shading, and the
 * legend describing it, as they were.
 */
function veilOthers(grid: Grid, picked: number, panel: string) {
  const dots = stage.querySelector(".naksha-dots");
  if (!dots?.parentNode) return;
  // A hair wider than the dots, or their anti-aliased rims show through as rings.
  const r = lightTheme.dotRadius + 0.03;
  const n = (v: number) => +v.toFixed(3);
  const d = grid.dots
    .filter((dot) => dot.region !== picked)
    .map((dot) => `M${n(dot.col + 0.5 - r)} ${n(dot.row + 0.5)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0`)
    .join("");

  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", d);
  el.setAttribute("fill", panel);
  el.setAttribute("fill-opacity", "0.78");
  el.setAttribute("pointer-events", "none");
  dots.parentNode.insertBefore(el, dots.nextSibling);
}

/** Raw customer counts per dot in the density view, keyed like `dotIndex`. */
let customersOnDot: Map<number, number> | null = null;

/** The Data view's figure for whatever is under the pointer, or "". */
function describeValue(dot: Dot): string {
  if (state.mode !== "data") return "";
  if (state.encoding === "density") {
    const n = customersOnDot?.get(dot.row * (currentGrid?.cols ?? 0) + dot.col) ?? 0;
    return ` · <b>${n.toLocaleString()}</b> customer${n === 1 ? "" : "s"} on this dot`;
  }
  const parts: string[] = [];
  if (state.encoding !== "size") parts.push(`<b>${formatValue(ILLUSTRATIVE.orders.get(dot.region) ?? 0)}</b> orders per 1,000`);
  if (state.encoding !== "colour") parts.push(`<b>${ILLUSTRATIVE.stores.get(dot.region) ?? 0}</b> stores`);
  return ` · ${parts.join(", ")}`;
}

function describeRegion(dot: Dot): string {
  const d = districtById(dot.region);
  if (!d) return "";
  // Show the other script alongside, so the map is legible either way.
  const primary = regionName(d, state.lang);
  const secondary = state.lang === "np" ? d.name : d.nameNp;
  return (
    `<b>${primary}</b> <span class="alt-script">${secondary}</span> — ` +
    `${regionProvince(d, state.lang)}, p-code ${d.pcode}` +
    (d.hq ? `, HQ ${state.lang === "np" ? (d.hqNp ?? d.hq) : d.hq}` : "") +
    describeValue(dot) +
    ` · dot at ${dot.lat.toFixed(2)}°N ${dot.lng.toFixed(2)}°E`
  );
}

function describeCluster(cluster: Cluster): string {
  const names = cluster.points.map((p) => pickLabel(p, state.lang)).join(", ");
  const district = districtAt(cluster.points[0]);
  return cluster.points.length > 1
    ? `<b>${cluster.points.length} locations</b> on one dot: ${names}. They are within ~11 km of each other, so a national view cannot separate them — the badge says so rather than hiding it.`
    : `<b>${names}</b> — ${district ? regionName(district, state.lang) : "unknown"} district, ` +
        `${district ? regionProvince(district, state.lang) : "?"}.`;
}

function describeRoute(route: Route, index: number): string {
  const [from, to] = [route.stops[0], route.stops[route.stops.length - 1]];
  const km = distanceKm(from, to);
  return (
    `<b>${route.label ?? `Route ${index + 1}`}</b> — ${km.toFixed(0)} km apart, drawn as ` +
    `one quadratic arc bowed by √distance. naksha has no idea whether anything travels it.`
  );
}

/** The persistent line for whatever a click pinned. */
function describeSelection(): string {
  const sel = state.selected;
  if (!sel) return defaultHint();
  if (sel.kind === "cluster") return describeCluster(sel.cluster);
  if (sel.kind === "route") {
    const route = currentRoutes[sel.index];
    return route ? describeRoute(route, sel.index) : defaultHint();
  }
  if (!districtById(sel.id)) return defaultHint();
  // The dot that was actually clicked, not the district's first — the line
  // quotes a coordinate, and quoting a different one would be a small lie.
  return (
    describeRegion(sel.dot) +
    ` <button type="button" class="linkish" data-copy="${coordLiteral(sel.dot)}">copy</button>` +
    ` <span class="alt-script">— pinned. Click elsewhere to change it, or off Nepal to clear.</span>`
  );
}

/**
 * Copy the pinned dot's coordinate.
 *
 * Delegated to the container because the hint's innerHTML is replaced on every
 * render and every hover, so a listener bound to the button would not survive
 * the next one. Only the *pinned* line carries the button: in hover mode,
 * reaching for it would leave the SVG and clear the line under the pointer.
 */
hint.addEventListener("click", async (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>("button[data-copy]");
  const text = btn?.dataset.copy;
  if (!btn || !text) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "copied";
  } catch {
    // Needs a secure context and permission. Show the value instead, so it can
    // still be selected by hand rather than failing silently.
    btn.textContent = text;
  }
});

let detach: (() => void) | null = null;
let currentGrid: Grid | null = null;
let currentRoutes: Route[] = [];

/**
 * Rewire the freshly rendered SVG.
 *
 * `render()` replaces the element wholesale, so the previous listeners go with
 * it — but the highlight overlay and the cursor are ours, so detach properly
 * rather than relying on that.
 */
function attach(grid: Grid, points: MapPoint[], routes: Route[], regionRadius: RenderOptions["regionRadius"]) {
  detach?.();
  detach = null;
  currentGrid = grid;
  currentRoutes = routes;

  const svg = stage.querySelector("svg");
  if (!svg || state.interact === "off") return;

  const restore = () => {
    hint.innerHTML = state.selected ? describeSelection() : defaultHint();
  };

  if (state.interact === "hover") {
    detach = attachInteractions(svg, grid, {
      points,
      routes,
      keyboard: true,
      // Coarse pointers get a wider net; a fingertip covers several cells.
      tolerance: matchMedia("(pointer: coarse)").matches ? 1 : 0,
      highlight: { color: state.accent, radius: HIGHLIGHT_RADIUS, mode: state.highlight },
      regionRadius,
      // The dot events, not the region ones: the line quotes a coordinate, and
      // `onRegionEnter` would only fire on the district's first dot — so the
      // coordinate would stick there while the pointer moved on.
      onDotEnter: (dot) => (hint.innerHTML = describeRegion(dot)),
      onDotLeave: restore,
      onPointEnter: (cluster) => (hint.innerHTML = describeCluster(cluster)),
      onPointLeave: restore,
      onRouteEnter: (route, i) => (hint.innerHTML = describeRoute(route, i)),
      onRouteLeave: restore,
    });
    return;
  }

  // Click mode. No hover overlay: the selection is baked into the next render
  // instead — through `regionColor` at district granularity, which is the API a
  // real app would reach for (`veilOthers` in the density view, where density
  // outranks it), and through `markPinnedDot` at dot granularity, which is what
  // `regionColor` cannot say.
  const release = attachInteractions(svg, grid, {
    points,
    routes,
    keyboard: true,
    tolerance: matchMedia("(pointer: coarse)").matches ? 1 : 0,
    onRegionClick: (dot) => {
      // In the finder, clicking a district *is* a search result — the two
      // ways of selecting one should not disagree about what is selected.
      if (state.mode === "find") {
        const entry = INDEX.find((e) => e.kind === "district" && e.regionId === dot.region);
        if (entry) {
          state.find = entry;
          input.value = state.lang === "np" ? entry.nameNp : entry.name;
          state.selected = null;
          render();
          return;
        }
      }
      state.selected = { kind: "region", id: dot.region, dot };
      render();
    },
    onPointClick: (cluster) => {
      state.selected = { kind: "cluster", cluster };
      render();
    },
    onRouteClick: (_route, index) => {
      state.selected = { kind: "route", index };
      render();
    },
  });

  // A click that lands on nothing clears the selection, so there is always a
  // way out that doesn't involve hunting for the right dot.
  const clearOnMiss = (e: MouseEvent) => {
    const el = e.target as Element;
    if (el.closest("[data-cluster]") || el.closest("[data-route-index]")) return;
    if (hitTestedSomething(e)) return;
    state.selected = null;
    render();
  };
  svg.addEventListener("click", clearOnMiss);
  detach = () => {
    release();
    svg.removeEventListener("click", clearOnMiss);
  };
}

/** True when the click landed on a dot — reuses the SVG's own coordinate space. */
function hitTestedSomething(e: MouseEvent): boolean {
  const svg = stage.querySelector("svg");
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm || !currentGrid) return false;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return !!hitTest(currentGrid, p.x, p.y);
}

// ------------------------------------------------------------ controls ---

$("#mode").addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("button");
  const value = btn?.getAttribute("data-mode");
  if (!btn || !value) return;
  state.mode = value as Mode;
  state.selected = null; // a district pinned in one view means nothing in the next
  $("#mode")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b === btn));
  syncFinder();
  syncColors();
  syncPlacement();
  syncContext();
  syncData();
  render();
  if (state.mode === "find") input.focus();
});

$("#interact").addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("button");
  const value = btn?.getAttribute("data-interact");
  if (!btn || !value) return;
  state.interact = value as Interact;
  state.selected = null;
  $("#interact")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b === btn));
  syncHighlight();
  render();
});

// -------------------------------------------------------------- finder ---

const finder = $<HTMLElement>("#finder");
const input = $<HTMLInputElement>("#find-input");
const results = $<HTMLElement>("#find-results");

let matches: Entry[] = [];
let active = -1;

const syncFinder = () => {
  finder.hidden = state.mode !== "find";
};

function closeResults() {
  results.hidden = true;
  results.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  matches = [];
  active = -1;
}

function showResults(query: string) {
  matches = search(query);
  active = matches.length ? 0 : -1;
  if (!matches.length) {
    // textContent, not innerHTML: this is the one string here the visitor typed.
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = `No district or place matches “${query.trim()}”.`;
    results.replaceChildren(empty);
    input.removeAttribute("aria-activedescendant");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
    return;
  }
  results.innerHTML = matches
    .map((m, i) => {
      const d = districtById(m.regionId)!;
      const primary = state.lang === "np" ? m.nameNp : m.name;
      const secondary = state.lang === "np" ? m.name : m.nameNp;
      const context =
        m.kind === "district"
          ? regionProvince(d, state.lang)
          : `${regionName(d, state.lang)} district`;
      return (
        `<li role="option" id="find-opt-${i}" data-i="${i}" aria-selected="${i === active}"` +
        `${i === active ? ' class="active"' : ""}>` +
        `<span class="nm">${primary}</span> <span class="alt">${secondary}</span>` +
        `<span class="ctx">${context}</span>` +
        `<span class="tag">${m.kind === "district" ? "district" : m.at ? "place" : "HQ"}</span>` +
        `</li>`
      );
    })
    .join("");
  results.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", `find-opt-${active}`);
}

function choose(i: number) {
  const m = matches[i];
  if (!m) return;
  state.find = m;
  // Searching and clicking are two routes to the same selection; whichever
  // acted last wins, rather than leaving two highlights disagreeing.
  state.selected = null;
  input.value = state.lang === "np" ? m.nameNp : m.name;
  closeResults();
  // Whether the toggle applies depends on what was just chosen.
  syncContext();
  render();
}

input.addEventListener("input", () => {
  const q = input.value;
  if (!q.trim()) {
    state.find = null;
    state.selected = null;
    closeResults();
    syncContext();
    render();
    return;
  }
  showResults(q);
});

input.addEventListener("keydown", (e) => {
  if (results.hidden || !matches.length) {
    if (e.key === "ArrowDown" && input.value.trim()) showResults(input.value);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
    results.querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("active", i === active);
      li.setAttribute("aria-selected", String(i === active));
    });
    input.setAttribute("aria-activedescendant", `find-opt-${active}`);
  } else if (e.key === "Enter") {
    e.preventDefault();
    choose(active);
  } else if (e.key === "Escape") {
    closeResults();
  }
});

results.addEventListener("mousedown", (e) => {
  // mousedown, not click: blur would close the list before click lands.
  const li = (e.target as Element).closest("li");
  const i = li?.getAttribute("data-i");
  if (i === null || i === undefined) return;
  e.preventDefault();
  choose(Number(i));
});

input.addEventListener("blur", () => closeResults());

$("#lang").addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("button");
  const value = btn?.getAttribute("data-lang");
  if (!btn || !value) return;
  state.lang = value as Lang;
  $("#lang")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b === btn));
  // Keep the box showing the selected place in the language now being drawn.
  if (state.find) input.value = state.lang === "np" ? state.find.nameNp : state.find.name;
  render();
  renderHero();
});

$<HTMLInputElement>("#accent").addEventListener("input", (e) => {
  state.accent = (e.target as HTMLInputElement).value;
  render();
  renderHero();
});

// -------------------------------------------------- label placement ---

const placeControl = $<HTMLElement>("#place-control");
const placeSelect = $<HTMLSelectElement>("#placement");

/** Only the routes and find views draw labels; elsewhere the rule has nothing
 *  to act on, so the control says so instead of sitting there inert. */
function syncPlacement() {
  const draws = drawsLabels();
  placeSelect.disabled = !draws;
  placeControl.classList.toggle("is-off", !draws);
  placeControl.title = draws ? "" : "Only the routes and find views draw labels.";
  placeSelect.value = state.placement;
}

placeSelect.addEventListener("change", () => {
  state.placement = placeSelect.value as LabelPlacement;
  syncColors();
  render();
});

// ------------------------------------------------------------ viewport ---

const viewSelect = $<HTMLSelectElement>("#view");

/**
 * How far one press of +/- moves.
 *
 * 2, so the readout tells the story: the km/dot figure halves on every step
 * while the dot count beside it barely moves. That is the whole claim of
 * spec §6 in two numbers, and a gentler step would blur it.
 */
const ZOOM_STEP = 2;

/**
 * Adopt a new viewport.
 *
 * Every zoom, recentre and named-view pick lands here, so the select, the
 * overview and the dropped selection are handled once rather than at each
 * call site.
 */
function setBbox(next: Bbox) {
  state.bbox = next;
  // Re-pinned: this is a zoom, a named view or a reset, all of which rebuild
  // the field anyway. A drag calls `slideBbox` and leaves the lattice alone.
  state.lattice = next;
  // A dot pinned in one viewport is a different dot in the next — the grid is
  // resampled, so the cell under that coordinate is not the same cell.
  state.selected = null;
  syncView();
  render();
}

/**
 * Move the viewport without disturbing the lattice — what a drag calls.
 *
 * The distinction is the whole of why the map glides: `setBbox` re-pins the
 * lattice to the new box, which is right when the field is being rebuilt and
 * wrong when it is only being slid.
 */
function slideBbox(next: Bbox) {
  state.bbox = next;
  state.selected = null;
  syncView();
  render();
}

/**
 * Point the select at the named view the box matches, or at Custom.
 *
 * Compared by value rather than by keeping the name around: zooming leaves the
 * ladder, but zooming back can land on a named box exactly, and the control
 * should say so when it does.
 */
function syncView() {
  const match = (Object.keys(VIEWS) as ViewName[]).find((name) => {
    const v = VIEWS[name];
    return (
      Math.abs(v.lo - state.bbox.lo) < 1e-9 &&
      Math.abs(v.hi - state.bbox.hi) < 1e-9 &&
      Math.abs(v.la - state.bbox.la) < 1e-9 &&
      Math.abs(v.ha - state.bbox.ha) < 1e-9
    );
  });
  viewSelect.value = match ?? "custom";
}

viewSelect.addEventListener("change", () => {
  const name = viewSelect.value as ViewName;
  if (name in VIEWS) setBbox(VIEWS[name]);
});

/**
 * Wire a -/+/reset group. Called for both: the one in the controls strip and
 * the one on the overview, so zoom is reachable whether the eye is on the
 * settings or on the map.
 */
function wireZoom(group: HTMLElement) {
  group.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      const how = b.getAttribute("data-zoom");
      if (how === "reset") setBbox(NEPAL_BBOX);
      else setBbox(zoomBbox(state.bbox, how === "in" ? ZOOM_STEP : 1 / ZOOM_STEP));
    }),
  );
}

wireZoom($("#zoom"));
wireZoom($("#minimap-zoom"));

const overviewGroup = $<HTMLElement>("#overview");

function syncOverview() {
  overviewGroup
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b.getAttribute("data-overview") === state.overview));
}

overviewGroup.addEventListener("click", (e) => {
  const value = (e.target as Element).closest("button")?.getAttribute("data-overview");
  if (!value) return;
  state.overview = value as Overview;
  syncOverview();
  render();
});

/**
 * Control groups: open on a wide screen, closed on a narrow one.
 *
 * Not something CSS can do, because `open` is an attribute rather than a style.
 * Measured before grouping, the flat strip of fourteen controls ran 816px tall
 * at 390px wide and 1133px at 360px — taller than the screen it was sitting on,
 * which put the map some 2,900px down the page. Collapsed, the four headings
 * cost 221px at any width and the map is the next thing you see. The breakpoint
 * matches the one in the stylesheet; above it the groups lay out side by side
 * and are cheaper open than closed.
 */
const compact = matchMedia("(max-width: 1000px)");
const controlGroups = document.querySelectorAll<HTMLDetailsElement>(".control-group");

function syncGroups() {
  for (const group of controlGroups) group.open = !compact.matches;
}

// Only on a breakpoint crossing, so rotating a phone re-settles the panel but
// opening a group by hand is never undone underneath the reader.
compact.addEventListener("change", syncGroups);

const cornerSelect = $<HTMLSelectElement>("#corner");

/** Placement is a class swap — no re-render, nothing for the library to do. */
function syncCorner() {
  for (const corner of CORNERS) minimap.classList.toggle(`at-${corner}`, corner === state.corner);
  cornerSelect.value = state.corner;
}

cornerSelect.addEventListener("change", () => {
  state.corner = cornerSelect.value as Corner;
  syncCorner();
});

/**
 * Open a district's own bounds out to the zoom floor if it is smaller.
 *
 * Two of the 77 need it: padded for breathing room, Bhaktapur's box spans
 * 0.217° and Lalitpur's 0.262°, against a floor of 0.32°. Framing them exactly
 * would sample finer than the raster and the dots would go blocky, so the box
 * opens about its centre — the district stays framed, with more of its
 * neighbours showing than asked for.
 */
function atLeastFloor(box: Bbox): Bbox {
  const width = box.hi - box.lo;
  if (width >= MIN_ZOOM_SPAN) return box;
  // padBbox grows by a fraction of the span on each side, so half the shortfall.
  return padBbox(box, (MIN_ZOOM_SPAN / width - 1) / 2);
}

/**
 * Double-click to zoom to the district under the pointer.
 *
 * Double rather than single because the demo already spends single clicks on
 * selection, and `attachInteractions` has no double-click hook to borrow — so
 * it is wired straight onto the element with the exported primitives that make
 * it short: `eventPoint` for the screen-to-viewBox transform, `hitTest` for
 * which district was hit, `districtBbox` for where that district is.
 *
 * Falling back to a step zoom keeps the gesture from being a dead end: off the
 * field there is no district to frame, and on one already filling the view
 * re-framing it would look like nothing happened.
 *
 * **Counted off `click`, not listened for as `dblclick`.** In click mode every
 * click re-renders — `onRegionClick` and `clearOnMiss` both call `render`,
 * which replaces the SVG through `stage.innerHTML`. The two clicks then have
 * different target nodes, and the browser dispatches no `dblclick` at all, so
 * the gesture was dead in exactly the one mode whose hint promises it. The
 * click count survives that swap because it belongs to the pointer sequence
 * rather than to the target: measured, the second click still arrives with
 * `detail === 2` after the whole subtree has been rebuilt under it.
 */
stage.addEventListener("click", (e) => {
  if (e.detail < 2) return;
  const svg = stage.querySelector("svg");
  if (!svg || !currentGrid) return;
  const at = eventPoint(svg, e);
  if (!at) return;
  const dot = hitTest(currentGrid, at.x, at.y);
  const box = dot ? districtBbox(dot.region) : undefined;
  // Keep the current aspect, and only zoom in.
  const { width, height } = bboxSizeKm(state.bbox);
  const framed = box && clampBbox(atLeastFloor(fitAspect(padBbox(box, 0.12), width / height)));
  if (framed && framed.hi - framed.lo < (state.bbox.hi - state.bbox.lo) * 0.9) {
    setBbox(framed);
    return;
  }
  // The cursor is held still, so the thing being pointed at stays under the
  // pointer instead of sliding off as the box shrinks.
  setBbox(zoomBbox(state.bbox, ZOOM_STEP, { center: unproject(currentGrid, at.x, at.y) }));
});

/**
 * The overview map: the whole country at a fraction of the dot budget, with
 * the current viewport drawn on it.
 *
 * It is the same library call the main map makes — `buildGrid` then
 * `renderSvg` — just over `NEPAL_BBOX` at height 14 instead of 40. Nothing
 * links the two maps; `viewport` only draws a rectangle where it is told.
 */
let minimapGrid: Grid | null = null;

function renderMinimap(theme: Partial<Theme>) {
  const zoomed = state.bbox.hi - state.bbox.lo < NEPAL_BBOX.hi - NEPAL_BBOX.lo - 1e-9;
  const show = state.overview === "always" || (state.overview === "zoomed" && zoomed);
  minimap.hidden = !show;
  if (!show) {
    // Emptied rather than just hidden: a `hidden` container still holds real
    // nodes, and leaving a stale window rect in the document means anything
    // querying the page — a test, a screen reader, the next developer — finds
    // a viewport that isn't on screen.
    minimapMap.innerHTML = "";
    return;
  }
  // Built once and kept: it is the same box at the same height for the life of
  // the page, and only the rectangle drawn on it ever moves.
  minimapGrid ??= buildGrid(raster, { bbox: NEPAL_BBOX, height: 14 });
  minimapMap.innerHTML = renderSvg(minimapGrid, {
    theme: { ...theme, background: "transparent", viewport: state.accent },
    // Omitted at full extent: a window drawn around the entire frame answers a
    // question nobody asked, and its tint washes the country it is drawing. The
    // overview still earns its place there — it is what you drag to move — so
    // the map stays and only the rectangle waits for a reason to exist.
    viewport: zoomed ? state.bbox : undefined,
    title: zoomed
      ? "Overview of Nepal showing the current viewport"
      : "Overview of Nepal — the whole country is in view",
  });
}

/**
 * The viewport centred on a coordinate, keeping its current size.
 *
 * `panBbox` rather than the obvious `clampBbox` on a hand-rolled box, which is
 * what this used to be: carrying the *degree* span to the new centre is not
 * carrying the viewport. Longitude degrees narrow by cos(lat), so the box lost
 * ground width as it travelled north, `aspectWidth` answered with fewer
 * columns, and the map changed shape in the middle of a drag — measured here,
 * 71 columns down to 69 and the drawn map growing 436px to 449px tall while the
 * pointer was still down. `panBbox` carries the ground size, which pins the
 * column count by construction.
 */
function viewportOn(to: LngLat): Bbox {
  return panBbox(state.bbox, to, { align: state.lattice });
}

/** Where on the overview a pointer event landed, or null if it missed. */
function overviewPoint(e: PointerEvent): LngLat | null {
  // Re-queried every time rather than captured once: `renderMinimap` replaces
  // the SVG on each frame, and `getScreenCTM` on the detached old node returns
  // null — which is exactly what would make a drag die after one move.
  const svg = minimapMap.querySelector("svg");
  if (!svg || !minimapGrid) return null;
  const at = eventPoint(svg, e);
  return at ? unproject(minimapGrid, at.x, at.y) : null;
}

/**
 * Drag the viewport around the overview.
 *
 * Listeners sit on `#minimap-map`, which survives every render, rather than on
 * the SVG inside it, which does not. Pointer capture then keeps the drag alive
 * past the edge of the overview and outside the window.
 */
let dragging = false;
/** Pointer-to-centre offset, so grabbing the window doesn't teleport it. */
let grab = { lng: 0, lat: 0 };
let frame = 0;
let pendingTo: LngLat | null = null;

minimapMap.addEventListener("pointerdown", (e) => {
  const to = overviewPoint(e);
  if (!to) return;
  // Grabbing inside the window moves it from where it was held; grabbing
  // outside is a jump, and the box centres on the point at once.
  const inside = bboxContains(state.bbox, to);
  grab = inside
    ? {
        lng: (state.bbox.lo + state.bbox.hi) / 2 - to.lng,
        lat: (state.bbox.la + state.bbox.ha) / 2 - to.lat,
      }
    : { lng: 0, lat: 0 };
  dragging = true;
  minimapMap.classList.add("is-dragging");
  minimapMap.setPointerCapture(e.pointerId);
  if (!inside) slideBbox(viewportOn(to));
});

minimapMap.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const to = overviewPoint(e);
  if (!to) return;
  pendingTo = { lng: to.lng + grab.lng, lat: to.lat + grab.lat };
  // Coalesced to one render per frame. A pointer fires well above 60 Hz, and
  // every move here rebuilds the grid, the SVG and the interaction layer. A
  // 60-move burst collapses to a single render this way; unthrottled it would
  // be 60 inside one 16.7 ms frame.
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (pendingTo) slideBbox(viewportOn(pendingTo));
  });
});

const endDrag = (e: PointerEvent) => {
  if (!dragging) return;
  dragging = false;
  // Flushed rather than dropped: releasing inside the frame the last move
  // scheduled would otherwise discard it, leaving the viewport up to one
  // frame of travel behind where the pointer actually let go.
  if (pendingTo) slideBbox(viewportOn(pendingTo));
  pendingTo = null;
  minimapMap.classList.remove("is-dragging");
  if (minimapMap.hasPointerCapture(e.pointerId)) minimapMap.releasePointerCapture(e.pointerId);
};
minimapMap.addEventListener("pointerup", endDrag);
minimapMap.addEventListener("pointercancel", endDrag);

// -------------------------------------------- highlight granularity ---

const highlightControl = $<HTMLElement>("#highlight-control");
const highlightGroup = $<HTMLElement>("#highlight");

/** Nothing is highlighted with interaction off, so the choice has no effect. */
function syncHighlight() {
  const inert = state.interact === "off";
  highlightControl.classList.toggle("is-off", inert);
  highlightControl.title = inert ? "Interaction is off, so nothing is highlighted." : "";
  highlightGroup.querySelectorAll("button").forEach((b) => {
    b.disabled = inert;
    b.classList.toggle("on", b.getAttribute("data-highlight") === state.highlight);
  });
}

// The pinned dot survives the switch rather than being cleared: re-rendering
// the same selection at the other granularity is the clearest statement of
// what the two modes differ about.
highlightGroup.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("button");
  const value = btn?.getAttribute("data-highlight");
  if (!btn || !value) return;
  state.highlight = value as Highlight;
  syncHighlight();
  render();
});

// ------------------------------------------------- district context ---

const contextControl = $<HTMLElement>("#context-control");
const contextGroup = $<HTMLElement>("#context");

/** A reason the toggle does nothing right now, or null when it applies. */
function contextInert(): string | null {
  if (state.mode !== "find") return "Only the find view draws a district behind a pin.";
  if (!state.find) return "Search for a district or place first.";
  if (state.find.kind === "district") {
    return "A district search paints its own dots — there is no separate context to add.";
  }
  return null;
}

function syncContext() {
  const why = contextInert();
  contextControl.classList.toggle("is-off", why !== null);
  contextControl.title = why ?? "";
  const value = state.context ? "on" : "off";
  contextGroup.querySelectorAll("button").forEach((b) => {
    b.disabled = why !== null;
    b.classList.toggle("on", b.getAttribute("data-context") === value);
  });
}

contextGroup.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("button");
  const value = btn?.getAttribute("data-context");
  if (!btn || !value) return;
  state.context = value === "on";
  syncContext();
  render();
});

// ------------------------------------------------------- data controls ---

/**
 * The three Data-view controls, each greyed out with a reason when it would do
 * nothing — the same rule every other control on the page follows.
 */
const DATA_CONTROLS = [
  {
    group: $<HTMLElement>("#encoding"),
    attr: "data-encoding",
    value: () => state.encoding,
    set: (v: string) => (state.encoding = v as Encoding),
    inert: () => (state.mode === "data" ? null : "Only the Data view encodes values."),
  },
  {
    group: $<HTMLElement>("#scale"),
    attr: "data-scale",
    value: () => state.scale,
    set: (v: string) => (state.scale = v === "log" ? "log" : "quantile"),
    inert: () =>
      state.mode !== "data"
        ? "Only the Data view encodes values."
        : state.encoding === "size" || state.encoding === "density"
          ? "This encoding uses no colour scale."
          : null,
  },
  {
    group: $<HTMLElement>("#spread"),
    attr: "data-spread",
    value: () => (state.spread > 0 ? "smoothed" : "exact"),
    set: (v: string) => (state.spread = v === "smoothed" ? 1 : 0),
    inert: () =>
      state.mode !== "data" || state.encoding !== "density" ? "Only the Density encoding uses this." : null,
  },
];

function syncData() {
  for (const c of DATA_CONTROLS) {
    const why = c.inert();
    const control = c.group.closest<HTMLElement>(".control")!;
    control.classList.toggle("is-off", why !== null);
    control.title = why ?? "";
    c.group.querySelectorAll("button").forEach((b) => {
      b.disabled = why !== null;
      b.classList.toggle("on", b.getAttribute(c.attr) === c.value());
    });
  }
}

for (const c of DATA_CONTROLS) {
  c.group.addEventListener("click", (e) => {
    const value = (e.target as Element).closest("button")?.getAttribute(c.attr);
    if (!value) return;
    c.set(value);
    syncData();
    syncColors();
    render();
  });
}

// ---------------------------------------------------- colour pickers ---

/**
 * A swatch over a `string | null` slot, where null means "follow the theme".
 *
 * Three of these now exist and they all have the same two obligations, so the
 * wiring is written once. The swatch must show the *effective* colour — while
 * the slot is null it tracks the page theme rather than sitting on a stale
 * value the map is not using — and a control whose colour has no effect in the
 * current view is disabled with a reason rather than left live and inert.
 */
interface ColorSlot {
  get(): string | null;
  set(value: string | null): void;
  /** The theme's own colour, read fresh so it follows the light/dark toggle. */
  fallback(): string;
  /** A reason this colour does nothing right now, or null when it applies. */
  inert(): string | null;
}

function wireColor(id: string, slot: ColorSlot): () => void {
  const control = $<HTMLElement>(`#${id}-control`);
  const input = $<HTMLInputElement>(`#${id}-color`);
  const reset = $<HTMLButtonElement>(`#${id}-reset`);

  const sync = () => {
    const why = slot.inert();
    input.disabled = why !== null;
    control.classList.toggle("is-off", why !== null);
    control.title = why ?? "";
    input.value = slot.get() ?? slot.fallback();
    reset.classList.toggle("is-hidden", slot.get() === null);
  };

  const apply = (value: string | null) => {
    slot.set(value);
    sync();
    render();
    renderHero();
  };

  input.addEventListener("input", () => apply(input.value));
  reset.addEventListener("click", () => apply(null));
  return sync;
}

const syncDotControl = wireColor("dot", {
  get: () => state.dot,
  set: (v) => (state.dot = v),
  fallback: defaultDot,
  // The districts view hands every dot a province colour through `regionColor`,
  // which outranks `theme.dot` entirely.
  inert: () =>
    state.mode === "districts"
      ? "The districts view colours every dot by province, so it overrides this."
      : state.mode === "data" && (state.encoding === "colour" || state.encoding === "both")
        ? "Every dot is coloured by its district's value, so it overrides this."
        : null,
});

const syncLabelControl = wireColor("label", {
  get: () => state.labelColor,
  set: (v) => (state.labelColor = v),
  fallback: () => cssVar("--text", isDark() ? "#e9eef8" : "#0f172a"),
  inert: () => (drawsLabels() ? null : "This view draws no labels."),
});

const syncLeaderControl = wireColor("leader", {
  get: () => state.leader,
  set: (v) => (state.leader = v),
  fallback: () => cssVar("--text", isDark() ? "#e9eef8" : "#0f172a"),
  // A leader is only drawn once a placement rule has moved the label away.
  inert: () =>
    !drawsLabels()
      ? "This view draws no labels."
      : state.placement === "above" || state.placement === "none"
        ? "Only the placement rules that move a label draw a leader line."
        : null,
});

const syncColors = () => {
  syncDotControl();
  syncLabelControl();
  syncLeaderControl();
};

$("#theme-toggle").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  // Set, never delete: an absent attribute now means dark, so deleting it to
  // mean light would flip the page to the opposite of what was asked for.
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("naksha-theme", next);
  } catch {
    /* private mode — the toggle still works for this session */
  }
  // After the class flips, so an untouched swatch picks up the new default.
  syncColors();
  render();
  renderHero();
});

// ------------------------------------------------------------- consent ---

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Reveal the consent banner, but only where it can actually change something.
 *
 * Three conditions, and the third is the interesting one.
 *
 * The tag has to be live at all: `window.gtag` is undefined on localhost and on
 * forks, where the head script's host allowlist never appends it, and asking
 * consent for a tag that was never loaded is theatre.
 *
 * A stored choice ends it — the head script has already replayed that choice as
 * a `consent update` before the first hit, so there is nothing left to ask.
 *
 * And the visitor has to be somewhere `analytics_storage` defaults to denied,
 * which is the one thing this page cannot know. GA4 evaluates the head script's
 * `region` list on its own side, from the IP; the client is never told the
 * answer. The timezone is the closest it can get.
 *
 * So the heuristic decides whether a banner is *offered*. It decides nothing
 * about what is *enforced* — GA4's region rule does that, server-side, and it
 * does not consult this function. Both ways of being wrong are therefore
 * survivable: a banner shown to someone outside the EEA who did not need one
 * (they were already granted, and Accept is a no-op), or a European on an odd
 * timezone who is never offered the upgrade and stays on cookieless pings.
 * Compliance does not ride on a guess about time zones, which is the only
 * reason a guess is acceptable here.
 */
function initConsent() {
  const gtag = window.gtag;
  if (!gtag) return;

  const banner = $<HTMLElement>("#consent");

  try {
    const saved = localStorage.getItem("naksha-consent");
    if (saved === "granted" || saved === "denied") return;
  } catch {
    /* private mode — ask again rather than assume either answer */
  }

  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* no Intl data: fall through and offer the banner */
  }
  // Europe/* is the bulk of it, and over-covers with a few non-EEA zones
  // (Europe/Moscow, Europe/Istanbul) — over-showing is the harmless direction.
  // Atlantic/* carries real EEA territory: Reykjavik, the Canaries, Madeira and
  // the Azores. Cyprus is the one that a prefix cannot reach, since tzdb files
  // it under Asia despite EU membership.
  const EEA_ZONES = ["Europe/", "Atlantic/", "Asia/Nicosia", "Asia/Famagusta"];
  if (zone && !EEA_ZONES.some((z) => zone.startsWith(z))) return;

  const decide = (state: "granted" | "denied") => () => {
    gtag("consent", "update", { analytics_storage: state });
    try {
      localStorage.setItem("naksha-consent", state);
    } catch {
      /* private mode — the choice still holds for this page view */
    }
    banner.hidden = true;
  };

  $("#consent-yes").addEventListener("click", decide("granted"));
  $("#consent-no").addEventListener("click", decide("denied"));
  banner.hidden = false;
}

initConsent();

// ------------------------------------------------------------ copy code ---

/**
 * Add a copy button to every code sample and the hero's install line.
 *
 * Built here rather than in the markup for two reasons: a button that cannot
 * work should not be drawn, and `navigator.clipboard` needs a secure context —
 * so a page opened over file:// or plain http gets no button instead of a dead
 * one. The text copied is `textContent`, which is the unescaped source: the
 * markup stores `&lt;` but the clipboard should receive `<`.
 */
function addCopyButtons() {
  if (!navigator.clipboard) return;

  const targets: { host: HTMLElement; source: Element }[] = [];
  for (const pre of document.querySelectorAll<HTMLElement>(".code-card pre")) {
    targets.push({ host: pre, source: pre.querySelector("code") ?? pre });
  }
  // The span matters: the button is appended to the *host*, so a host that is
  // also the source ends up with "Copy" inside the text being copied. The code
  // cards avoid this for free because their button lands on <pre> while the
  // text comes from <code>; the install chip needs an inner element to play the
  // same role. It also keeps the "$ " prefix out of the clipboard, since that
  // is a ::before on .install rather than a child of the span.
  const install = document.querySelector<HTMLElement>(".install");
  const command = install?.querySelector("span");
  if (install && command) targets.push({ host: install, source: command });

  for (const { host, source } of targets) {
    host.classList.add("has-copy");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    // Named for screen readers, which otherwise hear a page of "Copy".
    const what = host.closest(".code-card")?.querySelector("h3")?.textContent;
    btn.setAttribute("aria-label", what ? `Copy the ${what} example` : "Copy the install command");

    let restore: ReturnType<typeof setTimeout> | undefined;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source.textContent ?? "");
        btn.textContent = "Copied";
        btn.classList.add("is-done");
      } catch {
        // Permission denied or an insecure context that slipped through: say so
        // rather than silently appearing to have worked.
        btn.textContent = "Press ⌘C";
        const range = document.createRange();
        range.selectNodeContents(source);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      clearTimeout(restore);
      restore = setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("is-done");
      }, 1600);
    });
    host.appendChild(btn);
  }
}

// ---------------------------------------------------------------- hero ---

function renderHero() {
  const grid = buildGrid(raster, { bbox: VIEWS.nepal });
  $("#hero-map").innerHTML = renderSvg(grid, {
    theme: {
      ...mapTheme("transparent"),
      // The hero keeps its own variable because it sits on --ground rather
      // than a panel, even though both currently resolve to the same value.
      // A picked colour is a picked colour either way: it applies here
      // unchanged, so both maps on the page agree.
      dot: state.dot ?? cssVar("--map-dot-hero", isDark() ? "#6092d7" : "#6a6b6c"),
    },
    routes: HUBS.map((h) => ({ stops: [KTM, h] })),
    points: [KTM, ...HUBS],
    lang: state.lang,
    animate: true,
    // Two maps share this page, and both number their routes from r0 — so
    // without a prefix of its own the hero's route ids collide with the
    // stage's. Nothing renders off the ids any more, but duplicate ids in a
    // document are still invalid and still break anything that looks one up.
    idPrefix: "hero-",
    title: "Routes radiating from Kathmandu",
  });
}

// Reflect deep-linked options in the controls before first render.
$("#mode")
  .querySelectorAll("button")
  .forEach((b) => b.classList.toggle("on", b.getAttribute("data-mode") === state.mode));
$("#interact")
  .querySelectorAll("button")
  .forEach((b) => b.classList.toggle("on", b.getAttribute("data-interact") === state.interact));
$("#lang")
  .querySelectorAll("button")
  .forEach((b) => b.classList.toggle("on", b.getAttribute("data-lang") === state.lang));
if (state.find) input.value = state.lang === "np" ? state.find.nameNp : state.find.name;
syncGroups();
syncView();
syncOverview();
syncCorner();
syncFinder();
syncColors();
syncPlacement();
syncContext();
syncData();
syncHighlight();

addCopyButtons();
renderHero();
render();
