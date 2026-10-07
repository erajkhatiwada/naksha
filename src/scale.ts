/**
 * Value scales — numbers to dot colours and dot sizes — and the legends that
 * explain them.
 *
 * Every colour and size on the map is already a callback (`regionColor`,
 * `regionRadius`), so none of this is required: these are the scales a
 * dashboard reaches for first, written once so the legend is guaranteed to
 * describe exactly what the dots show. Nothing here touches the DOM, so a
 * scale built on the server and the one built in the browser agree.
 */
import { lightTheme } from "./theme.ts";

/**
 * A legend, as data. `colorScale` and `sizeScale` build these; pass them to
 * `RenderOptions.legend`. Written out by hand for anything they don't cover.
 */
export type Legend =
  | {
      /** One swatch per class, with each threshold printed between two swatches. */
      kind: "classes";
      title?: string;
      colors: readonly string[];
      /** Ascending thresholds, one fewer than `colors`. */
      breaks: readonly number[];
      format?: (value: number) => string;
    }
  | {
      /** A continuous ramp, labelled at both ends. */
      kind: "ramp";
      title?: string;
      colors: readonly string[];
      min: number;
      max: number;
      format?: (value: number) => string;
    }
  | {
      /** Reference dots at a few values, each labelled. */
      kind: "size";
      title?: string;
      values: readonly number[];
      /** Radius of each reference dot, in dot units. */
      radii: readonly number[];
      /** Swatch fill. Defaults to the theme's label colour, softened. */
      color?: string;
      format?: (value: number) => string;
    };

export interface LegendFormat {
  /** How numbers are printed. Defaults to `formatValue`. */
  format?: (value: number) => string;
}

/**
 * Steps a continuous scale is quantised to.
 *
 * The renderer draws one `<path>` per distinct dot colour, so a truly
 * continuous scale would give every dot its own node and undo the collapsed
 * field. 24 steps, a sixth of the gap between neighbouring stops of the
 * default five-stop ramp, is close enough to read as continuous while keeping
 * the field to tens of nodes rather than one per dot.
 */
export const RAMP_STEPS = 24;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The colour a fraction `t` of the way along a ramp, 0 to 1.
 *
 * Interpolated between neighbouring hex stops. A stop that is any other CSS
 * colour cannot be mixed without a DOM, so the nearer of the two is used
 * instead: a ramp of named colours still works, just in steps.
 *
 * Not re-exported from the package root.
 */
export function rampColor(colors: readonly string[], t: number): string {
  if (colors.length === 0) throw new RangeError("a ramp needs at least one colour");
  if (colors.length === 1) return colors[0];
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  const k = x - i;
  const a = colors[i];
  const b = colors[i + 1];
  if (!HEX.test(a) || !HEX.test(b)) return k < 0.5 ? a : b;
  if (k === 0) return a;
  const [ca, cb] = [rgb(a), rgb(b)];
  return "#" + ca.map((v, j) => Math.round(v + (cb[j] - v) * k).toString(16).padStart(2, "0")).join("");
}

/** `rampColor`, quantised to `RAMP_STEPS` so a field collapses to few nodes. */
export function stepColor(colors: readonly string[], t: number): string {
  return rampColor(colors, Math.round(Math.min(1, Math.max(0, t)) * RAMP_STEPS) / RAMP_STEPS);
}

/** `n` colours spread evenly along a ramp, ends included. */
function sampleRamp(colors: readonly string[], n: number): string[] {
  if (n === colors.length) return [...colors];
  if (n === 1) return [rampColor(colors, 0.5)];
  return Array.from({ length: n }, (_, i) => rampColor(colors, i / (n - 1)));
}

/**
 * A number short enough for a legend: `0.0031`, `0.16`, `4.5`, `36`, `1.2k`, `3.4M`.
 *
 * Deterministic on purpose — no `Intl`, no locale — so a map rendered on the
 * server prints the same characters as the one hydrated in a browser set to a
 * different language.
 */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const a = Math.abs(value);
  // Two significant figures below one, never a fixed number of decimals: a
  // smoothed density's faintest dot holds a few thousandths of a point, and
  // rounding that to "0" would label as empty a dot the map is shading.
  if (a > 0 && a < 1) return String(Number(value.toPrecision(2)));
  let unit = a >= 1e9 ? 3 : a >= 1e6 ? 2 : a >= 1e3 ? 1 : 0;
  for (;;) {
    const scaled = value / 1000 ** unit;
    const n = Number(scaled.toFixed(Math.abs(scaled) >= (unit ? 10 : 100) ? 0 : 1));
    // Rounding can carry into the next unit — 999,999 is "1M", not "1000k" —
    // so the unit is settled after rounding, not before.
    if (Math.abs(n) >= 1000 && unit < 3) {
      unit++;
      continue;
    }
    return `${n}${["", "k", "M", "B"][unit]}`;
  }
}

function finite(values: Iterable<number>): number[] {
  const out: number[] = [];
  for (const v of values) if (Number.isFinite(v)) out.push(v);
  return out.sort((a, b) => a - b);
}

export interface ColorScaleOptions {
  /**
   * Colours from low to high. Defaults to the light theme's ramp; on a dark
   * map pass `darkTheme.ramp`, which runs the other way so that low values
   * sink into the background rather than glowing out of it.
   *
   * When there are exactly as many as there are classes they are used as
   * given, so any CSS colour works. Otherwise classes are sampled along the
   * ramp, which needs hex stops to mix between (see `rampColor`).
   */
  colors?: readonly string[];
  /**
   * How values become colours.
   *
   * - `quantile` (default) — classes holding equal numbers of districts.
   *   Robust to skew: one outlier cannot wash every other district out to the
   *   palest class, which is what it does to an equal-width scale.
   * - `equal` — classes of equal width between the minimum and maximum.
   * - `linear` / `log` — continuous. `log` is the one that survives skew, and
   *   needs every value above zero.
   */
  mode?: "quantile" | "equal" | "linear" | "log";
  /** Classes for `quantile` and `equal`. Default 5. */
  classes?: number;
  /** Explicit class thresholds, ascending. Overrides `mode`. */
  breaks?: readonly number[];
}

export interface ColorScale {
  /**
   * The colour for a value, or undefined when there is no value — which
   * `regionColor` reads as "use the theme's dot", so missing data shows as
   * missing rather than as the lowest class.
   */
  color(value: number | null | undefined): string | undefined;
  /** A legend describing exactly this scale. */
  legend(title?: string, options?: LegendFormat): Legend;
  /** One colour per class; the whole ramp for a continuous scale. */
  readonly colors: readonly string[];
  /** Class thresholds, ascending. Empty for a continuous scale. */
  readonly breaks: readonly number[];
  /** The smallest and largest finite value the scale was built from. */
  readonly domain: readonly [number, number];
}

/**
 * Map values onto colours.
 *
 * ```ts
 * const scale = colorScale(orders.values());
 * renderNepal({
 *   regionColor: (id) => scale.color(orders.get(id)),
 *   legend: scale.legend("Orders per 1,000 people"),
 * });
 * ```
 *
 * A value equal to a threshold falls in the class above it.
 */
export function colorScale(values: Iterable<number>, options: ColorScaleOptions = {}): ColorScale {
  const sorted = finite(values);
  const ramp = options.colors ?? lightTheme.ramp;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const domain = [min, max] as const;
  const mode = options.breaks ? "breaks" : (options.mode ?? "quantile");

  if (mode === "linear" || mode === "log") {
    if (mode === "log" && sorted.length && min <= 0) {
      throw new RangeError(`a log scale needs values above zero; the smallest is ${min}`);
    }
    const at =
      mode === "log"
        ? (v: number) => (max === min ? 1 : Math.log(Math.max(v, min) / min) / Math.log(max / min))
        : (v: number) => (max === min ? 1 : (v - min) / (max - min));
    return {
      color: (v) => (v == null || !Number.isFinite(v) ? undefined : stepColor(ramp, at(v))),
      legend: (title, f = {}) => ({ kind: "ramp", title, colors: ramp, min, max, format: f.format }),
      colors: ramp,
      breaks: [],
      domain,
    };
  }

  let cuts: number[];
  if (mode === "breaks") {
    // Finite only: a NaN compares false both ways, so one of them stops `sort`
    // ordering the rest, and every value after it lands in the wrong class.
    cuts = [...new Set(options.breaks!.filter(Number.isFinite))].sort((a, b) => a - b);
  } else {
    const k = Math.max(1, Math.floor(options.classes ?? 5));
    const raw =
      mode === "equal"
        ? Array.from({ length: k - 1 }, (_, i) => min + ((i + 1) * (max - min)) / k)
        : Array.from({ length: k - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / k)]);
    // A threshold at or below the minimum would leave the first class empty,
    // and repeats would print the same number twice: both happen whenever many
    // districts share a value, so they fold away and the scale has fewer classes.
    cuts = [...new Set(raw)].filter((c) => c > min);
  }
  const colors = sampleRamp(ramp, cuts.length + 1);

  return {
    color(v) {
      if (v == null || !Number.isFinite(v)) return undefined;
      let i = 0;
      while (i < cuts.length && v >= cuts[i]) i++;
      return colors[i];
    },
    legend: (title, f = {}) => ({ kind: "classes", title, colors, breaks: cuts, format: f.format }),
    colors,
    breaks: cuts,
    domain,
  };
}

export interface SizeScaleOptions {
  /** Radius of the largest value, in dot units. Default 0.46 — dots touch at 0.5. */
  max?: number;
  /**
   * Smallest radius drawn, so a district with a low value still shows. Default
   * 0.08. Below it, area stops being proportional to value; pass 0 to let a
   * zero vanish instead.
   */
  min?: number;
}

export interface SizeScale {
  /** The radius for a value, or undefined when there is none (theme default). */
  radius(value: number | null | undefined): number | undefined;
  /** A legend of reference dots drawn from this scale. */
  legend(title?: string, options?: LegendFormat & { color?: string }): Legend;
  readonly domain: readonly [number, number];
}

/**
 * Map values onto dot radii, keeping dot *area* proportional to the value.
 *
 * Area rather than radius because area is what the eye compares: a radius
 * scale makes a district with twice the value look four times as big.
 * Measured from zero, not from the minimum, so two districts' dots compare as
 * their values do. Values at or below zero draw at `min`.
 *
 * ```ts
 * const size = sizeScale(stores.values());
 * renderNepal({ regionRadius: (id) => size.radius(stores.get(id)) });
 * ```
 */
export function sizeScale(values: Iterable<number>, options: SizeScaleOptions = {}): SizeScale {
  const sorted = finite(values);
  const top = options.max ?? 0.46;
  const floor = options.min ?? 0.08;
  const domain = [sorted[0] ?? 0, sorted[sorted.length - 1] ?? 0] as const;
  const vmax = domain[1];
  const radius = (v: number | null | undefined): number | undefined => {
    if (v == null || !Number.isFinite(v)) return undefined;
    if (v <= 0 || vmax <= 0) return floor;
    return Math.max(floor, top * Math.sqrt(Math.min(v, vmax) / vmax));
  };

  return {
    radius,
    legend(title, f = {}) {
      // The maximum, a quarter and a sixteenth: each reference dot half the
      // radius of the next, so all three read as different sizes. Rounded down
      // to one significant figure so the legend never claims a value larger
      // than the data reaches.
      const values = [...new Set([vmax / 16, vmax / 4, vmax].map(niceFloor))].filter((v) => v > 0);
      return {
        kind: "size",
        title,
        values,
        radii: values.map((v) => radius(v)!),
        color: f.color,
        format: f.format,
      };
    },
    domain,
  };
}

/** Round down to one significant figure, or two for a leading 1: 340 → 300, 0.163 → 0.16. */
function niceFloor(v: number): number {
  if (!(v > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const lead = v / p;
  const step = lead < 2 ? p / 10 : p;
  return Number((Math.floor(v / step + 1e-9) * step).toPrecision(12));
}
