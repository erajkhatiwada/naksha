# naksha · नक्सा

[![CI](https://github.com/erajkhatiwada/naksha/actions/workflows/ci.yml/badge.svg)](https://github.com/erajkhatiwada/naksha/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#whats-supported)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](#whats-supported)
[![Types](https://img.shields.io/badge/types-included-blue.svg)](#whats-supported)

Nepal as a dot grid, with routes, networks and coverage drawn on top.

**Zero runtime dependencies. SSR-safe. The entire geometry layer is 42 KB.**

→ **[Live demo](https://erajkhatiwada.github.io/naksha/)**

```bash
npm i nepal-naksha
```

---

## This is a presentation-layer map, not a navigation map

It takes an **ordered list of stops** and renders it. Whether anything actually
travels that way is your data's problem. Leaflet, Mapbox and OSM own turn-by-turn
routing and street detail.

**Non-goals, permanently:** no pathfinding (that means competing with OSRM), no
basemap tiles, no street detail, no geocoding, no live tracking.

---

## Features

- **All 77 districts in English and Devanagari**, with p-codes, provinces and
  headquarters coordinates. Lookups work in either script.
- **Routes, networks and coverage** — arcs whose height scales with √distance,
  points that snap and cluster onto dots, districts coloured by any value.
- **Zoom and pan** as arithmetic on a bounding box, with an overview map either
  inset into the SVG or rendered as a second element.
- **Four label-placement rules**, each a measured trade between covering dots
  and moving away from the pin. Multi-line labels place as one block.
- **Hover, click and keyboard that cost no DOM** — hit-testing is arithmetic, so
  the demo's district view runs fully interactive at 24 nodes.
- **SSR-safe by construction** — synchronous decode, no `"use client"`, no
  loading state, no top-level await.
- **Zero runtime dependencies.** ESM, CommonJS and an IIFE global, types
  included, optional React wrapper. Node 18+, or any ES2018 browser.

[How it works](#how-it-works) covers the machinery behind these.

---

## Quick start

### React

```tsx
import { Naksha } from "nepal-naksha/react";

const KTM = { lng: 85.3591, lat: 27.6966, label: "Kathmandu" };
const PKR = { lng: 83.982, lat: 28.201, label: "Pokhara" };

<Naksha
  routes={[{ stops: [KTM, PKR] }]}
  points={[KTM, PKR]}
  theme={{ route: "#0ea5e9" }}
  labels
  animate
  highlight
  onRegionEnter={(district) => console.log(district?.name)}
  onPointClick={(cluster) => console.log(cluster.points)}
/>;
```

React is an optional peer dependency, **16.14 and up**.

### Anywhere else

`renderNepal` returns a self-contained SVG string with no external references —
Node, a Worker, an email, or piped to a file.

```ts
import { renderNepal, VIEWS } from "nepal-naksha";

const svg = renderNepal({
  bbox: VIEWS.bagmati,
  routes: [{ stops: pickups }],
  points: pickups,
  theme: { dot: "#e2e8f0", route: "#dc2626" },
});
```

### CommonJS, and no build step at all

```js
const { renderNepal, districtAt } = require("nepal-naksha");
```

```html
<script src="https://unpkg.com/nepal-naksha"></script>
<script>
  document.body.innerHTML = naksha.renderNepal({ points: stops });
</script>
```

One `naksha` global, 77 KB minified, 38 KB over the wire.

---

## What's supported

| | Supported | Checked in CI by |
| --- | --- | --- |
| **Node** | 18 and up | importing, requiring *and* script-loading the built `dist` on 18 |
| **React** | 16.14 → 19, optional peer | server-rendering the wrapper once per major |
| **Formats** | ESM, CommonJS, IIFE global | all three asserted against the same `dist` |
| **Bundlers** | anything reading `exports`; webpack 4 and CRA 4 via `main` / `module` / `browser` | an ES2018 bundle those parsers accept |
| **TypeScript** | `node`, `node16`, `nodenext`, `bundler` | a throwaway consumer typechecked in each mode |
| **Browsers** | ES2018 and up | — |
| **SSR** | synchronous, no `"use client"`, no loading state | the raster decodes without `await` |

- **The compatibility bundles are ES2018**, because webpack 4 — the reason they
  exist — parses with an acorn older than optional chaining. The primary ESM
  build stays ES2022.
- **Declarations ship twice**, `.d.ts` for `import` and `.d.cts` for `require`,
  so CommonJS TypeScript gets real types rather than TS1479.
- **16.14 is the React floor** — the oldest React shipping `react/jsx-runtime`.

**Known gaps:** React 16 and 17 cannot be loaded through Node's ESM resolver
(no `exports` map, so `react/jsx-runtime` does not resolve as a bare specifier);
bundlers and `require()` are fine. Deno and Bun are untested but expected to work.

---

## How it works

### Geometry is a bitmap, not a polygon set

District polygons are rasterized **once at build time** into an indexed image
where the **pixel value is the district id**, 0 meaning outside Nepal. Sampling
is one array lookup per dot, answering *inside or outside* **and** *which
district* at once — no point-in-polygon test, no reprojection, no GeoJSON.

|                | naive approach                    | naksha              |
| -------------- | --------------------------------- | ------------------- |
| Payload        | 2.1 MB GeoJSON + turf + proj4     | 42 KB, no deps      |
| Cost per zoom  | 55,176-vertex hit-tests re-run    | one array lookup    |
| Gives you      | inside/outside                    | inside/outside **and** district |

The shipped raster is 1788 × 1024 (0.45 km/cell), finer than the dot spacing at
any viewport you are likely to pass.

### The viewport is a bounding box, not a scale factor

Each viewport re-samples **its own box** at a fixed dot budget, so ground
resolution changes while dot count, DOM size and render cost stay flat. A global
grid fine enough to separate all 753 local levels would need ~14,700 dots.

| Viewport | cols × rows | dots | km/dot | districts | frame filled |
| -------- | ----------- | ---- | ------ | --------- | ------------ |
| Nepal | 70 × 40 | 1,130 | 11.40 | 77 | 40% |
| Bagmati | 51 × 40 | 1,758 | 3.86 | 26 | 86% |
| Sudurpashchim | 29 × 40 | 808 | 5.85 | 16 | 70% |

`VIEWS` names the country and its seven provinces and stops there — the last
column is why. A box drawn wholly inside Nepal contains no border, so the
silhouette is a filled rectangle. `bbox` itself is unrestricted and a box that
tight still separates your own points well (250 pickups around Kathmandu occupy
5 dots nationally, 221 across the valley); just don't expect a recognisable
Nepal behind them.

### Zoom and pan are arithmetic on that box

`zoomBbox(bbox, factor)` scales a box about a point — `factor > 1` in, `< 1`
out — and returns another box to pass straight back as `bbox`:

```ts
let view = NEPAL_BBOX;
zoomIn.onclick = () => { view = zoomBbox(view, 2); draw(); };
zoomOut.onclick = () => { view = zoomBbox(view, 0.5); draw(); };

const draw = () => (el.innerHTML = renderNepal({ bbox: view, points }));
```

Bounded at both ends, so a `+` button cannot walk off the map: zooming out is
capped by the national frame, zooming in stops at `MIN_ZOOM_SPAN` (0.32°), where
one dot covers one raster cell.

| Step | lng span | dots | km/dot | districts | cells/dot |
| ---- | -------- | ----- | ------ | --------- | --------- |
| 0 | 8.16° | 1,130 | 11.401 | 77 | 25.5 |
| 1 | 4.08° | 1,995 | 5.701 | 42 | 12.8 |
| 2 | 2.04° | 2,547 | 2.851 | 18 | 6.4 |
| 3 | 1.02° | 2,800 | 1.425 | 9 | 3.2 |
| 4 | 0.51° | 2,800 | 0.713 | 3 | 1.6 |
| 5 | 0.32° | 2,800 | 0.447 | 3 | 1.0 |

Ground resolution moves 25× down that ladder while the dot count moves 2.5×.

**Panning needs `align`, or the map deforms as it moves.** The dot grid is
anchored to the viewport, so a box sliding by a fraction of a cell re-samples
every cell against different ground: the dots hold still while the country
slides underneath, and the silhouette re-forms in place. `align` pins the
lattice to a box the gesture holds still.

```ts
let view = NEPAL_BBOX;
let lattice = view;                      // re-pinned by zoom, held by a drag

const draw = () => (el.innerHTML = renderNepal({ bbox: view, align: lattice, points }));

const onZoom = (f) => { view = zoomBbox(view, f); lattice = view; draw(); };
const onDrag = (to) => { view = panBbox(view, to, { align: lattice }); draw(); };
```

The field is sampled on that lattice and extended to cover the viewport, with
the sub-cell remainder in `grid.viewBox` — which becomes the SVG's viewBox
origin, so the map glides rather than stepping a whole dot. Costs one extra row
and column of dots (4% of the budget), and a dot's ground size then varies up to
3.4% across a full-country pan instead of the column count varying.
`align: bbox` is the default, so a map that never pans is unchanged.

`districtBbox(id)` gives a district's bounds, to zoom to one. Two of the 77 are
narrower than the zoom floor once padded — Bhaktapur at 0.209° and Lalitpur at
0.255° — so open those out rather than framing them exactly.

### An overview map is a second render

Two options, easy to confuse: **`viewport` is for a map that *is* the overview**
and draws the window for some other view; **`inset` is for the detail map** and
puts the whole overview inside it.

```ts
renderNepal({ bbox: view, routes, inset: { corner: "top-right" } });   // one SVG
const overview = renderNepal({ height: 14, viewport: view });          // a second element
```

`inset` lands in the one string, so it survives being written to a file,
emailed, printed or server-rendered. `corner` takes any of the four, `size` is
its width as a fraction of the map's own (default 0.22), `margin` the gap in dot
units (default 1), `height` its own dot budget (default 12), `bbox` what it
covers. `inset: true` accepts every default, and colouring follows the map's own
unless you pass `regionColor`.

- **The inset paints a panel behind itself using the theme background.** If that
  is `"transparent"`, as it is whenever the map is drawn straight onto a page,
  pass `inset: { background: "#fff" }` or the inset is see-through.
- It forces `edgeFade: 0`: at 12 rows most of the country *is* edge, so the fade
  washes the silhouette away. `inset: { theme: { edgeFade: 1 } }` puts it back.
- **Don't pass `viewport` at full extent** — a rectangle around the whole country
  marks nothing and tints the map underneath. Leaving the overview itself on
  screen at full extent is worth it; it is what the reader orients against.

Where a second map goes is entirely yours — naksha returns a string and has no
opinion about the DOM around it. For gestures the callbacks don't cover,
`eventPoint(svg, event)` converts a pointer event to viewBox coordinates and
`unproject(grid, x, y)` takes those back to a coordinate:

```ts
host.addEventListener("pointerdown", (e) => {
  const svg = host.querySelector("svg");     // re-query: innerHTML replaced the old node
  const at = svg && eventPoint(svg, e);
  if (!at) return;
  host.setPointerCapture(e.pointerId);
  view = panBbox(view, unproject(overviewGrid, at.x, at.y), { align: lattice });
  draw();
});
```

Three things if you make that draggable: re-query the SVG (a detached node's
`getScreenCTM()` returns null, so a drag dies after one move), throttle to
`requestAnimationFrame` (a full viewport change measures 2.5 ms median, but a
60-move burst is 60 renders where one will do), and set `touch-action: none` on
the wrapper or a touch drag scrolls the page.

### Clustering is the core primitive

At the national view one dot covers ~130 km², so an operator's entire Kathmandu
footprint collapses onto a handful of dots. Silently stacking pins would be a
bug, so snapping and clustering are the same operation and always on — and
**zoom is the declustering mechanism**.

Snapping is **district-aware**. A dot belongs to the district covering *most* of
its cell, so a town near a border often falls in a cell its neighbour wins.
naksha pins to the nearest dot of the district the coordinate is genuinely in,
searching no further than **one dot spacing**, so a pin never contradicts its own
label. Of the 121 headquarters and towns measured, 12 need it; the furthest
travels 0.79 of a dot spacing.

### Arc height scales with √distance

District-HQ distances span **253×** (3.2 km to 819 km), so a linear rule makes
short hops invisible and long ones a rainbow. naksha uses
`h = clamp(k·√d, floor, ceil)` with a floor of 1.5 dot-spacings.

### Labels cover dots, and placement is the trade

A label's halo is the background colour, so it *erases* the dots under it — on a
dot map that is data. The frame is 59.6% empty but all of it is outside the
outline, so `labelPlacement` is a choice about what to give up.

| | buries its own district | own dots | others | median move |
|---|---|---|---|---|
| `above` (default) | 74 of 77 labels | 5.0 | 6.7 | 0.8 |
| `avoid-region` | 1 of 77 | 0.1 | 5.5 | 5.6 |
| `clear` | 1 of 77 | 0.0 | 1.2 | 12.8 |

`avoid-region` refuses to cover dots of the region the point sits in, spilling
onto a neighbour, so the label still reads as attached. `clear` refuses to cover
any dot and runs straight up or down behind a leader line, but the only clean
space is off the outline, so labels travel. Both refuse to overlap another label
or pin, and both fall back rather than refusing to draw.

Dot columns are per-label means; distances are dot-widths from pin to anchor in
a viewBox 70 wide. The numbers are sample-dependent — the 74 headquarters at
their real coordinates give 12.0 and 68 of 74. `npm run verify` reprints the
table from the renderer's own placement functions.

### Stacking a long name

A newline draws the label on a new line, placed as one box, so every mode above
still applies. It is what makes `"Lahan, Siraha, Madhesh Province"` usable at the
national view at all — on one line it is a third of the frame wide.

```ts
const p = placeParts(stop);
renderSvg(grid, {
  labels: true,
  labelPlacement: "avoid-region",
  points: [{ ...stop, label: [p.name, p.district, p.province].join("\n") }],
});
```

| 77 districts, HQ + district + province | box width | hides | buries its own |
|---|---|---|---|
| one line, `above` | 22.3 | 43.3 | 26 of 77 |
| stacked, `above` | 10.2 | 39.4 | 31 of 77 |
| one line, `avoid-region` | 22.3 | 12.1 | 1 of 77 |
| stacked, `avoid-region` | 10.2 | **7.9** | **none** |

Stacking narrows the box and makes it taller, which nearly cancels under
`above`; the win shows once something is searching for the gap. Blank lines are
dropped, the block grows *upward* so the bottom line stays where a one-line
label would have been, and the accessible `<title>` keeps your string as written.
`labelLineHeight` (default 1.2) sets the spacing. One caveat: `above` never
searches, so a tall block on a far-northern pin can run off the top of the frame.

### Hit-testing is arithmetic, not DOM

The dot field collapses to one `<path>` per colour — ~1130 dots become a couple
of nodes — and hover and click don't give that back. The viewBox is
`0 0 cols rows`, so the cell under the pointer is `floor(x), floor(y)` and one
`Map` lookup answers which dot, and therefore which district, is there.

- **A dot owns its whole cell.** The painted circle is 0.3 units across in a
  1-unit cell, so `:hover` on per-dot elements would leave 70% of the map dead.
- **Interaction costs no DOM.** `dots: "circles"` exists for per-dot CSS, not for
  events. The demo's district view runs fully interactive at **24 DOM nodes**.

---

## SSR

The raster is run-length encoded, inlined as base64 and decoded **synchronously**
on first use. Deflate would be ~35% smaller but needs `node:zlib` (absent in
browsers) or `DecompressionStream` (async), and an async raster forces every
consumer into a loading state or a client-only boundary. The extra ~14 KB buys a
component that renders inside a React server component with no `"use client"`,
no `Image`, no canvas, no `fetch` and no top-level await.

---

## API

| Export | Purpose |
| ------ | ------- |
| `renderNepal(options)` | Grid + SVG string in one call |
| `nepalGrid(options)` | Build a dot grid over Nepal or a viewport |
| `nepalRaster()` | The 77-district region raster |
| `renderSvg(grid, options)` | Render any grid to SVG |
| `buildGrid(raster, options)` | Sample any raster into a dot grid |
| `clusterPoints(grid, points)` | Snap and cluster points onto dots |
| `snapPoint(grid, point)` | The dot a coordinate belongs on — its own district's, not just its cell's |
| `attachInteractions(svg, grid, options)` | Hover, click and keyboard on a rendered map |
| `hitTest(grid, x, y, tolerance?)` | The dot at a viewBox coordinate, or `undefined` |
| `districtAt({ lng, lat })` | Which district contains a point |
| `districtById` / `districtByName` | Lookups over the 77 districts |
| `findDistrict(name)` | Lookup by either script, tolerant of decomposed vowels |
| `PROVINCES` / `provinceById(id)` | The seven provinces and the district ids in each |
| `regionAnchor(grid, id)` | The dot that stands for a district — read the caveat below |
| `Region.hqAt` | Where a district's headquarters is, for 74 of the 77 |
| `pickLabel` / `bothLabels` / `regionName` | Bilingual label helpers |
| `arcPath` / `arcHeight` / `routePath` | Arc geometry |
| `zoomBbox(bbox, factor, opts?)` | Scale a viewport about a point, bounded by the frame and the raster's resolution |
| `panBbox(bbox, to, opts?)` | Move a viewport to a new centre without changing what the map looks like — the pan half of `zoomBbox` |
| `clampBbox(bbox, limit?)` | Slide a box back inside the frame, shrinking only if it cannot fit |
| `districtBbox(id)` | A district's bounds — the box to zoom to when one is picked |
| `unproject(grid, x, y)` | viewBox coordinates back to `{ lng, lat }` — the inverse of `project` |
| `eventPoint(svg, event)` | A pointer event in viewBox coordinates, for gestures you wire yourself |
| `viewportRect(grid, bbox)` | Where a viewport lands on a grid, clipped — the geometry behind `viewport` |
| `renderInset(grid, theme, opts?)` | The inset layer on its own, as a `<g>` — pass `regionColor` yourself, there being no parent map to inherit it from |
| `MIN_ZOOM_SPAN` | 0.32°, the narrowest box `zoomBbox` will produce |
| `VIEWS` | The country and its seven provinces, as bounding boxes |
| `lightTheme` / `darkTheme` | Theme presets |
| `placeParts(point, lang?)` | The pieces of a place's name: its own, district, province, HQ, p-code |
| `describePlace(point, opts?)` | `"Lahan, Siraha"` — place then district |
| `Naksha` (`nepal-naksha/react`) | React component |

Every colour and size is a theme prop, and all sizes are in **dot units** — the
viewBox is `0 0 cols rows`, so 1 unit = 1 dot spacing and a theme looks
identical at every zoom. That includes label text (`label`, `labelSize`,
`labelLineHeight`) and the hairline joining a moved label to its pin (`leader`,
`leaderWidth`, `leaderOpacity`), kept separate because a line as dark as the
label reads as a route.

### Notable options

- `sampling: "dominant" | "center"` — `dominant` (default) gives each dot the
  district covering most of its cell. `center` samples the midpoint only:
  cheaper, but at z1 it discards ~99% of the raster.
- `ensureRegions` (default `true`) — guarantees every district visible in the
  viewport gets at least one dot. See [Three properties](#three-properties-worth-knowing).
- `align` — sample on *this* box's dot lattice rather than on `bbox`'s own, so a
  viewport can move between dots. What makes a pan glide; the sub-cell remainder
  comes back as `grid.viewBox`. `align: bbox` is the default.
- `lang: "en" | "np"` — which script to draw. Falls back per label, and
  accessible titles always carry both.
- `labelPlacement` — `above` (default), `avoid-region`, `clear`, or `below`.
- `animate` — reveal routes with a dash animation and a pulse. Respects
  `prefers-reduced-motion`; static output is the default, so print and
  server-side rasterization both work.
- `viewport` / `inset` — the two overview halves, above.
- `idPrefix` (default `"naksha-"`) — prefixes each route element's id. **Give
  every map on a page its own**: ids are document-wide, so two maps left on the
  default emit the same ones.

### Naming a place

`placeParts` hands back the pieces; compose whatever you like.

```ts
import { placeParts, describePlace } from "nepal-naksha";

const lahan = { lng: 86.4833, lat: 26.72, label: "Lahan", labelNp: "लहान" };

describePlace(lahan);                       // "Lahan, Siraha"
describePlace(lahan, { lang: "np" });       // "लहान, सिराहा"
describePlace(lahan, { separator: " · " }); // "Lahan · Siraha"

const { name, district, province, hq, pcode } = placeParts(lahan);
```

`describePlace` degrades rather than producing something odd: a point with no
name of its own is just its district, one outside Nepal is just its name, and a
place named after its district is not doubled into "Siraha, Siraha".

Nothing here knows about cities — a point's own name is whatever you pass in
`label`. The finest place name naksha ships is the district HQ (`hq`), which
carries a coordinate (`hqAt`) so it pins exactly. To draw place, district and
province together, join with newlines — see [Stacking a long name](#stacking-a-long-name).

### Placing a village naksha has never heard of

`points` takes any coordinate — it does not have to be in naksha's data:

```ts
renderNepal({ points: [{ lng: 86.4833, lat: 26.72, label: "My village" }] });
```

If the place *is* a district headquarters, 74 of the 77 carry a coordinate:

```ts
districtByName("Jumla")!.hq;    // "Chandannath"
districtByName("Jumla")!.hqAt;  // { lng: 82.186112, lat: 29.288961 }
```

`hqAt` is null for the three districts the 2015 splits created — Nawalparasi
East, Rukum East and Rukum West; see [Data](#data).

The coordinate barely has to be right: at the national view a dot spans ~11 km
(`grid.kmPerDot`), so anything within about 5 km snaps to the same dot.

**What not to do:** reach for `regionAnchor` to place a town whose coordinate you
don't have. It returns the dot nearest a district's centre of mass — right for
pointing at *a district*, wrong for a settlement inside one. Against 30 real
towns it agrees 10% of the time, median miss 15 km, worst 40 km. Label an anchor
with the district's name, not a town's.

---

## Interaction

`renderNepal` returns a string, so wiring events is a separate, browser-only
step against the element you mounted:

```ts
import { renderNepal, nepalGrid, attachInteractions, districtById } from "nepal-naksha";

const grid = nepalGrid();
el.innerHTML = renderNepal({ points });

const detach = attachInteractions(el.querySelector("svg")!, grid, {
  points,            // so pin hits resolve to their cluster
  highlight: true,   // paints the hovered district — one extra <path>
  onRegionEnter: (dot) => setDistrict(districtById(dot.region)), // once per district
  onDotEnter: (dot) => setCoord(dot.lng, dot.lat),               // every dot
  onRegionClick: (dot) => select(dot.region),
  onPointClick: (cluster) => open(cluster.points),
  onRouteClick: (route, i) => open(route),
});
```

- `detach()` removes every listener and the highlight layer.
- Pins and routes take priority over the dot beneath them, so a click on a pin
  never also reports the district under it. `onDotLeave` fires when the pointer
  moves onto a pin for the same reason.
- `onRegionEnter` fires once per **district**, not once per dot, so a bound
  readout updates when the answer changes rather than forty times across Dolpa.
  Its `dot` is whichever one you crossed the border on — use `onDotEnter` for
  the one actually under the pointer.
- `highlight: true` lights the whole district; `highlight: { mode: "dot" }`
  lights only the dot.
- Arrow-key traversal reports through the same handlers.

In React the same thing is props and the component attaches and detaches for
you, with one signature difference: the handlers hand you the resolved district
first and its dot as the third argument.

```tsx
<Naksha points={points} highlight={{ mode: "dot" }} keyboard
  onRegionEnter={(district) => setHovered(district)}
  onDotEnter={(dot) => setCoord([dot.lng, dot.lat])} />
```

### Touch and keyboard

- `tolerance` (dot units) widens region hit-testing so a fingertip just off a
  dot still resolves. Default `0` — exact cell only, so a point outside Nepal is
  a miss rather than the nearest district.
- `keyboard: true` makes the map focusable and traversable with the arrow keys,
  Enter and Escape, and upgrades `role="img"` to `role="group"`. It **cannot
  announce for you**: pair it with an `aria-live` readout fed from
  `onRegionEnter`, because only you know what a district means in your app.

---

## Bilingual labels

Every district, province and headquarters ships in **English and Devanagari**,
and any label you pass can carry both:

```ts
renderNepal({
  points: [{ lng: 85.3591, lat: 27.6966, label: "Kathmandu", labelNp: "काठमाडौँ" }],
  labels: true,
  lang: "np", // draws काठमाडौँ
});

districtAt({ lng: 83.98, lat: 28.2 })!.nameNp; // "कास्की"
findDistrict("कास्की")!.name;                  // "Kaski"
```

`lang` selects what is *drawn*; the accessible title always carries both, so
switching language never hides a name from search or a screen reader. Labels
fall back per item. The default font stack names Devanagari faces explicitly —
`system-ui` alone does not cover Devanagari everywhere, and a missing face
renders as tofu rather than falling back.

---

## Data

- **Geometry:** [mesaugat/geoJSON-Nepal](https://github.com/mesaugat/geoJSON-Nepal)
  (MIT) — 77 districts with OCHA p-codes and province links, including the
  post-2015 splits.
- **Names:** [sagautam5/local-states-nepal](https://github.com/sagautam5/local-states-nepal)
  (MIT) — Devanagari for districts, provinces and headquarters.
- **HQ coordinates** cover 74 of 77. The upstream point set is the pre-2015
  75-district one, so no point belongs to a district the splits created; the
  single Rukum point sits 1.9 km from the East/West boundary, so neither half
  claims it. `Region.hqAt` is null for those three.
- Nothing from `johan/world.geo.json` — unlicensed (NOASSERTION), and its Nepal
  outline is 23 vertices for the entire country.

The two sources are joined through an **explicit alias table**, not fuzzy
matching: 13 districts are romanised differently between them, and fuzzy
matching is what would eventually pair "Rukum East" with "Rukum West". The build
fails rather than guessing if any district is unmatched, matched twice, or
disagrees on province. Corrections applied on top, each guarded by a test:

- **`काेशी` → `कोशी`** — typed as क + ा + े instead of क + ो. Identical on
  screen, a different string, and Unicode normalisation does not repair it.
- **Rukum normalised** to the official noun-first form; upstream mixed
  `पूर्वी रूकुम` with `रुकुम पश्चिम`.
- **Jhapa and Morang headquarters** repeated the district name where English
  correctly names Bhadrapur and Biratnagar.

The naming convention differs between scripts for two districts: OCHA's English
keeps the parent name (`Nawalparasi East`/`West`) while the Devanagari uses the
current official names (`नवलपुर`/`परासी`). Both are correct.

---

## Three properties worth knowing

Each is arithmetic rather than preference, and between them they explain most of
what the defaults do.

1. **The frame comes from district geometry, not a country outline.** Simplified
   outlines have had their extreme points cut, so a box taken from one sits
   3–5 km *inside* Nepal's real border and clips the far west and the Terai. The
   build fails if the frozen frame stops containing the 77-district source.
2. **At a national view some headquarters share a dot.** Kathmandu and
   Lalitpur's HQs are 3.2 km apart; one dot spans 11.4 km. Separating them is
   grid *phase*, not resolution — across 40 sub-cell offsets `height: 40` never
   reaches zero collisions, and giving all 77 their own dot would take ~250 rows,
   a solid fill. The cluster badge states what is underneath rather than hiding it.
3. **`ensureRegions` should stay on.** Bhaktapur is ~119 km², smaller than one
   national-view cell (~130 km²), so it never wins a cell on area and would be
   absent entirely — impossible to highlight, filter or click. It grants every
   visible district its best-covered cell, taking only from districts with dots
   to spare.

---

## Development

**Node 22.18+ to develop** — the repo runs its TypeScript sources directly via
native type stripping, so there is no build step for tools or tests. `devEngines`
enforces the floor and `.nvmrc` pins it. The *published* package needs only
**Node 18+**, which CI asserts on every commit.

```bash
nvm use           # Node 22, per .nvmrc
npm install
npm run fetch     # download upstream GeoJSON into .cache/
npm run data      # rebuild the raster + generated module
npm test          # node:test, no framework
npm run check     # tsc --noEmit
npm run verify    # re-measure every number this README quotes
npm run dev       # build + serve the landing page on :8000, watching
npm run site      # build the landing page to site/dist
```

The generated raster is committed, so consumers and CI never rasterize anything;
CI re-runs the build and fails if the artifact drifts from its source.

`npm run verify` is not a test but a measurement harness: it re-derives every
figure quoted here from the shipped artifacts, so a claim that stops being true
shows up as a changed number rather than as stale prose.

Four CI jobs cover what `npm test` structurally cannot:

| Job | What it asserts |
| --- | --- |
| `test` | Typecheck, tests and build on Node 22.18, 22 and 24 |
| `consumer` | The built `dist` imports, requires **and** script-loads on Node 18, and a throwaway consumer typechecks in all four module resolution modes |
| `react` | The wrapper server-renders on React 16, 17, 18 and 19, installed `--no-save` so the peer range stays honest |
| `artifacts` | The geometry rebuilds reproducibly — `git diff --exit-code` on `src/generated` |

---

## Contributing

Issues and pull requests welcome at
[erajkhatiwada/naksha](https://github.com/erajkhatiwada/naksha). Before a PR:

1. `npm run check && npm test` must pass. If you touched the data pipeline, run
   `npm run fetch && npm run data` and commit the regenerated `src/generated`.
2. **Measure, don't assert.** Every number here came from `npm run verify` or a
   test. If a change moves one, re-measure it rather than softening the wording.
3. **Respect the boundary.** No pathfinding, no tiles, no geocoding, no live
   tracking — see [the non-goals](#this-is-a-presentation-layer-map-not-a-navigation-map).
   These are permanent, not a backlog.
4. Explain *why* in the PR description. Commits are one short subject line;
   rationale lives in code comments and the working notes.

---

## Acknowledgments

[mesaugat/geoJSON-Nepal](https://github.com/mesaugat/geoJSON-Nepal) for the
district geometry and
[sagautam5/local-states-nepal](https://github.com/sagautam5/local-states-nepal)
for the Devanagari names, both MIT, and OCHA Nepal, whose p-code scheme the
district ids join on. See [Data](#data) for what is used from each.

---

## License

MIT © Eraj Khatiwada. Commercial use is unencumbered — see [LICENSE](./LICENSE).
