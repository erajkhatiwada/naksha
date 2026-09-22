/**
 * Theming.
 *
 * Every consumer has brand colours (spec §13), so nothing here is hard-coded
 * into the renderer. All sizes are in dot units — 1 unit = 1 dot spacing —
 * so a theme looks the same at every zoom level.
 */

export interface Theme {
  /** Page/background fill. Use "transparent" to inherit the host surface. */
  background: string;
  /** Base dot colour. */
  dot: string;
  /** Base dot radius, in dot units. 0.5 would make dots touch. */
  dotRadius: number;
  dotOpacity: number;
  /**
   * Fade dots whose cell is only partly inside Nepal, softening the border.
   * 0 disables, 1 fades an edge dot in proportion to its coverage.
   */
  edgeFade: number;

  /** Route stroke. */
  route: string;
  routeWidth: number;
  routeOpacity: number;

  /** Stop/pin fill and radius. */
  pin: string;
  pinRadius: number;
  /** Ring drawn behind a pin, usually the background colour, to punch it out. */
  pinHalo: string;
  pinHaloWidth: number;

  /** Cluster badge fill and its label colour. */
  cluster: string;
  clusterLabel: string;

  /** Text colour for stop labels. */
  label: string;
  labelSize: number;
  /**
   * Baseline-to-baseline distance for a label carrying more than one line, as
   * a multiple of `labelSize`. A single-line map renders identically whatever
   * this is set to.
   *
   * 1.2 is tight on purpose: a label's halo erases the dots it covers, so every
   * extra unit of block height costs another row of them. Devanagari sets
   * taller than the Latin ascent and descent the box model assumes — matras
   * reach well above the cap and conjuncts well below the baseline — so a
   * Devanagari-first map usually wants a little more.
   */
  labelLineHeight: number;
  /**
   * The hairline joining a label back to its pin, drawn only when
   * `labelPlacement` has moved the label away from it.
   *
   * Separate from `label` because the two answer to different constraints: the
   * text has to be readable, the line only has to be followable, and a line as
   * dark as the text reads as a route rather than as a pointer. Defaults to the
   * label colour at 45% so an untouched theme looks as it always did.
   */
  leader: string;
  leaderWidth: number;
  leaderOpacity: number;
  /**
   * The rectangle an overview map draws to show where a detail view is looking
   * (`RenderOptions.viewport`).
   *
   * Its own colour rather than the label's: on a minimap the outline is the
   * only thing competing with the dots, and a consumer who dims the field to
   * make the window pop should not have to dim their place names with it.
   */
  viewport: string;
  viewportWidth: number;
  /**
   * Tint inside the rectangle, as an opacity on `viewport`'s own colour.
   * 0 leaves the window hollow, which reads better over a dense field.
   */
  viewportOpacity: number;
  /**
   * Font stack for all rendered text.
   *
   * Includes Devanagari faces explicitly. `system-ui` alone does not cover
   * Devanagari on every platform, and a missing face renders as tofu boxes
   * rather than falling back gracefully — so the stack names the usual
   * platform faces (Noto on Linux/Android, Kohinoor on Apple, Mangal on
   * Windows) before the generic fallback.
   */
  fontFamily: string;
}

/** Covers Latin and Devanagari across macOS, Windows, Linux and Android. */
export const DEFAULT_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Devanagari", ' +
  '"Kohinoor Devanagari", "Mangal", "Nirmala UI", sans-serif';

export const lightTheme: Theme = {
  background: "#ffffff",
  dot: "#cbd5e1",
  dotRadius: 0.3,
  dotOpacity: 1,
  edgeFade: 0.6,

  route: "#dc2626",
  routeWidth: 0.14,
  routeOpacity: 0.95,

  pin: "#dc2626",
  pinRadius: 0.42,
  pinHalo: "#ffffff",
  pinHaloWidth: 0.16,

  cluster: "#dc2626",
  clusterLabel: "#ffffff",

  label: "#0f172a",
  labelSize: 1.1,
  labelLineHeight: 1.2,
  leader: "#0f172a",
  leaderWidth: 0.06,
  leaderOpacity: 0.45,
  viewport: "#0f172a",
  viewportWidth: 0.3,
  viewportOpacity: 0.1,
  fontFamily: DEFAULT_FONT_STACK,
};

export const darkTheme: Theme = {
  ...lightTheme,
  background: "#0b1120",
  dot: "#1e293b",
  route: "#f87171",
  pin: "#f87171",
  pinHalo: "#0b1120",
  cluster: "#f87171",
  clusterLabel: "#0b1120",
  label: "#e2e8f0",
  leader: "#e2e8f0",
  viewport: "#e2e8f0",
};

export function resolveTheme(theme?: Partial<Theme>, base: Theme = lightTheme): Theme {
  return theme ? { ...base, ...theme } : base;
}
