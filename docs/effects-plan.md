# Image & video effects (Ladybug-style) — plan

Goal: add Ladybug-style "looks" (ASCII, dither, halftone, riso, thermal, VHS, glitch, …)
to lumio **images**. No 3D, no depth, no AI, and **no video for now** (see "Later: video").

---

## 1. What Ladybug actually is (findings)

Inspected on 2026-11-04: the landing page, changelog, studio home (`app.theladybug.app/home`) and the
studio itself (`app.theladybug.app`), including its JS bundles.

**There's no effects library and no AI behind the looks.** Every effect is a hand-written GPU
fragment shader running on Ladybug's own engine:

| Piece | What they use | Evidence |
|---|---|---|
| Render engine | Custom **WebGPU** engine with **WGSL** shaders (`lbstudioEngine-*.js` with `createShaderModule`, `@fragment`, `@compute`) | bundle scan |
| Fallback | CPU render worker (`cpuRenderWorker`, `cpuGraph`) used when the GPU drops | changelog 1.3.2 + bundles |
| Text looks (ASCII, Dither Text, Matrix…) | Glyphs drawn into an **atlas texture** on `OffscreenCanvas` (`cpuGlyphAtlas`, `glyphShared`, `asciiShapeTable`). The shader picks a glyph per cell by brightness | bundles |
| Video export | Browser **WebCodecs** (`VideoEncoder`) → MP4 | bundle scan |
| UI | React | vendor bundle |
| AI-ish parts | Only depth ("Make 3D") and tracking, which are out of scope | landing page |

The effects can be switched on and off because each one is a shader plus a set of uniforms (the
controls), so switching is just swapping the shader and its settings.

### The catalogue: 63 effects in 11 categories
- **Type & code (12):** ASCII, ASCII Ghost, Tag Pills, Data Hatching, Dither Text, Glyph Studio, Grid Glyph, Inscribe, Matrix Rain, Number Field, Pixel Code, Word Mosaic
- **Halftone & dither (16):** Cross Stitch, Dithering, Drift Lines, Glitch Grid, Glyph Matrix, Halftone, Pixel Press, Pattern Halftone, Pixel Dither Glow, Pixel Poster, Retro Matrix, Riso, Riso Glow, Scatter Mosaic, Symbol Matrix, Tone Geometry
- **Textile & craft (5):** Crosshatch, Knitted Embroidery, Kilim Carpet, Stitch Poster, Vector Engraving
- **Pixel & 3D (6):** Block Mosaic, Blockify, 3D Toy Bricks*, Outline, Quadtree Zoom, Voronoi
- **Edges & outlines (5):** Contour, Contour Map, Contour Type, Edge Detection, Threshold
- **Analog & glitch (7):** CRT Screen, Crystal Glass, Glass Pixel Dispersion, Glitch, Pixel Sort, Ribbon Scan, VHS
- **Analog (2):** Film Prism, Wave Lines
- **Light & glass:** Thermal (+ Prism Light)
- **Experimental (6):** Ember Veil, Holo, Trace Motion, Particle Brush, Rain Reveal, Stardust
- **Tracking & interface (3):** Brand Generator, CCTV Surveillance, HUD Tracker*

\* needs 3D or tracking, so we skip it.

Each effect ships with **presets** ("looks"). ASCII alone has 25: Default, Phosphor, Contour, Wire,
Linework, Two Tone, Typewriter, Teletext, Etching, Braille, Riso, Ink on Paper, Terminal, Blueprint Type,
Katakana Rain, Newsprint, Amber Phosphor, Neon Bloom, Silverpoint, Jumbotron, Scanline Terminal,
Line Art, Dense Newsprint, Color Photo… There are about 300 looks in total.

### Controls share one schema (worth copying)
Every effect groups its controls into the same sections:

- **Shape:** cell/dot/block size, spacing, levels, line width
- **Style:** pattern, mode, character set
- **Tone:** `brightness`, `contrast`, `gamma`, `invert` (on every effect)
- **Ink:** `colorMode` (Mono / Original / Multi), `foreground` (Ink), `background` (Paper), `backgroundOpacity`, `transparent`
- **Light:** `emissiveGain`, `edgeGlow`, `glow`, `glowSize` (these feed a global Bloom / Streaks / Trails pass)
- **Placement:** `angle`, mask

Example controls taken from their bundles:
- **ASCII:** columns, customRamp, glyphMatch, fontFamily, glyphWeight, edgeThreshold, edgeGlyphs, densityBias, detail, pixelate, temporalSmooth, scanline, secondInk
- **Dithering:** scale, pixelShape (square / double-wide), cellRead (center / average), levels, pattern, noise, palette, paletteMix
- **Halftone:** pressScreen, spot, inkSet (CMYK…), dotScale, spacing, sizeVariation, angle, Ben-Day keyline/offRegister, spiral
- **Riso:** dotSpacing, ditherMode (halftone / stipple), ink1/ink2 colour, overlap mode, bleed, paper texture, per-ink angle, misregistration drift
- **Thermal:** palette, cycles, phase, steps, soften, hot edges, glow
- **VHS:** softness, colour bleed, colour delay, rainbow, ghosting, tape wear / noise / dropouts, tracking jitter / wow, scanlines, curvature, vignette, OSD date / time / title
- **Glitch:** density, strip height, max shift, drag length, colour boost, grain
- **Pixel Sort:** streak length, intensity, density, threshold, angle, reverse
- **CRT:** curvature, zoom, aberration, vignette, grid size / strength, subpixel RGB, bloom
- **Edge:** lineWidth, threshold, ink / paper, negative
- **Crosshatch:** density, layers (1–5), lineWidth, angle, dropout

---

## 2. How this maps onto lumio

Lumio already renders every page with **fabric v6**, and images are `fabric.FabricImage`. Fabric has a
WebGL filter pipeline with **custom GLSL filters**, which serialise into the design JSON. That gives us
Ladybug's model without writing our own engine:

- **One filter class per effect** (or one generic `LumioEffect` filter keyed by `effect` id). Each
  subclasses `fabric.filters.BaseFilter`, provides `getFragmentSource()` and `sendUniformData()`,
  and is registered with `classRegistry.setClass` so save and load round-trip.
- **Override `getCacheKey()`** so fabric compiles and caches one program per effect.
- **WebGL (GLSL ES), not WebGPU.** It works in every browser lumio supports and fabric already
  does the plumbing. Raise `fabric.config.textureSize` (default 2048) to 4096 for large photos.
- **Glyph effects** (ASCII, Dither Text, Matrix, Word Mosaic, Number Field) use a glyph atlas:
  render the character ramp to a canvas with the chosen font (lumio already loads custom fonts), then
  bind it as a second texture. Fabric's own `BlendImage` filter already binds an extra texture, so
  this is a known pattern.
- **Exports come almost for free.** PNG and PDF already draw the canvas, and filtered images draw
  filtered.
- **Brand kit tie-in (lumio-only bonus):** Ink and Paper colours can default to the active brand
  kit's colours, so a look follows the brand like fonts and colours already do.

### Shared GLSL prelude (written once, used by every effect)
`tone(rgb)` (brightness / contrast / gamma / invert), `luma()`, `ink(colorMode, src, fg, bg)`, `bayer4/8()`,
`blueNoise()` (small noise texture), `hash()`, `rotate(uv, angle)`, `cellUV(size)`.
Most effects then only need 20–60 lines of their own shader.

---

## 3. Phases

### Phase 0: Infrastructure (no visible effect yet)
- `src/client/effects/registry.ts`: an `EffectDef` per effect holding `{ id, name, category, glsl, controls[], presets[] }`.
  A control is `{ key, label, section, type: range|color|select|toggle|text, min, max, step, default }`.
- `src/client/effects/filter.ts`: the generic fabric filter that reads an `EffectDef` and pushes the controls as uniforms.
- `src/client/effects/glsl/common.glsl.ts`: the shared prelude.
- `src/client/effects/glyph-atlas.ts`: builds and caches the atlas per (ramp, font, weight).
- An **Effects** tab in the left sidebar, enabled when an image is selected: a grid of live thumbnails
  (the effect applied to a downscaled copy of the selected image), grouped by category, with a search box.
- An **Effect** section in the right sidebar: controls auto-generated from the schema and grouped by
  Shape / Style / Tone / Ink / Light, a preset strip, "Remove effect", and a hold-to-compare
  before/after toggle.
- Undo/redo and autosave work through the existing `saveHistory`.
- Tests (existing `node --test` setup): schema defaults, preset → params, and filter JSON round-trip.

### Phase 1: Core image looks (about 12; covers most of what people try)
ASCII · Dithering (Bayer 2/4/8, blue noise, 1-bit to N-level, palettes such as Game Boy, CGA, Mac) ·
Halftone (mono + CMYK, round/line/square dots, angle) · Riso (2-ink, misregistration, grain) ·
Threshold · Edge Detection (Sobel) · Contour (iso-lines) · Crosshatch · Block Mosaic / Pixelate ·
Thermal (gradient-map palettes) · Duotone / gradient map · Pixel Dither Glow.
Each effect ships with 3–6 presets.

### Phase 2: Analog, glitch & craft
CRT Screen · VHS · Glitch · Pixel Sort (single-pass streak approximation: smear along an angle where
luma is under the threshold) · Chromatic aberration / Film Prism · Film grain · Voronoi · Dither Text ·
Matrix Rain (static first) · Word Mosaic / Number Field · Pattern Halftone · Cross Stitch · Knitted
Embroidery · Kilim · Vector Engraving.

All image effects are static: one rendered result per settings change, no time uniform and no
animation. Matrix Rain, VHS and Glitch become still "frozen frame" looks with a `seed` control in
place of motion.

### Phase 3: Glow finish
A **Glow** filter appended to an image's filter chain: Bloom (threshold → downsampled blur → add) and
Streaks (directional blur of the highlights). Effects with `emissiveGain` push colours above 1.0 so
the glow picks them up, which is the trick Ladybug uses. Trails are skipped because they need frames
over time.

### Phase 4: Looks library
- Save the current effect and its settings as a named look in D1 (new `looks` table, scoped like brand kits).
- Apply a look to many images at once, and include looks in brand kits.
- Template images can carry a look, so a template comes out pre-styled.

### Out of scope for now
- **Video:** upload, playback, animated effects and MP4 export.
- 3D / Make 3D / depth, tracking (faces, hands, objects), sound reactivity, morph, 3D models.

### Later: video (parked, notes only)
The filter design above already works per frame, so video can be added on top without rework. That
means a `FabricImage` backed by an `HTMLVideoElement` with `objectCaching: false`, plus a `uTime`
uniform for animated looks. MP4 export would use WebCodecs `VideoEncoder` + `mediabunny` for
muxing, stepping frame by frame. The one thing to keep in mind now is not to bake "still only"
assumptions into the filter class: keep uniforms in one place so `uTime` can be added later.

---

## 4. Risks and decisions

| Risk | Mitigation |
|---|---|
| Fabric filter texture limit (2048) blurs big photos | Raise `fabric.config.textureSize`. Apply filters to a resized source for preview and full size on export |
| Live thumbnails for 60 effects are expensive | Render thumbnails from one 160px copy, lazily as they scroll into view, and cache per image |
| True Floyd–Steinberg or full pixel sort can't run in one fragment pass | Ship ordered / blue-noise dither and a streak-based sort. Error diffusion can come later as a CPU worker option |
| Filtered image changes size or crops on export | Filters keep the source dimensions. PNG export at 2x re-renders the filter at export size |
| Old designs | Filters are additive, so designs saved without them load unchanged |

---

## 5. Suggested order of PRs
1. Effect infrastructure, plus ASCII and Dithering end to end (proves glyph atlas, schema UI and serialisation)
2. Rest of Phase 1
3. Phase 2
4. Glow
5. Looks library
