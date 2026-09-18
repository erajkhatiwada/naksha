# naksha · नक्सा

[![CI](https://github.com/erajkhatiwada/naksha/actions/workflows/ci.yml/badge.svg)](https://github.com/erajkhatiwada/naksha/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#whats-supported)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](#whats-supported)
[![Types](https://img.shields.io/badge/types-included-blue.svg)](#whats-supported)

A modern, simple Nepal map. Renders Nepal as a dot grid with routes, flows and
coverage drawn on top.

**Zero runtime dependencies. SSR-safe. The entire geometry layer is 42 KB.**

→ **[Live demo](https://erajkhatiwada.github.io/naksha/)**

```bash
npm i nepal-naksha
```

---

## This is a presentation-layer map, not a navigation map

Leaflet, Mapbox and OSM own turn-by-turn routing and street detail. naksha owns
*beautiful stylized Nepal inside an application*.

It takes an **ordered list of stops** and renders it. Whether anything actually
travels that way is your data's problem, not the map's.

**Non-goals, permanently:**

- **No pathfinding.** Accepting "find the route from A to B" means building a
  routing engine and competing with OSRM.
- No street-level detail, no basemap tiles, no live vehicle tracking.
- No geocoding.

---

## Features

- **All 77 districts in English and Devanagari**, with p-codes, provinces and
  headquarters coordinates. Lookups work in either script.
- **Routes, networks and coverage** — arcs whose height scales with √distance,
  points that snap and cluster onto dots, districts coloured by any value.
- **Four label-placement rules**, each a measured trade between covering dots
  and moving away from the pin. Multi-line labels place as one block.
- **Hover, click and keyboard** that cost no DOM: hit-testing is arithmetic, so
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

React is an optional peer dependency, **16.14 and up** — the core has no
framework attached.

### Anywhere else

```ts
import { renderNepal, VIEWS } from "nepal-naksha";

const svg = renderNepal({
  bbox: VIEWS.bagmati,
  routes: [{ stops: pickups }],
  points: pickups,
  theme: { dot: "#e2e8f0", route: "#dc2626" },
});
```

`renderNepal` returns a self-contained SVG string with no external references,
so it works in Node, in a Worker, in an email, or piped straight to a file.

### CommonJS

```js
const { renderNepal, districtAt } = require("nepal-naksha");
```

### No build step at all

```html
<script src="https://unpkg.com/nepal-naksha"></script>
<script>
  document.body.innerHTML = naksha.renderNepal({ points: stops });
</script>
```

One `naksha` global, 77 KB minified and 38 KB over the wire, no bundler and no
module loader involved.

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

Three of those deserve a reason rather than a checkmark:

**The compatibility bundles are ES2018, not ES2022.** Webpack 4 — the reason
they exist — parses with an acorn older than optional chaining. Shipping ES2022
would mean the package resolves and *then* fails, in the consumer's build
rather than in ours. The primary ESM build stays ES2022.

**Type declarations ship twice**, `.d.ts` for `import` and `.d.cts` for
`require`, so a CommonJS TypeScript file gets real types rather than TS1479,
*"cannot be imported with `require`"*.

**16.14 is the React floor** because it is the oldest React that ships
`react/jsx-runtime`. The wrapper only ever calls `useEffect`, `useMemo` and
`useRef`, so nothing newer is needed; all four majors render identically.

### Known gaps

- **React 16 and 17 cannot be loaded through Node's ESM resolver.** They have
  no `exports` map, so `react/jsx-runtime` does not resolve as a bare ESM
  specifier. Bundlers targeting those versions resolve it fine — this is a gap
  in Node's view of old React, not in naksha. `require()` works on every
  version.
- **Deno and Bun are untested.** There is nothing platform-specific in the
  package, so both are expected to work; neither is asserted.

---

## How it works

### Geometry is a bitmap, not a polygon set

District polygons are rasterized **once at build time** into an indexed image
where the **pixel value is the district id** and 0 means outside Nepal. At
runtime, sampling it is one array lookup per dot that answers *inside or
outside* **and** *which district* simultaneously — at any zoom, with no
point-in-polygon test, no reprojection and no GeoJSON.

|                | naive approach                    | naksha              |
| -------------- | --------------------------------- | ------------------- |
| Payload        | 2.1 MB GeoJSON + turf + proj4     | 42 KB, no deps      |
| Cost per zoom  | 55,176-vertex hit-tests re-run    | one array lookup    |
| Gives you      | inside/outside                    | inside/outside **and** district |

The shipped raster is 1788 × 1024 (0.45 km/cell) — finer than the dot spacing
at every viewport the library names, and finer than any box you are likely to
pass it.

### The viewport is a bounding box, not a scale factor

naksha never re-resolves a *global* grid — a grid fine enough to separate all
753 local levels would need ~14,700 dots, which is a solid fill rather than a
dotted map. Instead each viewport re-samples **its own box** at a fixed dot
budget, so ground resolution changes while dot count, DOM size and render cost
stay flat.

| Viewport | cols × rows | dots | km/dot | districts | frame filled |
| -------- | ----------- | ---- | ------ | --------- | ------------ |
| Nepal | 70 × 40 | 1,130 | 11.40 | 77 | 40% |
| Bagmati | 51 × 40 | 1,758 | 3.86 | 26 | 86% |
| Sudurpashchim | 29 × 40 | 808 | 5.85 | 16 | 70% |

A 3× change in ground resolution moves the dot count by well under 2×, and every
one builds in milliseconds.

**`VIEWS` names the country and its seven provinces, and stops there.** That is
the last column's doing: a box drawn wholly inside Nepal contains no border, so
every cell is inside it and the silhouette is a filled rectangle. The Kathmandu
Valley at this dot budget measures **100.0% filled with zero edge dots** — a
square of dots, not a map.

`bbox` itself is unrestricted, and a box that tight is still good for one thing:
separating your own points. 250 pickups around Kathmandu occupy 5 dots
nationally and 221 across the valley. Reach for it when the pins are the subject
and the dot field is texture — just don't expect a recognisable Nepal behind
them. `npm run verify` prints the fill and edge-dot columns this rests on.

### Zoom is arithmetic on that box, and an overview map is a second render

Because a viewport *is* a box, zooming is arithmetic on the box rather than a
transform on the output. `zoomBbox(bbox, factor)` scales one about a point —
`factor > 1` in, `< 1` out — and returns another box to pass straight back as
`bbox`:

```ts
let view = NEPAL_BBOX;
zoomIn.onclick = () => { view = zoomBbox(view, 2); draw(); };
zoomOut.onclick = () => { view = zoomBbox(view, 0.5); draw(); };

const draw = () => (el.innerHTML = renderNepal({ bbox: view, points }));
```

It is bounded at both ends, so a `+` button cannot walk off the map. Zooming out
is capped by the national frame; zooming in stops at `MIN_ZOOM_SPAN` — 0.32° of
longitude, which is where the raster runs out. At that width one dot covers one
raster cell, **0.447 km/dot against 0.447 km/cell**, and narrower just upsamples
the bitmap. Both spans scale together, so the box keeps its shape and the map is
never stretched. `clampBbox` is the same containment on its own, for a pan.

| Step | lng span | dots | km/dot | districts | cells/dot |
| ---- | -------- | ----- | ------ | --------- | --------- |
| 0 | 8.16° | 1,130 | 11.401 | 77 | 25.5 |
| 1 | 4.08° | 1,995 | 5.701 | 42 | 12.8 |
| 2 | 2.04° | 2,547 | 2.851 | 18 | 6.4 |
| 3 | 1.02° | 2,800 | 1.425 | 9 | 3.2 |
| 4 | 0.51° | 2,800 | 0.713 | 3 | 1.6 |
| 5 | 0.32° | 2,800 | 0.447 | 3 | 1.0 |

Ground resolution moves 25× down that ladder while the dot count moves 2.5× and
then stops. Step 5 is the floor — further presses return the same box, and a
full ladder in and back out lands on the frame to within 2×10⁻⁸ m.

**There are two ways to put an overview on the page**, and which one you want
depends on whether it has to be interactive.

### Inset it into the map — one option, one SVG

The two options are named apart because they are the halves of the same pair and
are otherwise easy to confuse: **`viewport` is for a map that *is* the overview**
and draws the window for some other view, while **`inset` is for the detail map**
and puts the whole overview inside it.

```ts
renderNepal({ bbox: view, routes, inset: { corner: "top-right" } });
```

`corner` takes any of the four. `size` is its width as a fraction of the map's
own (default 0.22), `margin` the gap from the edges in dot units (default 1),
`height` its own dot budget (default 12, about 105 dots), and `bbox` what it
covers (default the whole country). The window is drawn only when the map is
looking at a sub-region — at full extent there is nothing to mark, so you get
the silhouette alone. `inset: true` accepts every default.

Everything lands in the one string, so it survives being written to a file,
emailed, printed or server-rendered, with no second element to position and no
CSS. The React component takes the same prop.

Two things to know. The inset paints a panel behind itself so the map's own dots
don't show through, using the theme background — **if that is `"transparent"`,
as it is whenever the map is drawn straight onto a page, pass
`inset: { background: "#fff" }` or the inset is see-through.** And it forces
`edgeFade: 0`, because fading partly-covered cells softens a border at 40 rows
but at 12 rows most of the country *is* edge and the same rule washes the
silhouette away; `inset: { theme: { edgeFade: 1 } }` puts it back.

### Or render a second map and place it yourself

Reach for this when the overview has to be dragged, clicked, or given its own
controls — that needs a DOM this renderer deliberately doesn't touch. Pass the
detail view's box as `viewport` and you get a window drawn on it:

```ts
const overview = renderNepal({ height: 14, viewport: view });
```

That is 140 dots over 24 × 14 — a locator, not a second map. Nothing links the
two: `viewport` only draws a rectangle where it is told, clipped to the frame,
and omitted entirely when the two boxes do not overlap. It is themed through
`viewport`, `viewportWidth` and `viewportOpacity`.

**Where it goes is then entirely yours.** naksha hands back an SVG string (or,
in React, an element) and has no opinion about the DOM around it — corner
overlay, sidebar, above the map, a separate panel, two at once. The demo pins it
to a corner with four lines of CSS and offers all four from a control; that is
the demo's choice, not the library's.

Showing it is the same kind of decision, and it is two decisions rather than
one — whether to render the overview, and whether to draw the window on it:

```ts
const zoomed = view.hi - view.lo < NEPAL_BBOX.hi - NEPAL_BBOX.lo;

// Always on screen, window only once there is a sub-region to mark.
if (show === "always" || (show === "zoomed" && zoomed)) {
  host.innerHTML = renderNepal({
    height: 14,
    viewport: zoomed ? view : undefined,
  });
}
```

Keep those apart. Passing `viewport` at full extent draws a rectangle around the
entire country and washes the map underneath in the window's tint — a border
that marks nothing. Leaving the overview itself on screen at full extent is
worth it, though: it is what the reader orients against, and what they drag to
move. The demo's **Overview** control switches between `always`, `when zoomed`
and `off` (deep-linkable as `?overview=`), and defaults to always.

To zoom to a district rather than a point, `districtBbox(id)` gives its bounds,
exact to one raster cell. Two of the 77 are narrower than the zoom floor once
padded for breathing room — Bhaktapur at 0.209° and Lalitpur at 0.255° — so open
those out instead of framing them exactly.

For gestures the built-in callbacks don't cover, `eventPoint(svg, event)`
converts a pointer event to viewBox coordinates and `unproject(grid, x, y)`
takes those back to a coordinate. That pair is the whole of a double-click to
zoom, or a click on the overview to recentre:

```ts
const moveTo = (to) => {
  const w = (view.hi - view.lo) / 2;
  const h = (view.ha - view.la) / 2;
  view = clampBbox({ lo: to.lng - w, hi: to.lng + w, la: to.lat - h, ha: to.lat + h });
  draw();
};

host.addEventListener("pointerdown", (e) => {
  const svg = host.querySelector("svg");           // re-query: see below
  const at = svg && eventPoint(svg, e);
  if (!at) return;
  host.setPointerCapture(e.pointerId);
  moveTo(unproject(overviewGrid, at.x, at.y));
});
```

Two things to know if you make that overview draggable:

- **Re-render replaces the SVG node.** If you redraw by assigning `innerHTML`,
  the old `<svg>` is detached and its `getScreenCTM()` returns null — so a drag
  that captured the pointer on the SVG dies after one move. Hang the listeners
  on a stable wrapper and re-query the SVG inside it, as above.
- **Throttle to `requestAnimationFrame`.** A pointer fires faster than the
  screen refreshes. A full viewport change — grid, SVG and interaction layer —
  measures 2.5 ms median in the browser, so it fits a frame comfortably, but a
  60-move burst unthrottled is 60 renders where one will do. Coalescing to one
  per frame turns exactly that burst into a single render.

Set `touch-action: none` on the wrapper too, or a touch drag scrolls the page
instead of moving the viewport.

`npm run verify` prints the ladder, the floor and the district-bounds figures
above.

### Clustering is the core primitive

At the national view one dot covers ~130 km², so a delivery operator's entire
Kathmandu footprint collapses onto a handful of dots. An `addPin` that silently
stacked pins would be a bug for that consumer, so snapping and clustering are
the same operation and always on — and **zoom is the declustering mechanism**,
so it is built once rather than twice.

Snapping is also **district-aware**, which is a stronger guarantee than it
sounds. A dot belongs to the district covering *most* of its cell, so a town
near a border often falls inside a cell its neighbour wins — Lahan sits in
Siraha, but its cell is mostly Saptari. naksha places the pin on the nearest dot
of the district the coordinate is genuinely in, searching no further than **one
dot spacing**: the map's own resolution, so the placement asserts nothing the
dot field was not already asserting.

A pin therefore never contradicts its own label, and never lands on a colour
belonging to the wrong district. Measured across 121 headquarters and towns, 12
sit close enough to a border for this to decide the answer — Lalitpur's and
Siraha's own headquarters among them — and the furthest any of them travels is
0.79 of a dot spacing. One zoom level in, the ambiguity resolves on its own.

### Arc height scales with √distance

District-HQ distances span **253×** (3.2 km to 819 km). A linear arc height
makes Kathmandu→Bhaktapur an invisible flat line while Kathmandu→Mahendranagar
becomes a giant rainbow. naksha uses `h = clamp(k·√d, floor, ceil)` with a floor
of 1.5 dot-spacings so short hops still visibly bow.

### Labels cover dots, and placement is the trade

A label needs a halo of the background colour to stay readable over the field,
and that halo *erases* the dots underneath it. On a dot map the field is the
data, so this is not cosmetic. Measured over all 77 districts labelled at their
anchor dot at the national view, `above` — the default — erases a mean of
**11.7 dots** per label, and **74 of the 77** bury dots of the very district
they name. Bhaktapur is a single dot at that zoom, so its own label covers 100%
of it.

The frame is 59.6% empty, but that space is all *outside* the outline: inside
Nepal the field is dense enough that a label-sized box hits dots almost
anywhere. So `labelPlacement` is a choice about what to give up.

| | buries its own district | own dots | others | median move |
|---|---|---|---|---|
| `above` (default) | 74 of 77 labels | 5.0 | 6.7 | 0.8 |
| `avoid-region` | 1 of 77 | 0.1 | 5.5 | 5.6 |
| `clear` | 1 of 77 | 0.0 | 1.2 | 12.8 |

`avoid-region` searches around the pin and refuses to cover dots of the region
the point sits in, spilling onto a neighbour instead — the label stays close
enough to read as attached. `clear` refuses to cover any dot at all and runs
straight up or down from the pin so its leader line is unmistakable, but the
only clean space is off the outline, so labels travel and rely on that leader.
Both refuse to overlap another label or pin, and both keep one straggler each:
a label with nowhere clean to go falls back rather than refusing to draw.

Dot columns are per-label means, distances are dot-widths from the pin to the
label's anchor, in a viewBox 70 wide. `npm run verify` reprints the whole table
from `renderSvg`'s own placement functions — the same `placeAbove`, `placeLabel`
and `dotsUnder` the renderer calls, so the measurement cannot drift from what
ships. Note the numbers are sample-dependent: labelling the 74 headquarters at
their real coordinates instead gives 12.0 dots and 68 of 74.

### Stacking a long name

A newline in a label draws it on a new line. The whole block is placed as one
box, so every mode above still applies — and stacking is what makes a name like
`"Lahan, Siraha, Madhesh Province"` usable at the national view at all: on one
line it is a third of the frame wide.

```ts
const p = placeParts(stop);
renderSvg(grid, {
  labels: true,
  labelPlacement: "avoid-region",
  points: [{ ...stop, label: [p.name, p.district, p.province].join("\n") }],
});
```

Measured over all 77 districts at the national view, labelled HQ + district +
province — the widest thing anyone reasonably asks for:

| | box width | hides | buries its own district |
|---|---|---|---|
| one line, `above` | 22.3 | 43.3 | 26 of 77 |
| stacked, `above` | 10.2 | 39.4 | 31 of 77 |
| one line, `avoid-region` | 22.3 | 12.1 | 1 of 77 |
| stacked, `avoid-region` | 10.2 | **7.9** | **none** |

Stacking narrows the box and makes it taller, and on a dense field those very
nearly cancel under `above` — it even buries its *own* district slightly more
often, because a tall narrow box stays over the pin instead of spilling sideways
into a neighbour. The win is real once something is searching for the gap:
`avoid-region` has an easier shape to fit, and lands 7.9 against 12.1.

Blank lines are dropped rather than reserved, the block grows *upward* so the
bottom line stays where a one-line label would have been, and the accessible
`<title>` keeps your string exactly as written. `labelLineHeight` (default 1.2)
sets the spacing; Devanagari sets taller than the Latin metrics the box model
assumes, so a Devanagari-first map may want a little more. One caveat: `above`
never searches, so a tall block on a far-northern pin can run off the top of the
frame — one of the 77 does that on a single line already, three do when stacked.
The searching modes handle it.

### Hit-testing is arithmetic, not DOM

The dot field collapses to one `<path>` per colour — ~1130 dots become a couple
of nodes. Hover and click don't give that back: because the viewBox is
`0 0 cols rows`, the cell under the pointer is exactly `floor(x), floor(y)`, so
one `Map` lookup answers which dot, and therefore which district, is there.

Two consequences worth knowing:

- **A dot owns its whole cell.** The painted circle is 0.3 units across in a
  1-unit cell, so `:hover` on per-dot elements would leave 70% of the map as
  dead space between dots. Cell-based hit-testing has no gaps.
- **Interaction costs no DOM.** `dots: "circles"` exists for per-dot CSS, not
  for events. The landing page's district view runs fully interactive at
  **24 DOM nodes**.

---

## SSR

The raster is run-length encoded and inlined as base64, then decoded
**synchronously** on first use.

Deflate would be ~35% smaller, but inflating needs either `node:zlib` (absent in
browsers) or `DecompressionStream` (async). An async raster forces every
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
| `clampBbox(bbox, limit?)` | Slide a box back inside the frame, shrinking only if it cannot fit |
| `districtBbox(id)` | A district's bounds — the box to zoom to when one is picked |
| `unproject(grid, x, y)` | viewBox coordinates back to `{ lng, lat }` — the inverse of `project` |
| `eventPoint(svg, event)` | A pointer event in viewBox coordinates, for gestures you wire yourself |
| `viewportRect(grid, bbox)` | Where a viewport lands on a grid, clipped — the geometry behind `viewport` |
| `renderInset(grid, theme, opts?)` | The inset layer on its own, as a `<g>` |
| `MIN_ZOOM_SPAN` | 0.32°, the narrowest box `zoomBbox` will produce |
| `VIEWS` | The country and its seven provinces, as bounding boxes |
| `lightTheme` / `darkTheme` | Theme presets |
| `placeParts(point, lang?)` | The pieces of a place's name: its own, district, province, HQ, p-code |
| `describePlace(point, opts?)` | `"Lahan, Siraha"` — place then district |
| `Naksha` (`nepal-naksha/react`) | React component |

Every colour and size is a theme prop, and all sizes are in **dot units** —
the viewBox is `0 0 cols rows`, so 1 unit = 1 dot spacing and a theme looks
identical at every zoom. That includes label text (`label`, `labelSize`,
`labelLineHeight`) and the hairline joining a moved label back to its pin
(`leader`, `leaderWidth`, `leaderOpacity`), which is separate from the text
because a line as dark as the label reads as a route rather than a pointer.

### Naming a place

naksha never makes you accept its idea of how a name should read. `placeParts`
hands back the pieces; compose whatever you like.

```ts
import { placeParts, describePlace } from "nepal-naksha";

const lahan = { lng: 86.4833, lat: 26.72, label: "Lahan", labelNp: "लहान" };

describePlace(lahan);                       // "Lahan, Siraha"
describePlace(lahan, { lang: "np" });       // "लहान, सिराहा"
describePlace(lahan, { separator: " · " }); // "Lahan · Siraha"

const { name, district, province, hq, pcode } = placeParts(lahan);
`${name} (${pcode})`;                       // "Lahan (NP0216)"
```

`describePlace` degrades rather than producing something odd: a point with no
name of its own is just its district, a point outside Nepal is just its name,
and a place named after its own district is not doubled up into "Siraha,
Siraha". `MapPoint.label` is a free string, so a name you compose yourself goes
straight to the renderer.

Nothing here knows about cities: a point's own name is whatever you pass in
`label`, and the finest place name naksha itself ships is the district HQ
(`hq`), which carries a coordinate (`hqAt`) so it pins exactly rather than
approximately. To draw a place, its district and its province together, join the
parts with a newline and let the renderer stack them — see
[Stacking a long name](#stacking-a-long-name).

### Placing a village naksha has never heard of

You do not need it in naksha's data. `points` takes any coordinate:

```ts
renderNepal({ points: [{ lng: 86.4833, lat: 26.72, label: "My village" }] });
```

If the place you want *is* a district headquarters, you don't even need the
coordinate — 74 of the 77 carry one:

```ts
import { districtByName } from "nepal-naksha";

const jumla = districtByName("Jumla")!;
jumla.hq;    // "Chandannath"
jumla.hqAt;  // { lng: 82.186112, lat: 29.288961 }
```

`hqAt` is null for the three districts the 2015 splits created — Nawalparasi
East, Rukum East and Rukum West; see [Data](#data) for why.

And the coordinate barely has to be right. At the national view a dot spans
**~11 km** (`grid.kmPerDot`), so anything within about 5 km of the true position
snaps to the same dot — a number eyeballed off a map is plenty, and as long as
it lands in the right district the pin lands on a dot of that district. The
landing page's click mode prints the coordinate of any dot you click with a copy
button, if you would rather pick one off the map than look one up.

**What not to do:** reach for `regionAnchor` to place a town whose coordinate
you don't have. It returns the dot nearest a district's centre of mass, which
is the right answer for pointing at *a district* and the wrong answer for a
settlement inside one. Measured against 30 real Nepali towns, the anchor agrees
with the town's own dot 10% of the time; the median miss is 15 km and the worst
is 40 km, because settlements cluster on district edges — border crossings, the
Terai highway, river valleys — while a centre of mass sits inland. Label an
anchor with the district's name, not a town's.

### Notable options

- `sampling: "dominant" | "center"` — `dominant` (default) gives each dot the
  district covering most of its cell, keeping borders clean. `center` samples
  the midpoint only: cheaper, but at z1 it discards ~99% of the raster.
- `ensureRegions` (default `true`) — guarantees every district visible in the
  viewport gets at least one dot. See below for why this is not optional.
- `lang: "en" | "np"` — which script to draw. Falls back per label when the
  requested language is missing, and accessible titles always carry both.
- `labelPlacement` — where a stop's label goes. `above` (default) is flush
  above the pin and will cover dots; `avoid-region` keeps a label off the
  district it names. See below for the trade-off. A newline in a label stacks
  it onto several lines, placed as one block.
- `animate` — reveal routes with a dash animation and send a pulse along them.
  Respects `prefers-reduced-motion`. Static output (the default) draws complete
  routes, so server-side rasterization and print both work.
- `viewport` — draw a rectangle showing where another view is looking, for a
  map that *is* an overview. Clipped to the frame, and skipped when the two
  boxes miss each other entirely. Themed through `viewport`, `viewportWidth`
  and `viewportOpacity`.
- `inset` — the other half of the pair: put a miniature of the country into a
  corner of *this* map, window and all. `true` for the defaults, or
  `{ corner, size, margin, height, bbox, background, theme }`. See above.
- `idPrefix` (default `"naksha-"`) — prefixes the id on each route element, so
  routes come out as `naksha-r0`, `naksha-r1`, … in source order. Give every
  map on a page its own prefix: ids are document-wide, so two maps left on the
  default emit the same ones.

---

## Interaction

`renderNepal` returns a string, so it stays SSR-safe and static-safe. Wiring
events is a separate, browser-only step against the element you mounted:

```ts
import { renderNepal, nepalGrid, attachInteractions, districtById } from "nepal-naksha";

const grid = nepalGrid();
el.innerHTML = renderNepal({ points });

const detach = attachInteractions(el.querySelector("svg")!, grid, {
  points, // so pin hits resolve to their cluster
  highlight: true, // paints the hovered district — one extra <path>
  onRegionEnter: (dot) => show(districtById(dot.region)),
  onRegionClick: (dot) => select(dot.region),
  onPointClick: (cluster) => open(cluster.points),
  onRouteClick: (route, i) => open(route),
});
```

`detach()` removes every listener and the highlight layer. Pins and routes are
resolved from the DOM and take priority over the dot beneath them, so a click on
a pin never also reports the district under it.

`highlight: true` lights the whole hovered district. Pass
`highlight: { mode: "dot" }` to light only the dot under the pointer instead.

`onRegionEnter` fires once per **district**, not once per dot — a readout bound
to it updates when the answer changes, not forty times as you sweep across
Dolpa. The `dot` it hands you is therefore whichever one you crossed the border
on; it does not follow the pointer. Use `onDotEnter` when you need the dot
actually under it, `dot.lng` / `dot.lat` above all:

```ts
attachInteractions(svg, grid, {
  highlight: { mode: "dot" },
  onRegionEnter: (dot) => setDistrict(districtById(dot.region)), // once per district
  onDotEnter: (dot) => setCoord(dot.lng, dot.lat), // every dot
  onDotLeave: () => setCoord(null),
});
```

Both are driven by the same hit-test, so arrow-key traversal reports through
them too. `onDotLeave` also fires when the pointer moves onto a pin, since a pin
takes priority over the dot beneath it.

In React the same thing is props — the component attaches and detaches for you:

```tsx
<Naksha
  points={points}
  highlight={{ mode: "dot" }}
  keyboard
  onRegionEnter={(district) => setHovered(district)}
  onRegionLeave={() => setHovered(null)}
  onDotEnter={(dot) => setCoord([dot.lng, dot.lat])}
  onDotLeave={() => setCoord(null)}
  onPointClick={(cluster) => open(cluster.points)}
/>
```

Same semantics as above, with one signature difference: the React handlers hand
you the resolved district first and its dot as the third argument.

### Touch and keyboard

- `tolerance` (dot units) widens region hit-testing so a fingertip that lands
  just off a dot still resolves. Default `0` — exact cell only, so a point
  outside Nepal is reported as a miss rather than as the nearest district.
- `keyboard: true` makes the map focusable and traversable with the arrow keys,
  Enter and Escape. It also upgrades `role="img"` to `role="group"`, since
  `img` declares the subtree presentational — honest for a static map, wrong for
  one you can walk through. It **cannot announce for you**: pair it with an
  `aria-live` readout fed from `onRegionEnter`, because only you know what a
  district means in your app.

---

## Bilingual labels

Every district, province and headquarters ships in **English and Devanagari**,
and any label you pass in can carry both:

```ts
renderNepal({
  points: [{ lng: 85.3591, lat: 27.6966, label: "Kathmandu", labelNp: "काठमाडौँ" }],
  labels: true,
  lang: "np", // draws काठमाडौँ
});

districtAt({ lng: 83.98, lat: 28.2 })!.nameNp; // "कास्की"
findDistrict("कास्की")!.name; // "Kaski"
```

`lang` selects what is *drawn*; the accessible title always carries both, so
switching language never hides a name from search or a screen reader. Labels
fall back per-item, so a dataset with Devanagari for only the major cities
still renders everywhere.

The default font stack names Devanagari faces explicitly — `system-ui` alone
does not cover Devanagari on every platform, and a missing face renders as tofu
boxes rather than falling back.

## Data

**Geometry:** [mesaugat/geoJSON-Nepal](https://github.com/mesaugat/geoJSON-Nepal)
(MIT), `nepal-districts-new.geojson` — 77 districts with OCHA p-codes and
province links, including the post-2015 splits (Nawalparasi East/West, Rukum
East/West).

**Names:** [sagautam5/local-states-nepal](https://github.com/sagautam5/local-states-nepal)
(MIT) — Devanagari for districts, provinces and headquarters.

**Headquarters coordinates** cover 74 of the 77. The upstream point set is the
pre-2015 75-district one, so no point in it belongs to a district the 2015
splits created — and the single Rukum point sits 1.9 km from the East/West
boundary carrying West's HQ name, so neither half claims it rather than one of
them shipping the other's town. `Region.hqAt` is null for those three.

Nothing from `johan/world.geo.json` is used. It is unlicensed (NOASSERTION) and
its Nepal outline is 23 vertices for the entire country — no Terai detail, none
of the northern zigzag. Any Nepali reader clocks it instantly.

### Corrections applied to the bundled data

The two sources are joined through an **explicit alias table**, not fuzzy string
matching — 13 districts are romanised differently between them, and fuzzy
matching is exactly what would eventually pair "Rukum East" with "Rukum West".
The build fails rather than guessing if any district is unmatched, matched
twice, or disagrees on province. On top of that:

- **`काेशी प्रदेश` → `कोशी प्रदेश`.** Koshi was typed as क + ा + े instead of
  क + ो. It looks identical and is a different string, so equality checks and
  search silently fail against correctly typed input. Unicode normalisation does
  not repair it — `093E 0947` is not canonically equivalent to `094B`.
- **Rukum normalised.** Upstream wrote the pair inconsistently: `पूर्वी रूकुम`
  (adjective-first, रू) beside `रुकुम पश्चिम` (noun-first, रु). In a bilingual
  list they sit side by side, so both use the official noun-first form.
- **Jhapa and Morang headquarters.** Their Devanagari rows repeated the district
  name (`झापा`, `मोरंग`) where English correctly names Bhadrapur and Biratnagar.
  Any new occurrence of this pattern fails the build.

Note the naming convention differs between scripts for two districts: OCHA's
English keeps the parent name (`Nawalparasi East`/`West`) while the Devanagari
uses Nepal's current official names (`नवलपुर`/`परासी`). Both are correct; they
are simply different conventions.

---

## Three properties worth knowing

Each of these is arithmetic rather than preference, so knowing them up front
explains most of what the defaults do.

**1. The frame is derived from district geometry, not from a country outline.**
Simplified national outlines — `world.geo.json`'s 23-vertex NPL polygon is the
common one — have had their extreme points cut, so a bounding box taken from one
sits 3–5 km *inside* Nepal's real border and clips the far west and the Terai.
naksha derives its frame from the 77-district source itself, and the build fails
if the frozen frame no longer contains that source.

**2. At a national view, some headquarters share a dot — by arithmetic.**
Kathmandu and Lalitpur's HQs are 3.2 km apart, and one dot spans 11.4 km.
Separating them would need a cell boundary to fall inside a 3.2 km window, which
is grid *phase*, not resolution: swept across 40 sub-cell offsets, `height: 40`
never reaches zero collisions, and `height: 60` is the smallest robust one.
Giving all 77 HQs their own dot nationally would take ~250 rows — a solid fill
rather than a dotted map. So `height: 40` is the default for density, and the
cluster badge states what is underneath rather than hiding it.

**3. `ensureRegions` is on by default, and should stay on.**
Bhaktapur is ~119 km², smaller than one national-view cell (~130 km²), so it
never wins a cell on area and would be absent from the map entirely — not small,
not faint, but impossible to highlight, filter or click. Plurality sampling
cannot rescue it; the arithmetic does not allow it. `ensureRegions` grants every
visible district its best-covered cell, taking only from districts with dots to
spare, so every region in the viewport is guaranteed to be reachable.

---

## Development

**Node 22.18+ is required to develop naksha** — the repo runs its own TypeScript
sources directly via native type stripping, so there is no build step for tools
or tests. 22.18 rather than 22.6, where stripping first landed: none of the
scripts pass `--experimental-strip-types`, and 22.18 is where stripping became
the default. `devEngines` enforces the floor, so npm refuses rather than failing
later with `ERR_UNKNOWN_FILE_EXTENSION`.
Consuming the published package only needs **Node 18+**; CI asserts
that boundary on every commit by importing, requiring and script-loading the
built `dist` on 18. `.nvmrc` pins the development version, so `nvm use` picks it
up with no argument.

```bash
nvm use           # Node 22, per .nvmrc
npm install
npm run fetch     # download upstream GeoJSON into .cache/
npm run data      # rebuild the raster + generated module
npm run verify    # re-measure the spec's claims against the artifacts
npm test
npm run dev       # build + serve the landing page on :8000, rebuilding on change
npm run site      # build the landing page to site/dist
```

The generated raster is committed, so consumers and CI never rasterize
anything. CI re-runs the build and fails if the committed artifact drifts from
its source.

---

## Testing

```bash
npm test          # 112 tests, node:test, no framework
npm run check     # tsc --noEmit
npm run verify    # re-measure every number this README quotes
```

Tests run the TypeScript sources directly — there is no build step and no test
runner to configure. `npm run verify` is not a test but a measurement harness:
it re-derives every figure quoted here (dot budgets per zoom level, HQ
collisions at each grid height, label occlusion, snap distances) from the
shipped artifacts, so a claim that stops being true shows up as a changed number
rather than as stale prose.

Four CI jobs cover what `npm test` structurally cannot, because each failure
mode lives outside this repo's own typecheck:

| Job | What it asserts |
| --- | --- |
| `test` | Typecheck, tests and build on Node 22.18, 22 and 24 |
| `consumer` | The built `dist` imports, requires **and** script-loads on Node 18, and a throwaway consumer typechecks in all four module resolution modes |
| `react` | The wrapper server-renders on React 16, 17, 18 and 19, installed `--no-save` so the peer range stays honest |
| `artifacts` | The geometry rebuilds reproducibly from upstream GeoJSON — `git diff --exit-code` on `src/generated` |

The three smoke harnesses (`tools/smoke-dist.mjs`, `smoke-react.mjs`,
`smoke-types.mjs`) are plain scripts and run locally too. `smoke-react.mjs`
needs React installed, which the repo deliberately does not depend on — CI
installs it per major.

---

## Contributing

Issues and pull requests are welcome at
[erajkhatiwada/naksha](https://github.com/erajkhatiwada/naksha).

Before opening a PR:

1. `npm run check && npm test` must pass. If you touched the data pipeline, run
   `npm run fetch && npm run data` and commit the regenerated `src/generated` —
   CI fails on drift.
2. **Measure, don't assert.** Every number in this README and in the source
   comments came from `npm run verify` or a test, not from an estimate. If a
   change moves one, re-measure it and update the figure rather than softening
   the wording.
3. **Respect the boundary.** No pathfinding, no tiles, no geocoding, no live
   tracking — see [the non-goals](#this-is-a-presentation-layer-map-not-a-navigation-map).
   These are permanent, not a backlog.
4. Explain *why* in the PR description. The repo's commit log is deliberately
   one short subject line per commit; rationale lives in code comments and in
   the working notes, where it stays next to what it explains.

There is no CONTRIBUTING.md or code of conduct yet — this list is the whole
process.

---

## Acknowledgments

naksha would not exist without two openly licensed datasets and the people who
maintain them — [mesaugat/geoJSON-Nepal](https://github.com/mesaugat/geoJSON-Nepal)
for the district geometry and
[sagautam5/local-states-nepal](https://github.com/sagautam5/local-states-nepal)
for the Devanagari names, both MIT — and OCHA Nepal, whose p-code scheme the
district ids join on. See [Data](#data) for exactly what is used from each.

---

## License

MIT © Eraj Khatiwada. Commercial use is unencumbered — see [LICENSE](./LICENSE).
