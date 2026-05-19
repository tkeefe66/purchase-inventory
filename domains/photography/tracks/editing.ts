import type { Topic } from '../skillTree.js';

/**
 * Branch 3 — Editing. Taking a flat RAW file to a finished image, in
 * Adobe Lightroom Classic. (Tom\'s subscription includes Classic; we
 * assume Classic, not Cloud / mobile Lightroom.)
 *
 * Tier 1 — Plumbing:           Lightroom + catalog + import setup
 * Tier 2 — Develop Basics:     the develop module sliders that do 90%
 * Tier 3 — Refinement:         local masking, color grading, B&W conversion
 * Tier 4 — Output:             export for screen vs print (gateway to Branch 4)
 *
 * Tier 1 work is one-time-only (set up the catalog and import preset; you
 * never do it again). Tiers 2-4 repeat on every keeper.
 */
export const EDITING_TOPICS: readonly Topic[] = [
  // ─── Tier 1 — Plumbing (4) ──────────────────────────────────────────────
  {
    id: 'editing.lightroom-classic-setup',
    branch: 'editing',
    tier: 1,
    name: 'Lightroom Classic Setup (Catalog, Preferences)',
    prereqs: [],
    description: 'One-time installation and configuration of Lightroom Classic — catalog location, performance settings, the once-and-done choices that decide future-you\'s life.',
    theorySeed:
      `Lightroom Classic is a **catalog-based** editor: a single \`.lrcat\` database file tracks every photo, every edit, every keyword. The catalog lives on your local SSD (*never* on a network drive or external drive — it will corrupt). Photos themselves live elsewhere (working external drive is fine).

Decide once:

- **Catalog location** (e.g., \`~/Pictures/Lightroom/Catalog.lrcat\`)
- **Backup cadence** — Lightroom prompts; pick weekly

Then tune preferences:

- \`Preferences > Performance\` — enable **GPU acceleration** if your machine supports it
- \`Preferences > File Handling\` — build **Smart Previews** on import (lets you edit when the working drive is unplugged)
- \`Preferences > General\` — turn OFF "Show splash screen on startup" (minor sanity)

The default-everything install will work; the *considered-once* install will save you years of pain.`,
    assignmentSeed:
      `Install Lightroom Classic if not already installed. Configure:

1. Catalog at a sensible local SSD path (NOT external, NOT cloud-synced)
2. Backup cadence = weekly
3. GPU acceleration on
4. Smart Previews on import

Submit a Telegram message with the chosen catalog path, the working-drive path for photos, and a screenshot of the \`Performance\` preferences pane.

**Rubric:**

- Catalog is on local SSD not network/external *(core)*
- Backup cadence set *(core)*
- Preferences configured deliberately not at defaults *(non-core)*`,
  },
  {
    id: 'editing.import-and-folder-structure',
    branch: 'editing',
    tier: 1,
    name: 'Import + Folder Structure',
    prereqs: ['editing.lightroom-classic-setup'],
    description: 'Configuring Lightroom\'s Import dialog to copy, rename, and apply defaults so every shoot lands in a predictable place with a sensible name.',
    theorySeed:
      `The \`Import\` dialog has too many options; most are wrong by default. Settings that matter:

- **COPY** (not "Add" or "Move" — copy from card to working drive, leaving original on card)
- **Destination** = your dated folder pattern (Tom's convention: \`YYYY/YYYY-MM-DD-keyword\`)
- **Rename** = \`YYYY-MM-DD-{seq#:0000}\`
- **Apply Develop Preset** = your default (a light starting-point preset, NOT a heavy look)
- **Apply Metadata Preset** = your copyright + contact info
- **Build Smart Previews**

Save the whole thing as an **Import Preset** named "Default" so you never reconfigure again. Then: insert card, Lightroom auto-detects, click Import. Done in 30 seconds, consistent every time.`,
    assignmentSeed:
      `Configure an **Import Preset** in Lightroom and demonstrate it works. Required settings:

- **COPY** (not Add/Move)
- Destination follows your dated-folder pattern from Branch 1's file-naming convention
- Rename pattern includes date + sequence
- A Develop Preset applied (even a blank one)
- Smart Previews built

Test by importing 5+ frames from a card or test folder. Submit a screenshot of the resulting folder structure + filenames.

**Rubric:**

- COPY chosen not Add *(core)*
- Folder + filename match a dated convention *(core)*
- Import preset saved for one-click reuse *(non-core)*`,
  },
  {
    id: 'editing.backup-and-storage',
    branch: 'editing',
    tier: 1,
    name: 'Backup + Storage (3-2-1 Rule)',
    prereqs: ['editing.import-and-folder-structure'],
    description: 'The 3-2-1 backup rule applied to your photo library — 3 copies, 2 different media, 1 off-site.',
    theorySeed:
      `The single most preventable loss in this hobby is *"my drive died and I lost 5 years of photos."*

The **3-2-1 rule**: keep 3 copies of every photo, on 2 different media types, with 1 copy off-site (or in a different building / cloud). For Tom:

1. **Working drive** — the external SSD where Lightroom reads from
2. **Local backup drive** — a second SSD or spinning disk that mirrors the working drive nightly via Backblaze, Time Machine, or \`rsync\`
3. **Off-site** — Backblaze Personal or similar cloud backup at $7/mo for unlimited (set and forget)

Lightroom's **catalog backup** is separate — that protects the \`.lrcat\` metadata, NOT the actual photos. Both need backup. *Test restore at least once per year* — an untested backup is a hope, not a backup.`,
    assignmentSeed:
      `Workflow assignment, no photo required. Document your current photo-backup state:

1. Where the working files live
2. What local backup exists and how often it runs
3. What off-site backup exists
4. Whether you have ever tested a restore

Then identify the **weakest link** and write a 1-line plan to fix it (e.g., "Buy a 4 TB Backblaze drive, enable backup tonight"). Submit as a Telegram message.

**Rubric:**

- All three locations identified or admitted missing *(core)*
- Weakest link named *(core)*
- Realistic fix plan with a date *(non-core)*`,
  },
  {
    id: 'editing.culling-and-rating',
    branch: 'editing',
    tier: 1,
    name: 'Culling + Rating (Pick Before You Edit)',
    prereqs: ['editing.import-and-folder-structure'],
    description: 'Aggressively choosing the keepers BEFORE opening the Develop module — the discipline that separates 1000-shot drives from 5 portfolio prints.',
    theorySeed:
      `The mistake: import 500 frames, start editing in chronological order, run out of time, end up with 30 mediocre edits and no portfolio frames.

The discipline: *cull first, edit second.*

Lightroom \`Library\` module shortcuts:

- \`P\` = **Pick** (flag)
- \`X\` = **Reject** (flag)
- \`U\` = **Unflag**
- Arrows = next/previous
- \`Caps Lock\` on = auto-advance after flag

**First pass** at full speed: P or X or skip — under 2 seconds per frame, just trust the gut. **Second pass** on only the Picked: rate 1-5 stars (4-5 = portfolio candidates, 3 = solid keepers, 1-2 = "remember this happened"). **Third pass** on 4-5 stars only: this is what you EDIT.

Realistic ratios from a typical 200-frame shoot: ~30 Picks → ~5 four-stars → ~1 portfolio frame.`,
    assignmentSeed:
      `Apply the cull-first discipline to a real import. Import 100+ frames (use any past shoot if you have one).

1. **First pass:** flag every frame as P or X in under 2 sec each (target: get through 100 frames in <5 minutes)
2. **Second pass:** rate the Picks 1-5 stars

Submit a screenshot showing your filtered view of just 4-5 star frames, plus the count of:

- Total frames
- Picks
- 4-5 star

**Rubric:**

- Ratio of keepers to total is realistic (5-15% Picks, 1-2% 4-5 star) *(core)*
- Actually used the keyboard shortcuts not the mouse *(core)*
- No edits performed during culling pass *(non-core)*`,
  },

  // ─── Tier 2 — Develop Module Basics (3) ─────────────────────────────────
  {
    id: 'editing.raw-development-basics',
    branch: 'editing',
    tier: 2,
    name: 'RAW Development Basics (Exposure, Contrast, WB, Tone Curve)',
    prereqs: ['editing.culling-and-rating'],
    description: 'The top sliders in the Develop module that do 90% of the work on a typical RAW — Basic panel, white balance, tone curve.',
    theorySeed:
      `The \`Basic panel\` is the workhorse. Top-down order matters:

1. **White Balance** — eyedropper a neutral-grey area or dial temperature + tint until skin / snow / paper looks right
2. **Exposure** — push or pull the WHOLE image; aim for "looks roughly right" on the overall brightness
3. **Highlights** (slider down to recover blown sky), **Shadows** (slider up to lift crushed darks), **Whites** (slider down for haze, up to brighten), **Blacks** (slider down for contrast, up to lift)
4. **Contrast** — usually +10 to +25, sometimes negative for flat / moody scenes
5. **Texture**, **Clarity**, **Dehaze** — micro-contrast at three scales; use sparingly (*light dehaze = pop, heavy dehaze = HDR-from-2008*)

The \`Tone Curve panel\` is the surgical version of the Basic sliders; learn it for shadow / highlight rolls when Basic isn't enough.

Workflow: get 80% right with Basic in 30 seconds, then decide if you need more.`,
    assignmentSeed:
      `Take one underexposed-ish RAW file from your library (any past shoot). Edit it ONLY in the \`Basic panel\` (no Tone Curve, no local masks).

Sequence:

1. Set **WB** first
2. Then **Exposure**
3. Then **Highlights/Shadows/Whites/Blacks**
4. Then **Contrast**
5. Then a tiny touch of **Clarity** if it helps

Aim for the image looking like what you saw — natural, *not "edited."* Submit the before (original RAW preview) + after (your edit), exported as JPEG.

**Rubric:**

- Edit follows top-down Basic panel order *(core)*
- Final image looks natural not over-edited *(core)*
- Highlights not clipped + shadows not crushed in the final *(non-core)*`,
  },
  {
    id: 'editing.cropping-and-straightening',
    branch: 'editing',
    tier: 2,
    name: 'Cropping + Straightening',
    prereqs: ['editing.raw-development-basics'],
    description: 'The simple, often-skipped step — fixing tilted horizons and recomposing in post when capture composition needed help.',
    theorySeed:
      `The crop tool (\`R\` shortcut) handles two jobs: **straightening** (rotating to fix a tilted horizon) and **recomposition** (changing the framing after capture).

- **Auto-straighten** — click the level icon, then drag a line along anything that SHOULD be horizontal or vertical (horizon, wall edge, telephone pole); Lightroom rotates to make it level
- **Manual straighten** — drag a corner handle
- **Aspect ratios** — lock to "Original" by default, or pick 1:1 (Instagram square), 4:5 (Instagram vertical), 16:9 (cinematic) for export-target-driven crops

**Composition rule:** only crop *inwards* — if you had to crop heavily, the next time use a longer lens or move closer (you lose resolution + you cropped before composing in-camera). DON'T crop just to "fix" composition you weren't thoughtful about; treat heavy crops as feedback for next shoot.`,
    assignmentSeed:
      `Find one old image with a tilted horizon (everyone has them) and one image you compositionally over-cropped at the time.

1. Fix the horizon with the **auto-straighten** tool
2. Recompose the other deliberately — maybe go to 4:5 vertical, maybe just trim distractions from edges

Submit before / after for both. Then write one sentence on the over-cropped one: what should you have done in-camera to avoid the heavy crop next time?

**Rubric:**

- Tilt visibly corrected *(core)*
- Recomposition deliberate not random *(core)*
- Thoughtful self-critique on the over-crop *(non-core)*`,
  },
  {
    id: 'editing.sharpening-and-noise',
    branch: 'editing',
    tier: 2,
    name: 'Sharpening + Noise Reduction (Output-Aware)',
    prereqs: ['editing.raw-development-basics'],
    description: 'Sharpening and noise reduction are OUTPUT-DEPENDENT — what works for screen is wrong for print, and vice versa.',
    theorySeed:
      `**Sharpening** recovers perceived sharpness lost in the RAW pipeline; **noise reduction** smooths sensor noise. Both are in the \`Detail panel\`.

- **Sharpening** — Amount 40-50, Radius 1.0, Detail 25 is a sane starting point for most images; push Amount higher for landscape with fine detail, lower for portraits (skin texture exaggeration is bad)
- **Noise — Luminance** 15-30 for ISO 800-3200, 40-60 for ISO 6400+ (smooths grain but at extreme settings erases detail — find the line)
- **Noise — Color** can usually stay near default 25 (color speckles are easier to clean than luma grain)

*Critical insight:* sharpening for **screen export** (small size, viewed close, browsers add their own sharpen) is LESS than sharpening for **print export** (large size, viewed at distance, ink-paper softens). Lightroom's \`Export\` dialog can add **output sharpening** on top of develop sharpening — use it.

The "right" sharpening is invisible: you should not see halos around high-contrast edges at 100%.`,
    assignmentSeed:
      `Take one high-ISO image (ISO 3200+) from your library. Apply sharpening + noise reduction at three settings:

1. **Defaults** (Amount 40, Luma 0)
2. **Aggressive** (Amount 80, Luma 60)
3. **Tuned** (you decide)

At 100% zoom in Lightroom, compare. Pick the tuned settings that recover sharpness without halos and reduce noise without erasing detail. Submit screenshots of the three at 100% zoom + a note on which is best and why.

**Rubric:**

- 100% comparison done not 50% *(core)*
- Tuned version visibly better than both defaults and aggressive *(core)*
- No halos visible at edges *(non-core)*`,
  },

  // ─── Tier 3 — Refinement (3) ────────────────────────────────────────────
  {
    id: 'editing.local-adjustments',
    branch: 'editing',
    tier: 3,
    name: 'Local Adjustments (Masks, Brushes, Gradients)',
    prereqs: ['editing.raw-development-basics'],
    description: 'Selective edits using Lightroom\'s mask system — brighten the face, darken the sky, sharpen the subject only.',
    theorySeed:
      `**Local adjustments** confine an edit to a region of the photo. Masking has three tools:

- **Brush** — paint freely (for irregular shapes like faces)
- **Linear Gradient** — smooth transition along a line (for skies, foreground darkening)
- **Radial Gradient** — oval / circle vignette (for subject brightening)

Plus AI-powered **Subject** and **Sky** auto-masks (one click, often perfect).

The killer move: start with an auto **Sky** mask, drop Exposure -0.5 and add Texture +20 — *instant landscape pop.* Start with auto **Subject** mask, add Exposure +0.3 and Clarity +10 — *instant portrait pop.*

Stack masks freely; rename them ("Sky", "Face", "Background blur"). Adjustments inside a mask use the SAME sliders as the \`Basic panel\` but apply ONLY to the masked area.

Common beginner trap: *over-masking* — if you have to mask aggressively, often the underlying composition / exposure was the problem, not lack of local edits.`,
    assignmentSeed:
      `Take one image where the subject is too dim relative to a bright background (backlit person, dim foreground / bright sky).

1. Use AI **Subject** masking to brighten the subject (+0.5 to +1 Exposure, +10 Clarity)
2. Use AI **Sky** masking to darken the sky (-0.5 Exposure, +15 Texture)

Submit before / after. Then make ONE manual **brush** mask on a different image to selectively brighten or darken something the AI masks won't catch (e.g., a face in a non-portrait, an object). Submit that before / after too.

**Rubric:**

- Two clear before/afters submitted *(core)*
- AI masks used appropriately *(core)*
- At least one manual brush mask attempted *(non-core)*`,
  },
  {
    id: 'editing.color-grading',
    branch: 'editing',
    tier: 3,
    name: 'Color Grading (HSL, Color Grading Panel, Calibration)',
    prereqs: ['editing.raw-development-basics'],
    description: 'Shaping the colour story — pushing specific colours warmer or cooler, more or less saturated, lighter or darker.',
    theorySeed:
      `Three Lightroom panels do colour work:

- **HSL/Color** — per-hue Hue/Saturation/Luminance (push blues more cyan, drop the yellows, brighten reds)
- **Color Grading** — three-way wheels for Shadows / Midtones / Highlights (push shadows cool blue + highlights warm orange for the *cinematic teal-and-orange look*)
- **Calibration** — the deepest layer; shifts the primaries, affects everything

Workflow: get the image right in \`Basic\` + \`Tone Curve\` first, then use \`Color Grading\` for **mood** (subtle shifts, not heavy filter looks), then \`HSL\` for **specific fixes** (someone's red shirt is too loud → drop Red Saturation -20). \`Calibration\` is for building a personal preset — leave it alone until you've mastered the other two.

*Subtlety wins:* shifts of +5 to +15 in HSL are usually enough; Color Grading wheels at 20-30% saturation are usually enough. Heavy colour grading dates fast.`,
    assignmentSeed:
      `Pick one image with a strong colour story (sunset, autumn leaves, a colourful market, a single-colour outfit). Apply:

1. One **HSL** shift on the dominant colour (push or pull its hue, sat, or luma by 10-30 to enhance the story)
2. One **Color Grading** move (shadows toward one colour, highlights toward another, subtle)

Submit before / after + a one-sentence description of the colour choices and what mood they support.

**Rubric:**

- Colour decisions visibly serve the image *(core)*
- Changes are subtle not heavy *(core)*
- HSL + Color Grading both used at least lightly *(non-core)*`,
  },
  {
    id: 'editing.black-and-white-conversion',
    branch: 'editing',
    tier: 3,
    name: 'Black & White Conversion',
    prereqs: ['editing.raw-development-basics'],
    description: 'Converting a colour RAW to black-and-white using the B&W Mix panel — far better than "Saturation -100" or generic presets.',
    theorySeed:
      `A great B&W is *not* desaturated colour — it's a deliberate translation of colour into tone.

In Lightroom, click **Black & White** treatment (top of \`Basic panel\`). Then go to the \`B&W panel\`: 8 sliders, one per colour, each controlling how BRIGHT that colour renders in monochrome.

- A blue sky was originally bright; drop the **Blue** slider to render it darker = dramatic sky
- Skin originally was orange / red; push those sliders up to brighten faces
- Greens light or dark for different landscape moods

The hot truth: this is what colour filters on B&W film used to do — Lightroom's **B&W Mix** is *digital colour filters.*

After mixing, push **Contrast** harder than you would for colour (B&W rewards contrast). \`Tone Curve\` becomes critical too — a deep black point and clean white point matter more in B&W than colour. Avoid generic "B&W preset" → "Auto" mixes; they're bland.`,
    assignmentSeed:
      `Take ONE colour image where you envision B&W (portrait, landscape with sky, architectural shot, object with strong form). Convert:

1. Click **B&W** treatment
2. Tune each **B&W Mix** slider for the result you want (darken the sky, brighten the face, drop the foliage)
3. Push **Contrast** +15 and use \`Tone Curve\` to set a clean black and white point

Compare to a "lazy" version (just B&W treatment + Auto Mix). Submit the colour original + the lazy conversion + your tuned conversion.

**Rubric:**

- Tuned version visibly different from lazy auto *(core)*
- B&W mix sliders moved deliberately not at default *(core)*
- Final B&W has full tonal range not muddy *(non-core)*`,
  },

  // ─── Tier 4 — Output (2) ────────────────────────────────────────────────
  {
    id: 'editing.export-for-screen',
    branch: 'editing',
    tier: 4,
    name: 'Export for Screen (sRGB, Sizing, Web Sharpening)',
    prereqs: ['editing.sharpening-and-noise'],
    description: 'Exporting for Instagram, web, phone shares — color space, dimensions, format, and sharpening calibrated for screen viewing.',
    theorySeed:
      `Screen export rules:

- **Color space** = sRGB (every browser, every phone; AdobeRGB renders wrong outside colour-managed pro software)
- **Format** = JPEG quality 80 (Instagram re-compresses anyway; quality 100 is wasted bytes)
- **Dimensions** = max long edge 2048 px for Instagram, 1920 for general web, full resolution only if printing or archiving
- **Output Sharpening** in the \`Export\` dialog = "Screen" at Standard amount
- **Metadata** = strip GPS for privacy if posting public (\`Export > Metadata > Remove Location Info\`)
- **File naming** = if multiple per post, suffix like \`_01\`, \`_02\`

Save the whole config as an **Export Preset** named "Instagram" or "Web — full size" so it's one click forever. *Tip:* pre-create folders like \`~/Pictures/Exports/Instagram/\` so exports never clutter Desktop.`,
    assignmentSeed:
      `Export 3 finished images at three different web targets:

1. Instagram square crop at 1080x1080
2. Instagram vertical at 1080x1350
3. General web at 1920 px long edge

All three: sRGB, JPEG quality 80, Output Sharpening = Screen / Standard, GPS stripped. Save each as a named **Export Preset**. Submit the three exported files + screenshots of the saved presets.

**Rubric:**

- All three use sRGB + correct dimensions *(core)*
- Output sharpening set + GPS stripped *(core)*
- Saved presets in Lightroom for one-click reuse *(non-core)*`,
  },
  {
    id: 'editing.export-for-print',
    branch: 'editing',
    tier: 4,
    name: 'Export for Print (Gateway to Branch 4)',
    prereqs: ['editing.sharpening-and-noise'],
    description: 'Exporting to send to a printer (the ET-8550 or a lab) — color space, format, dimensions, print sharpening. The handoff to Branch 4 Printing.',
    theorySeed:
      `Print export rules:

- **Color space** = AdobeRGB or ProPhoto RGB (*not* sRGB — printers have a wider gamut than screens; throwing away that gamut at export wastes the ET-8550's ink)
- **Format** = TIFF 16-bit (lossless, full bit depth — printing from a JPEG is for snapshots, not prints worth framing)
- **Dimensions** = native resolution at the print size you want; for a 13x19 print you need ~300 PPI = 3900x5700 (most a6700 files have plenty)
- **Output Sharpening** = "Matte Paper" or "Glossy Paper" at Standard or High amount (this is DIFFERENT from screen sharpening — print needs more)
- **Resolution** = 300 PPI default

Save as an **Export Preset** called "Print — TIFF 16-bit" for one-click. **Soft-proof** BEFORE exporting (see Branch 4) to catch out-of-gamut colours; without soft-proofing, the print will surprise you in disappointing ways.`,
    assignmentSeed:
      `Pick one image you intend to print on the ET-8550 (an 8x10, 11x14, or 13x19 — pick a size). Export with print rules:

- **AdobeRGB** color space
- **TIFF 16-bit**
- **300 PPI** at print dimensions
- **Output Sharpening** = appropriate paper type at Standard

Save the export preset. Then DON'T print it yet — Branch 4 will tell you the soft-proofing + ICC profile dance that prevents disappointment. Submit the exported TIFF file or screenshot of the export settings.

**Rubric:**

- AdobeRGB color space (not sRGB) *(core)*
- TIFF 16-bit format *(core)*
- Output sharpening set for the right paper type *(non-core)*`,
  },
];
