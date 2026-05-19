import type { Topic } from '../skillTree.js';

/**
 * Branch 4 — Printing. Putting prints on the wall, on the Epson ET-8550 Tom
 * specifically bought for this. The goal isn\'t "make a print" — it\'s
 * "build a wall of prints you\'re proud of."
 *
 * Tier 1 — Foundation:  why screens lie, paper choices, ICC profiles
 * Tier 2 — Workflow:    Epson Print Layout app, soft-proofing, print sharpening
 * Tier 3 — Craft:       evaluating prints, B&W printing, printer maintenance
 * Tier 4 — Display:     monitor calibration, matting, building a cohesive wall
 *
 * Tier 4 is optional / advanced — Tom can have great prints on the wall
 * without ever calibrating his monitor. But it\'s where serious printers
 * graduate to.
 */
export const PRINTING_TOPICS: readonly Topic[] = [
  // ─── Tier 1 — Foundation (3) ────────────────────────────────────────────
  {
    id: 'printing.color-management-basics',
    branch: 'printing',
    tier: 1,
    name: 'Color Management Basics (Why Screens Lie)',
    prereqs: [],
    description: 'Why the print never matches the screen exactly, and the three pieces of color management that get it close: working color space, monitor profile, output (printer + paper) profile.',
    theorySeed:
      'Screens emit light through three coloured pixels (RGB additive); printers reflect light off ink-and-paper (CMYK + extras, subtractive). They\'re fundamentally different physical processes, so a 1:1 match is impossible — the goal is "close enough that the print looks like the intent." Three things have to align: (1) WORKING SPACE — what color space you edited in (AdobeRGB is the right choice for print; sRGB throws away gamut your printer can reproduce). (2) MONITOR PROFILE — how your screen is calibrated to show colour accurately. Without calibration, your screen lies. (3) OUTPUT PROFILE (ICC) — a recipe matching THIS printer + ink + paper combination, telling Lightroom how to map screen colours to printable ink colours. Skipping any of the three = prints surprise you (too dark, wrong WB, blown highlights). For Tom on the ET-8550: AdobeRGB working space, monitor-as-shipped (good enough to start), Epson-provided ICC profiles for the specific paper.',
    assignmentSeed:
      'Workflow assignment: document your current color management state. (1) What working color space is Lightroom set to (Preferences > External Editing > AdobeRGB recommended)? (2) Is your monitor calibrated, and if so when? (3) Have you downloaded the Epson ICC profiles for the paper(s) you intend to use? Submit a Telegram message answering all three, plus a 1-line plan for whichever is missing. Rubric: all three states honestly answered (core), at least one identified-gap with fix plan (core), AdobeRGB confirmed as working space (non-core).',
  },
  {
    id: 'printing.paper-types',
    branch: 'printing',
    tier: 1,
    name: 'Paper Types (Glossy, Luster, Matte, Fine Art)',
    prereqs: ['printing.color-management-basics'],
    description: 'What paper to pick for what photo — surface finish, weight, brightness, and the trade-offs between vibrance, archival life, and feel.',
    theorySeed:
      'Paper choice is half the print. Major categories: GLOSSY (reflective, highest dynamic range and saturation; landscapes, vivid colour work; shows fingerprints and glare). LUSTER / SEMI-GLOSS (slightly textured, lower glare, still vibrant; the all-purpose choice, what most pro labs default to for portraits and weddings). MATTE (no reflection, softer feel, lower max black but excellent for B&W and watercolour-style images; less colour gamut than glossy). FINE ART / COTTON RAG (Hahnemühle, Canson, Moab; heavy, textured, archival 100+ years; for prints you\'re framing and selling; expensive — $3-5 per 13x19 sheet). WEIGHT: 200-300 gsm for good photo paper, 300+ for fine art. Tom\'s ET-8550 handles all of these, including up to 13x19 fine art papers via the rear feed. Start with: a luster pack for portraits + general; a glossy pack for landscapes; one fine art paper to try for portfolio work.',
    assignmentSeed:
      'Shopping + planning assignment. Inventory your current paper stock (or admit: none yet). Research and decide on a starter paper kit for the ET-8550: ONE luster (e.g., Canon Pro Luster, Red River Polar Pearl), ONE glossy, ONE fine art (e.g., Hahnemühle Photo Rag or Canson Baryta) — all 13x19 if possible. Submit a Telegram message with: chosen papers + brands + sizes + approximate total cost. Rubric: one of each finish chosen (core), papers are ones your ET-8550 actually supports (core), realistic budget noted (non-core).',
  },
  {
    id: 'printing.icc-profiles',
    branch: 'printing',
    tier: 1,
    name: 'ICC Profiles (Paper + Printer + Ink = Unique Profile)',
    prereqs: ['printing.paper-types'],
    description: 'What an ICC profile actually is, where to download them for the ET-8550 + your specific paper, and how to install them so Lightroom can use them.',
    theorySeed:
      'An ICC profile is a small file (.icc / .icm) that describes how a SPECIFIC printer + ink + paper combination reproduces colour. Lightroom uses it to translate the editing-space colours into the right ink mix. Each paper needs its own profile (Canson Baryta on the ET-8550 has different colour behaviour than Hahnemühle Photo Rag on the same printer). Sources: (1) Epson provides profiles for THEIR papers — download from epson.com under your printer model. (2) Paper manufacturers (Canson, Hahnemühle, Red River) provide profiles for their papers on their websites — search "[paper name] ICC ET-8550". (3) Custom profiles can be made with a $400 spectrophotometer or a third-party service for ~$30/paper — overkill for v1. Install: macOS = drop .icc into `~/Library/ColorSync/Profiles/`, Windows = right-click > Install Profile. Restart Lightroom. The profile appears in Print Module > Color Management > Profile dropdown.',
    assignmentSeed:
      'Configuration assignment. (1) For each paper you committed to in the previous topic, find and download the matching ICC profile for the ET-8550. (2) Install all profiles into the OS color profile folder. (3) Restart Lightroom, open Print module, verify each profile appears in the Color Management > Profile dropdown. Submit a screenshot of the Profile dropdown showing your installed profiles. Rubric: at least one profile per paper installed (core), profiles visible in Lightroom Print module dropdown (core), profile filename matches paper+printer combination (non-core).',
  },

  // ─── Tier 2 — Workflow (3) ──────────────────────────────────────────────
  {
    id: 'printing.epson-print-layout-app',
    branch: 'printing',
    tier: 2,
    name: 'Epson Print Layout App (Use This, NOT the Driver)',
    prereqs: ['printing.icc-profiles'],
    description: 'Why the standalone Epson Print Layout app beats printing from the generic system driver — and how to use it with the ET-8550.',
    theorySeed:
      'The Epson Print Layout app (free, separate download from Epson) is the printing tool you should use for fine prints. It bypasses the generic OS print driver, gives you live preview of the actual paper + ICC profile being used, supports rear-feed for fine art papers, and handles 16-bit data end to end. Generic OS print = compressed to 8-bit before printing, fewer paper options exposed, no live colour-managed preview. Workflow: in Lightroom, finish the edit, Export TIFF 16-bit AdobeRGB at print dimensions. Open the TIFF in Epson Print Layout. Pick paper type from the dropdown (this loads the right ICC profile automatically). Pick print quality (highest for portfolio work). Pick paper source (front tray for standard, rear feed for fine art). Preview shows what the print will ACTUALLY look like with that paper. Print. The first ~3 prints per paper type are calibration — adjust expectations + colour after.',
    assignmentSeed:
      'Install Epson Print Layout if not already installed (Epson website, free download). Open it, load any RAW-edited TIFF, and walk through the full print dialog without actually printing: pick paper, see the ICC profile auto-load, see the live preview with paper simulation. Submit a screenshot of the loaded image in Print Layout with paper + profile selected. Rubric: app installed and launched (core), a paper / profile pair selected (core), preview visible with paper simulation on (non-core).',
  },
  {
    id: 'printing.soft-proofing-in-lightroom',
    branch: 'printing',
    tier: 2,
    name: 'Soft-Proofing in Lightroom (Preview Before Wasting Paper)',
    prereqs: ['printing.icc-profiles'],
    description: 'Turning on Soft Proofing in Lightroom\'s Develop module so the screen shows what THIS paper + THIS printer will reproduce — catching out-of-gamut colours before you print.',
    theorySeed:
      'Soft Proofing simulates the print on screen using the paper\'s ICC profile. Activate: Develop module, bottom-left, click "Soft Proofing" (or `S` key). Pick the ICC profile for the paper you intend to use. The screen now shows what the print will ACTUALLY look like — usually duller, especially in saturated reds / blues / shadow detail. Gamut warning: View > Show Destination Gamut Warning highlights colours that the printer CANNOT reproduce (red overlay = out of gamut). Tactic: when you see out-of-gamut warnings on key elements (a vivid sky, a saturated jacket), reduce saturation on JUST that area with a local mask + HSL until the warning clears. Or accept the loss — some colours just don\'t print. ALWAYS soft-proof before exporting for print. The 5 minutes spent soft-proofing saves you a $3 sheet of fine art paper.',
    assignmentSeed:
      'Take one image with strong saturation (sunset, vivid clothing, autumn leaves). In Develop module, enable Soft Proofing with the ICC profile for one of your papers. Observe the visual change. Enable the Destination Gamut Warning — note any red-overlay areas (out-of-gamut colours). For ONE out-of-gamut area, use a local mask + drop Saturation -10 to -20 until the warning clears. Submit a screenshot of the soft-proofed image with the gamut warning visible, and a second screenshot after your saturation adjustment. Rubric: soft proofing enabled with a real ICC profile (core), gamut warning observed (core), at least one corrective adjustment made (non-core).',
  },
  {
    id: 'printing.print-sharpening',
    branch: 'printing',
    tier: 2,
    name: 'Print Sharpening (Different from Screen Sharpening)',
    prereqs: ['printing.soft-proofing-in-lightroom'],
    description: 'Why prints need MORE sharpening than screens, and the per-paper-type tuning in Lightroom\'s Export and Print modules.',
    theorySeed:
      'Ink absorbs and spreads on paper, softening the image. Screens are pixel-perfect; prints are not. Print sharpening compensates by adding extra acutance at export. Lightroom\'s Export dialog has Output Sharpening: Screen (light), Matte Paper (medium), Glossy Paper (heavier). Pick the one matching your paper. Then choose amount: Standard for general work, High for landscape or detailed subject, Low for portraits (skin texture exaggeration is bad). Print module sharpening (if using Print module not Export) lives under Print Job > Print Sharpening with the same options. Critically: sharpening for print is on TOP of develop-module sharpening; double-counting can over-sharpen. A reasonable workflow: keep develop sharpening at moderate defaults (Amount ~40), let output sharpening do the print boost. Inspect at 100% in soft proof — halos around edges = too much.',
    assignmentSeed:
      'Take one image you intend to print. Export it twice from Lightroom: (1) for screen — sRGB JPEG, Output Sharpening = Screen / Standard; (2) for print — AdobeRGB TIFF 16-bit, Output Sharpening = Matte Paper or Glossy / Standard (match your paper). Open both in Preview / a viewer at 100% zoom. Compare the apparent sharpening — the print version should look SLIGHTLY over-sharpened on screen (it won\'t be when actually printed). Submit both files or screenshots. Rubric: output sharpening type matches the target output (core), print version visibly sharper at 100% than screen version (core), no harsh halos at edges (non-core).',
  },

  // ─── Tier 3 — Craft (3) ─────────────────────────────────────────────────
  {
    id: 'printing.print-evaluation',
    branch: 'printing',
    tier: 3,
    name: 'Print Evaluation (D50 Light, Distance, What to Judge)',
    prereqs: ['printing.epson-print-layout-app'],
    description: 'How to judge a print fairly: under proper light, at a sensible viewing distance, comparing intent vs result.',
    theorySeed:
      'A print judged in the wrong light is a wasted print. The gold standard is D50 light (5000K daylight-balanced, ~CRI 95+), which mimics daylight at noon — a "viewing booth" or a CRI-95+ LED desk lamp set to 5000K. Indoor incandescent (warm 2700K) makes everything look yellow; cool office fluorescent makes everything look cyan. Judging distance: stand back to the print\'s diagonal length (a 13x19 print → ~24 inches viewing distance) — this is how people actually view prints on a wall. WHAT TO JUDGE in order: (1) overall mood — does it match what you intended? (2) tonal range — full blacks, clean whites, midtone separation? (3) colour — neutral skin / paper white, no unwanted casts? (4) detail — sharp where you wanted, soft where appropriate? (5) print quality — banding, streaks, head clogs? Take notes; the second print of any image is always better because you know what to fix.',
    assignmentSeed:
      'Make ONE print at any size on any paper you have. Evaluate it: (1) under proper light (D50 / daylight bulb, OR a window with overcast natural light), (2) at viewing distance (back up to roughly the diagonal of the print), (3) following the 5-question judging order above. Submit a phone photo of the print held up + a 4-5-line written critique covering tonal range, colour, detail, and one thing to improve next time. Rubric: judged under proper light not incandescent (core), critique addresses at least 3 of the 5 categories (core), specific actionable improvement identified (non-core).',
  },
  {
    id: 'printing.bw-printing',
    branch: 'printing',
    tier: 3,
    name: 'B&W Printing (ET-8550\'s Gray Ink Earns Its Keep)',
    prereqs: ['printing.epson-print-layout-app', 'printing.soft-proofing-in-lightroom'],
    description: 'Why the ET-8550\'s dedicated Gray ink makes it a serious B&W printer — and how to print B&W properly (NOT through CMYK conversion).',
    theorySeed:
      'B&W printing on a colour printer is a known minefield: the printer converts neutral grey to mixes of C+M+Y inks, and any imbalance prints with a green or magenta cast. The ET-8550 has a dedicated GRAY (Gy) ink in addition to Black, specifically to print neutral B&W without colour casts. Workflow: in Lightroom, convert image to B&W (Branch 3 Tier 3 work). Export TIFF 16-bit. In Epson Print Layout, ENABLE the "Advanced B&W Photo" mode (Color Management > Color Controls > Advanced B&W). This routes through Black + Gray inks instead of the colour set. Pick a toning: Neutral (true grey), Cool (slight blue, classic darkroom-paper look), Warm (slight sepia, fine art look). Print on a paper that supports B&W well — luster and matte are great; uncoated cotton rag is the classic fine art choice. The result is the ET-8550 punching above its weight class — comparable to dedicated B&W printers costing 2-3x more.',
    assignmentSeed:
      'Print ONE B&W image using Advanced B&W mode on the ET-8550. Convert the image properly in Lightroom\'s B&W panel (Branch 3 black-and-white-conversion). Export TIFF 16-bit. In Epson Print Layout, enable Advanced B&W Photo and pick a toning (Neutral, Cool, or Warm). Print on luster or matte paper. Evaluate under proper light (previous topic). Submit a phone photo of the print + the chosen toning + a note on whether the print is neutral or shows any colour cast. Rubric: Advanced B&W mode used not standard color (core), toning chosen deliberately (core), print is neutral (no visible cast under proper light) (non-core).',
  },
  {
    id: 'printing.printer-maintenance',
    branch: 'printing',
    tier: 3,
    name: 'Printer Maintenance (Nozzle Checks, Head Cleaning, Ink Levels)',
    prereqs: ['printing.epson-print-layout-app'],
    description: 'The routine maintenance that keeps the ET-8550 producing perfect prints — nozzle checks before serious work, head cleaning when needed, ink topping at the right times.',
    theorySeed:
      'The ET-8550 is an EcoTank — refillable ink tanks instead of cartridges, much cheaper per print but requires more user attention. Routine: NOZZLE CHECK before any portfolio print session (Settings > Maintenance > Nozzle Check; prints a small grid; any missing or banded sections = clogged nozzle). HEAD CLEANING if nozzle check fails (Settings > Maintenance > Head Cleaning; uses ink, do once and re-check; don\'t do 5 cleanings in a row — wastes ink and stresses the head). INK LEVEL CHECK monthly (visual through the tank windows; top up when below 1/3); USE only Epson 552 ink in this printer — third-party ink voids ICC profiles. POWER ON at least once a week to prevent ink drying in the head. If the printer sits unused for 2+ months, expect a couple of cleaning cycles to recover. The first sign of head trouble is a print with one missing colour channel (e.g., everything gets a magenta cast because Cyan nozzle is clogged).',
    assignmentSeed:
      'Run a nozzle check on the ET-8550. Submit a phone photo of the printed nozzle check pattern. If any nozzles are missing, run one head cleaning and re-check; submit that second nozzle check too. Then top off any ink tank below 1/3 full. Submit a Telegram message: nozzle check result (pass / failed-and-recovered / still-failing), ink levels current. Rubric: nozzle check actually performed and submitted (core), action taken if check failed (core), ink levels topped up where needed (non-core).',
  },

  // ─── Tier 4 — Display (3, advanced) ─────────────────────────────────────
  {
    id: 'printing.monitor-calibration',
    branch: 'printing',
    tier: 4,
    name: 'Monitor Calibration (When Soft-Proofing Disagrees with Prints)',
    prereqs: ['printing.print-evaluation'],
    description: 'When and how to calibrate your monitor with a colorimeter — and when it\'s overkill.',
    theorySeed:
      'Without calibration, your monitor\'s color is whatever the factory shipped — usually too blue, too bright, and drifts over time. For casual screen work this is fine; for matching prints to screen it\'s a real problem. The fix: a hardware COLORIMETER (Datacolor SpyderX Pro ~$170, Calibrite ColorChecker Display Pro ~$280) plus the bundled software. Workflow: install software, plug in colorimeter, hang it on the screen, run calibration (15 minutes, fully automated), accept the generated ICC profile. macOS / Windows then automatically apply the profile so all colour-managed apps (Lightroom, Photoshop, Print Layout) see calibrated colour. Re-calibrate every 4-6 weeks (LED panels drift). Target settings: 5500-6500K white point (5500 for matching prints, 6500 for general), gamma 2.2, brightness 100-120 cd/m² (the factory default 250 cd/m² is too bright — you\'ll over-edit and prints will look too dark). When to skip: if you only post to screen, never print, and don\'t care about cross-monitor consistency — calibration is overkill.',
    assignmentSeed:
      'Decision + plan, no purchase required right now. (1) Take ONE recently-printed image. Compare the print under proper light to the same image on your screen. Note the differences (too dark on print? wrong WB? colour cast?). (2) Decide if calibrating your monitor is worth the $170-280 expense based on those differences. (3) If yes: research which colorimeter (Spyder vs Calibrite), pick one, note when you\'ll buy. If no: write a one-line reason. Submit your evaluation + decision as a Telegram message. Rubric: actual print-vs-screen comparison done (core), decision is informed by the comparison not "I should because pros do" (core), if buying — specific product chosen (non-core).',
  },
  {
    id: 'printing.matting-and-framing',
    branch: 'printing',
    tier: 4,
    name: 'Matting + Framing',
    prereqs: ['printing.print-evaluation'],
    description: 'How to mat and frame a print so it looks like art on the wall, not a stuck-on poster.',
    theorySeed:
      'A great print poorly framed looks amateur; an OK print well-matted looks elevated. MATTING: a matboard with a window cut to surround the print, with a sensible border (1.5-3 inches on a 13x19 print). The mat lifts the print off the glass (preventing sticking + condensation) and visually rests the eye before the image. White or off-white mat for most photos; coloured mats are dated. Acid-free / archival board (4-ply) for prints you care about. FRAMING: simple matte-black or natural-wood frames almost always work; ornate gold frames almost never work for photography. Glass: standard glass is fine; museum / anti-reflective glass (~3x the price) is worth it for serious portfolio work. SOURCES: pre-cut mats from Frame Destination or Light Impressions; custom framing from a local shop ($40-80 per frame at common sizes); IKEA RIBBA series ($10-25) is shockingly good for the price if you\'re testing layouts. SIZE conventions: 13x19 print → 16x20 mat → 16x20 frame is a common stack.',
    assignmentSeed:
      'Plan-only assignment (no purchase required). Pick ONE of your printed images. Specify a complete framing plan: (1) print size, (2) mat size + mat color (white / off-white), (3) frame size + frame style (matte black / natural wood / something else), (4) glass type (standard / anti-reflective), (5) approximate budget, (6) where you\'ll source it (online + url, local frame shop, IKEA). Submit as a Telegram message. Rubric: all 6 elements specified (core), choices are sensible for the image (not gold ornate for a landscape) (core), realistic budget (non-core).',
  },
  {
    id: 'printing.building-a-cohesive-wall',
    branch: 'printing',
    tier: 4,
    name: 'Building a Cohesive Wall (Curation, Sizing, Sequencing)',
    prereqs: ['printing.matting-and-framing'],
    description: 'Taking a collection of individually-good prints and arranging them into a wall that reads as a cohesive body of work.',
    theorySeed:
      'A wall of prints is a CURATED collection, not a random selection. Cohesion comes from one or more of: (1) SUBJECT — all landscapes, all portraits, all of a specific place; (2) COLOUR PALETTE — all warm-toned, all desaturated, all monochrome; (3) ERA — all from one trip, one year, one project; (4) TREATMENT — all matted the same way in the same frame style. SIZING strategy: vary the sizes intentionally — a 13x19 anchor surrounded by 8x10s reads better than 5 identical 11x14s in a line. SEQUENCING: think of it like albums — order tells a story (chronological, emotional arc, formal patterns). LAYOUT: try paper templates on the wall before drilling — cut newspaper to mat dimensions, masking-tape them up, live with the layout for a day before committing. Common mistake: hanging prints individually as they\'re finished, ending up with a wall of disconnected images. Better: hold finished prints in a drawer until you have 4-6 that belong together, then hang the whole set at once.',
    assignmentSeed:
      'Curation + planning assignment (no actual hanging required). Pick 4-6 photos from your library that COULD form a cohesive wall. Identify the cohesion theme (subject / colour / era / treatment). Sketch (paper or digital) a wall layout with specific print sizes and arrangement. Submit a photo of the sketch + a 2-3 sentence statement of what the wall is "about." Rubric: 4-6 photos chosen with a clear cohesion thread (core), wall layout sketched with sizes (core), the "about" statement reads like a real curatorial choice (non-core).',
  },
];
