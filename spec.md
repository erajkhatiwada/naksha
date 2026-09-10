# Naksha — a stylized Nepal route/network map for product UIs

> Working spec. Written 2026-08-24. Everything marked **[verified]** was measured
> against real data/libraries during the design session, not estimated.

---

## 1. What this is

An open-source (MIT) JS/TS library that renders **Nepal as a dot-grid map with routes
and flows drawn on top**, for use inside product UIs.

Target consumers:

| Consumer                 | Fit             | Use case                                                                              |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| **Domestic airlines**    | Near-perfect    | Route maps. ~30 airports, pure node-to-node, arcs are canonical. **Flagship.**        |
| **Travel agencies**      | Near-perfect    | Itineraries, trek routes. Stylization is a feature, not a compromise.                 |
| **Bus operators**        | Strong          | Intercity network overview. Not live vehicle tracking.                                |
| **Delivery / logistics** | Strong, bounded | Coverage maps, national parcel tracking, ops dashboards. **Not dispatch or routing.** |

The unifying need: _show a network or route at national scale, on a branded surface,
inside an application._

### Positioning (put this in the README)

**This is a presentation-layer map, not a navigation map.**

Leaflet / Mapbox / OSM own turn-by-turn routing and street detail. Nobody owns
"beautiful stylized Nepal for product UI." Declaring the boundary up front is what
prevents an issue tracker full of "please add street routing."

### Hard non-goals

- **No pathfinding.** The library takes an _ordered list of stops_ and renders it.
  Whether the bus actually drives that way is the consumer's data problem. Accepting
  "find the route from A to B" means building a routing engine and competing with OSRM.
- No street-level detail, no basemap tiles, no live vehicle tracking.
- No geocoding.

---

## 2. Status

Design + feasibility research complete. **No code written yet.** Every architectural
claim below has been validated against real data. Next step is deciding the two open
questions in §9, then building z1.

---

## 3. Base library: `dotted-map`

- npm `dotted-map@3.1.0`, MIT, published 2026-02-25 — actively maintained
- Deps: `@turf/boolean-point-in-polygon@^7.3.4`, `proj4@^2.20.2`
- Repo: https://github.com/NTag/dotted-map

### The important discovery: use the back door

`dotted-map/without-countries` takes a **plain data object**:

```js
{
  (points,
    X_MIN,
    Y_MAX,
    X_RANGE,
    Y_RANGE,
    grid,
    width,
    height,
    ystep,
    projection,
    region);
}
```

Nothing in that shape is country-specific. **You can generate `points` from any
geometry you want** and still reuse their proj4 pin-snapping and renderer — while
skipping their 352 KB bundle (most of which is embedded `world.geo.json`).

`getPoints()` returns `{ x, y, lat, lng }`, so pins carry both SVG coordinates _and_
snapped geographic coordinates. That is exactly what arc rendering needs.

### Why we do not use their geometry **[verified]**

Their Nepal (`world.geo.json/countries/NPL.geo.json`) is **23 vertices** for the entire
country. No Terai detail, none of the northern zigzag. Any Nepali reader clocks it
instantly. Our replacement source has **55,176 vertices**.

### What `dotted-map` does NOT provide

`getSVG()` is naive string concatenation. There is **no text/labels, no highlight
states, no arcs, no animation, no interactivity, no React component**. Everything this
project needs is greenfield.

Conclusion: likely **do not depend on it at runtime at all.** Precompute at build time,
ship a raster (§5), render ourselves. Zero runtime deps, full animation control.

---

## 4. Licensing — clear for commercial use **[verified]**

| Source                   | License                      | Notes                                               |
| ------------------------ | ---------------------------- | --------------------------------------------------- |
| `dotted-map`             | MIT                          | Safe                                                |
| `mesaugat/geoJSON-Nepal` | MIT                          | Copyright 2013–present Saugat Acharya               |
| `johan/world.geo.json`   | **NOASSERTION** (unlicensed) | ⚠️ Never enters our chain — we replace its geometry |

Ship **MIT**. Commercial consumers are safe. Do not vendor anything from
`world.geo.json`.

---

## 5. Architecture: ship Nepal as an indexed PNG

The core idea. Rasterize district polygons **once at build time** into an indexed PNG
where **pixel value = district ID**, 0 = outside Nepal.

At runtime, sampling that raster is one array lookup per dot. It returns
inside/outside **and** district membership simultaneously, at any zoom, with no proj4,
no turf, no point-in-polygon, no GeoJSON.

### Measured sizes **[verified]**

| Raster          | Cells     | Inside | PNG size                              |
| --------------- | --------- | ------ | ------------------------------------- |
| 452 × 256       | 115,712   | 42.5%  | 4.9 KB                                |
| 905 × 512       | 463,360   | 42.1%  | 10.2 KB                               |
| **1810 × 1024** | 1,853,440 | 41.9%  | **22.4 KB** ← recommended, 0.44 km/px |
| 3619 × 2048     | 7,411,712 | 41.8%  | 49.8 KB                               |

**22 KB is the entire geometry layer.** 0.44 km/px is finer than ward level.

Compare with the naive path: 2.1 MB GeoJSON + turf + proj4, re-running 55k-vertex
hit-tests on every zoom change.

### Verified sampling performance **[verified]**

```
ZOOM 1 (all Nepal)    1187 dots, 75/75 districts identified    2.2 ms
ZOOM 3 (Ktm Valley)   2280 dots, 0.69 km/dot                   1.9 ms
    districts in view: BHAKTAPUR, DHADING, KATHMANDU, KAVRE,
                       LALITPUR, MAKWANPUR, NUWAKOT, SINDHUPALCHOK
```

Constant time regardless of zoom level.

### Design consequence: the silhouette problem

At z3+ the viewport is entirely inside Nepal, fill hits 100%, and you get a solid
rectangle of dots — the recognizable outline disappears.

**Fix, which falls out of the same PNG:** at high zoom stop using the _national border_
as the shape and switch to **district / municipality boundaries as the shape** — color
by ID, gap the dots at boundaries. Districts become the silhouette. This is precisely
why encoding district ID per pixel (rather than a plain 1-bit mask) earns its keep.

---

## 6. Zoom: constant dot budget, not constant grid

Never re-resolve a _global_ grid. Re-rasterize **the current viewport** at a fixed dot
budget. Detail then scales for free.

| Level              | Viewport | km/dot | What resolves        | Flow aggregation                        |
| ------------------ | -------- | ------ | -------------------- | --------------------------------------- |
| **z0** World       | —        | —      | Nepal as a region    | International corridors (Gulf/Malaysia) |
| **z1** Nepal       | 792 km   | 11     | 77 districts         | province ↔ province                     |
| **z2** Province    | ~230 km  | 3.2    | all 753 local levels | district ↔ district                     |
| **z3** Valley/City | ~30 km   | 0.69   | wards                | municipality ↔ municipality             |

Same ~1200–2300 dots at every level → constant aesthetic, constant perf, constant DOM
size. The dot grid behaves as a resolution-independent pixel layer.

### Why global high-resolution is off the table **[verified]**

To resolve all 753 local levels on one global grid you need H=140 → 247 cols →
**~14,700 dots**. That is a solid fill, not a dotted map. Per-viewport rasterization is
not an optimization; it is the only workable approach.

---

## 7. The resolution floor is H=40 — non-negotiable

District HQ collisions on the z1 grid **[verified, 75 HQs]**:

| Grid height | Cell size | Districts lost | What merges                                              |
| ----------- | --------- | -------------- | -------------------------------------------------------- |
| 12          | 37 km     | 13             | Syangja+Kusma+Baglung+Beni                               |
| 16          | 28 km     | 9              | **Kathmandu+Bhaktapur+Lalitpur → one dot**               |
| 20          | 22 km     | 5              | Kusma+Baglung+Beni                                       |
| 25          | 18 km     | 2              | Bhaktapur+Dhulikhel                                      |
| 30          | 15 km     | 2              | Kathmandu+Lalitpur                                       |
| **40**      | **11 km** | **0**          | —                                                        |
| 60          | 7.4 km    | 1              | Kathmandu+Lalitpur (grid phase artifact — not monotonic) |

**Default `height: 40`.** Confirmed against the real library: 71 × 40 viewBox,
**1204 dots**.

Municipality-level collisions **[verified]**:

| Grid height | Urban munis lost (263) | All local levels lost (747) |
| ----------- | ---------------------- | --------------------------- |
| 40          | 24                     | 146                         |
| 60          | 12                     | 39                          |
| 80          | 2                      | 9                           |
| 100         | 2                      | 2                           |
| **140**     | **0**                  | **0**                       |

---

## 8. Clustering is the core primitive (not a nice-to-have)

Simulated real commercial point densities against the z1 grid **[verified]**:

```
250 delivery pickup points, Kathmandu Valley
  → 15 distinct dots, 94% collapsed, busiest dot holds 30

800 points nationwide (city-weighted)
  → 352 dots, 56% collapsed, busiest holds 35

120 bus stops, Ktm–Pokhara–Chitwan corridor
  → 43 dots, 64% collapsed, busiest holds 7
```

At 11 km/dot a delivery app's **entire Kathmandu operation is 15 dots**. That is not an
edge case, it is their primary view. An `addPin()` that silently stacks pins is a bug
for these consumers.

### Zoom IS the declustering mechanism

Same 250 points across the zoom ladder **[verified]**:

| Level         | km/dot | Dots used | Collapsed |
| ------------- | ------ | --------- | --------- |
| z1 Nepal      | 11.13  | 15        | 94%       |
| z2 Bagmati    | 3.87   | 80        | 68%       |
| z3 Ktm Valley | 0.69   | 218       | **4%**    |
| z4 Ktm city   | 0.28   | 22        | 4%        |

Cluster badge at z1 → click → zoom → points separate at z3. **Zoom and clustering are
the same feature**, so it gets built once.

**Consequence: z3 is not optional for v1.** For delivery and bus consumers it is the
whole point. (Earlier assumption that z3 could be deferred to v2 is superseded by this
data.)

---

## 9. OPEN DECISIONS — resolve these first

### 9.1 Is the core primitive a `route` or a `flow`?

- **`route`** = ordered stops, rendered as a connected line. Wanted by flights, buses,
  travel itineraries.
- **`flow`** = weighted A→B pair, rendered as an arc. Wanted by migration data and
  delivery-volume visualization.

They render differently. **Pick one as the core with the other as a variant** rather
than half-doing both. Current lean: `route` is core, since the four named consumers
are all route-shaped, and `flow` is a weighted two-stop route.

### 9.2 Does v1 ship z0 (world)?

Only needed for off-map endpoints (outbound labour migration to Gulf/Malaysia).
The four target consumers are all domestic. **Lean: defer z0 to v2.**

### 9.3 Static generator or interactive component first?

A static SVG generator (data in → beautiful SVG out) is maybe 20% of the work and
covers reports, papers, marketing pages. Zoom/hover/cluster is the other 80% — but §8
shows it is mandatory for delivery/bus. **Lean: interactive, because clustering forces
it.**

---

## 10. Geometry / arc rendering notes

### Nepal's shape **[verified]**

```
bbox      lng 80.088 .. 88.175   lat 26.398 .. 30.423
size      ~792 km wide × ~445 km tall,  aspect 1.78:1
fill      42.6% of bounding box
```

Nepal is a ribbon running **NW → SE**, so the **top-right (NE) and bottom-left (SW)
corners are permanently empty**. Do not fight it — put the legend in the NE void and
the title/controls in the SW. The composition is effectively pre-solved.

### Arc height must be non-linear **[verified]**

Pairwise district-HQ distances:

```
min 3.2 km   p10 75 km   median 245 km   max 817 km    → 253× spread

Kathmandu → Bhaktapur       11.3 km
Kathmandu → Pokhara        143.0 km
Kathmandu → Biratnagar     236.5 km
Kathmandu → Dhangadhi      475.0 km
Kathmandu → Mahendranagar  522.1 km
```

Linear arc height makes Kathmandu→Bhaktapur an invisible flat line and
Kathmandu→Mahendranagar a giant rainbow. Use:

```
h = clamp(k * sqrt(d), floor, ceil)
```

with `floor` ≈ 1.5 dot-spacings so short hops still visibly bow.

### Units are free

The viewBox is 71 × 40 units, so **1 unit = 1 dot spacing**. All stroke widths, arc
heights, and pop radii are naturally expressed in dot-units. Clean, resolution-independent
sizing system.

### Animation mechanics

- Arc path: quadratic bezier `M x1 y1 Q cx cy x2 y2`, control point = midpoint offset
  perpendicular by `h`
- Reveal: `stroke-dasharray` / `stroke-dashoffset` animation
- Traveling pulse: small circle on `<animateMotion>` along the same path
- **Arrowhead: use a separate `<polygon>` on `<animateMotion rotate="auto">`, NOT
  `marker-end`** — markers do not cooperate with dash reveals
- Dot "pop": scale the target circle + 1–2 expanding rings with fading opacity
- Respect `prefers-reduced-motion`

### Perf

1204 static circles is fine. If the whole field ever animates, collapse base dots into
a **single `<path>`** so you animate ~1 node plus pins instead of 1204.

---

## 11. Data sources

Repo: https://github.com/mesaugat/geoJSON-Nepal (MIT)

| File                                  | Size    | Verdict                                                                                                    |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `nepal-districts-new.geojson`         | 13.9 MB | ✅ **77 districts, OCHA P-codes** (`DIST_PCODE: NP0769`, `ADM1_PCODE: NP07`). Authoritative. **Use this.** |
| `nepal-districts.geojson`             | 2.1 MB  | 75 districts (outdated), 55,176 vertices, prop `DISTRICT`                                                  |
| `nepal-districts.topojson`            | 243 KB  | Compact 75-district variant                                                                                |
| `nepal-municipalities.geojson`        | 3.8 MB  | ⚠️ 766 features, messy — see below                                                                         |
| `nepal-district-headquarters.geojson` | 10.8 KB | ⚠️ Only 75, only `HQ_NAME` prop, no district name, no Devanagari                                           |
| `nepal-wards.geojson`                 | 80 MB   | For z3+ only                                                                                               |
| `nepal-states.geojson`                | 5.4 MB  | 7 provinces                                                                                                |

Use Mapshaper (https://mapshaper.org/) to simplify before rasterizing if needed.

### Known data-quality problems **[verified]** — this is the real contribution

The **district** layer is fine (77, P-coded, province-linked). The problems are:

**`nepal-municipalities.geojson`** — `LEVEL` field distribution:

```
Gaunpalika          482      national-park        9     ← not a municipality
Nagarpalika         246      wildlife-reserve     3     ← not a municipality
Upamahanagarpalika   13      wildlife-reserve\n   3     ← trailing newline
Mahanagarpalika       3      hunting-reserve      2     ← not a municipality
gaupaika              2      hungint-reserve      1     ← typo
maha Nagarpalika      1      None                 1
```

- National parks / wildlife reserves / hunting reserves (18 features) are **mixed into
  the municipality layer**
- Typos: `gaupaika`, `maha Nagarpalika`, `hungint-reserve`
- ~2017 vintage: 3+1 metros where Nepal has **6**; 246 municipalities where Nepal has
  **276**. Current truth: 6 metro + 11 sub-metro + 276 municipalities + 460 rural = **753**

**Whoever cleans this up owns the canonical Nepal geodata package.** Bundling correct,
current, bilingual (English + Devanagari) 77-district + 753-local-level + 7-province
data is arguably more valuable than the map itself.

---

## 12. Free upstream PR: `avoidOuterPins` is broken in dotted-map v3.1.0

In `getPin()`:

```js
if (this.avoidOuterPins) return; // unconditional — always bails
```

So when `avoidOuterPins: true`, `addPin()` always returns `undefined` and **never adds
any pin**. It clearly intends to test whether the pin landed outside the region.

Reproduced live **[verified]**:

```
avoidOuterPins DEFAULT(false) -> addPin returns {"x":46,"y":27,...}   points: 1205
avoidOuterPins TRUE           -> addPin returns undefined              points: 1204
```

Affects both builds — `DottedMap` extends `DottedMapWithoutCountries` and inherits
`getPin` verbatim. Small fix, real bug, in the library we're building on. Good first
contribution.

---

## 13. What "companies can use it" actually demands

Mostly not map code:

- **TypeScript types** — no exceptions
- **SSR-safe** — Next.js dominates. The PNG-sampling approach needs a server path that
  never touches `Image`/canvas: decode the PNG to a typed array at build time and ship
  that, or lazy-init client-side.
- **Zero runtime deps** — achievable, since the 22 KB raster replaces proj4 + turf
- **Theming** — every consumer has brand colors. Dot color, route color, cluster style
  must all be props.
- **Events** — `onNodeClick`, `onRouteHover`, controlled selection
- **Bilingual labels** — English + Devanagari, plus a11y labels for both
- **Semver discipline** — production consumers must trust minor bumps
- **Framework-agnostic core + thin React wrapper** (React first; vanilla core keeps
  Vue/Svelte cheap)

---

## 14. Naming

All free on npm as of 2026-08-24 **[verified]**:

`naksha` · `naksa` · `nakshya` · `nepal-dotted-map` · `dotted-nepal` · `nepal-dot-map`

**Chosen: `naksha`** (rechecked free on npm 2026-08-24).

Spelling note: the standard Nepali orthography is **नक्सा** (`naksa`); **नक्शा** (`naksha`)
is the Hindi/Urdu form. `naksha` was chosen anyway as the more widely recognized
romanization — worth knowing so the Devanagari in branding/docs stays deliberate rather
than accidental. Either Devanagari spelling is defensible; just pick one and be
consistent.

---

## 15. Regenerating the build artifacts

Requires Python 3 with `pillow` and `numpy`.

```bash
mkdir -p naksha-build && cd naksha-build
BASE=https://raw.githubusercontent.com/mesaugat/geoJSON-Nepal/master
curl -s -o districts77.json  $BASE/nepal-districts-new.geojson
curl -s -o districts75.json  $BASE/nepal-districts.geojson
curl -s -o hq.json           $BASE/nepal-district-headquarters.geojson
curl -s -o municipalities.json $BASE/nepal-municipalities.geojson
```

### Build the indexed district raster

```python
import json, math, os
from PIL import Image, ImageDraw

SRC   = 'districts75.json'   # switch to districts77.json; key is DIST_EN there
KEY   = 'DISTRICT'           # districts77.json uses 'DIST_EN'
H     = 1024

LO, HI, LA, HA = 80.088425, 88.174804, 26.397898, 30.422717   # Nepal bbox
feats = json.load(open(SRC))['features']
AR = ((HI-LO) * math.cos(math.radians((LA+HA)/2))) / (HA-LA)
W  = round(H * AR)

names = sorted({f['properties'][KEY] for f in feats})
idx   = {n: i+1 for i, n in enumerate(names)}     # 0 = outside Nepal

img = Image.new('P', (W, H), 0)
dr  = ImageDraw.Draw(img)
for f in feats:
    g, v = f['geometry'], idx[f['properties'][KEY]]
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for p in polys:
        ring = [((x-LO)/(HI-LO)*W, (HA-y)/(HA-LA)*H) for x, y, *_ in p[0]]
        if len(ring) > 2:
            dr.polygon(ring, fill=v)

pal = []
for i in range(256):
    pal += [(i*37) % 256, (i*91) % 256, (i*151) % 256]
img.putpalette(pal)
img.save(f'nepal_{W}x{H}.png', optimize=True, bits=8)

json.dump({v: k for k, v in idx.items()}, open('district_lut.json', 'w'))
print(f'{W}x{H}  {os.path.getsize(f"nepal_{W}x{H}.png")/1024:.1f} KB  {len(idx)} districts')
```

Verified output **[verified]**:

```
districts75.json (KEY='DISTRICT')  ->  1810x1024   22.4 KB   75 districts
districts77.json (KEY='DIST_EN')   ->  1810x1024   23.2 KB   77 districts
```

The 77 file correctly contains `Nawalparasi East`, `Nawalparasi West`, `Rukum East`,
`Rukum West` — the post-2015/2017 splits. **Prefer it.** Only +0.8 KB.

### Sample the raster into a dot grid (the runtime core, in Python for validation)

```python
import json, math
from PIL import Image
import numpy as np

A = np.array(Image.open('nepal_1810x1024.png'))
IH, IW = A.shape
LO, HI, LA, HA = 80.088425, 88.174804, 26.397898, 30.422717

def grid(bbox, H=40):
    """bbox=(lo,hi,la,ha). Returns (W, [(col,row,districtId), ...])"""
    lo, hi, la, ha = bbox
    AR = ((hi-lo) * math.cos(math.radians((la+ha)/2))) / (ha-la)
    W = round(H * AR)
    out = []
    for r in range(H):
        y = ha - (r+0.5)*(ha-la)/H
        for c in range(W):
            x = lo + (c+0.5)*(hi-lo)/W
            px = int((x-LO)/(HI-LO)*IW)
            py = int((HA-y)/(HA-LA)*IH)
            if 0 <= px < IW and 0 <= py < IH and A[py, px]:
                out.append((c, r, int(A[py, px])))
    return W, out

W, pts = grid((LO, HI, LA, HA), 40)      # z1 → 71, 1187 dots, 75/75 districts
W, pts = grid((85.15, 85.55, 27.58, 27.83), 40)  # z3 Ktm Valley → 57, 2280 dots
```

Both outputs **[verified]** — this exact script reproduces the §5/§6 numbers.

### Reproduce the `avoidOuterPins` bug

```bash
npm init -y && npm i dotted-map@3.1.0
```

```js
import DottedMap from "dotted-map";
const KTM = { lat: 27.7172, lng: 85.324 };
const a = new DottedMap({ height: 40, countries: ["NPL"] });
const b = new DottedMap({
  height: 40,
  countries: ["NPL"],
  avoidOuterPins: true,
});
console.log(a.addPin(KTM)); // {x:46, y:27, ...}
console.log(b.addPin(KTM)); // undefined  ← bug
```

---

## 16. Suggested build order

1. **Decide §9.1 (route vs flow) and §9.3.** Everything downstream depends on it.
2. Build the district raster + LUT (§15). Verify 22 KB / 75 districts.
3. Port the `grid()` sampler to TS. Verify z1 = 1187 dots, 75/75 districts, <5 ms.
4. Static SVG renderer: dots + theming. Verify against the H=40 collision table.
5. Pin snapping + **clustering with count badges** (§8 — mandatory, not optional).
6. Route/arc rendering with `sqrt` arc-height scaling (§10).
7. Zoom (z1→z2→z3) with per-viewport re-rasterization + declustering.
8. District-boundary silhouette mode for z3+ (§5).
9. React wrapper, SSR path, TS types, a11y, Devanagari labels.
10. Clean + bundle the 77-district / 753-local-level / 7-province dataset (§11).
11. Upstream the `avoidOuterPins` fix (§12).

---

## 17. Session context

Design conversation reached these conclusions in order:

1. Started from "contribute to Nepali OSS" — found date/calendar libraries badly
   oversaturated (25+ npm packages), while **words/NLP and maps/geo are genuinely
   underserved**.
2. Chose a dotted map of Nepal built on `NTag/dotted-map`.
3. Found their Nepal geometry is a 23-vertex cartoon → must ship our own.
4. Found the resolution floor (H=40) via district-HQ collision analysis.
5. Reframed from "migration flow visualization" to **"route/network component for
   Nepali businesses"** — which made clustering and z3 mandatory.

Scratchpad artifacts from that session are **not** portable; §15 regenerates all of them.
