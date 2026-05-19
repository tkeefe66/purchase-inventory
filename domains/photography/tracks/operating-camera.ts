import type { Topic } from '../skillTree.js';

/**
 * Branch 1 — Operating the Camera. Confident control of the a6700 in any
 * situation.
 *
 * Tier 1 — Foundation:        get shooting, in A mode, RAW, with EVF aids
 * Tier 2 — Control:           graduate to manual + understand the meter
 * Tier 3 — Focus & Motion:    AF modes, subject recognition, motion control
 * Tier 4 — Discipline & Gear: workflow + a6700-specific configuration
 *
 * All assignments use the a6700 + Sigma 18-50 by default; some reference the
 * 70-350 where the topic specifically calls for reach.
 */
export const OPERATING_CAMERA_TOPICS: readonly Topic[] = [
  // ─── Tier 1 — Foundation (5) ────────────────────────────────────────────
  {
    id: 'operating-camera.exposure-triangle',
    branch: 'operating-camera',
    tier: 1,
    name: 'Exposure Triangle',
    prereqs: [],
    description: 'How aperture, shutter speed, and ISO combine to produce a correctly exposed image — and the trade-offs each one forces.',
    theorySeed:
      `Three controls determine exposure:

- **Aperture** — lens opening; smaller f-number = more light + shallower depth of field
- **Shutter speed** — how long the sensor sees light; slower = more light + motion blur
- **ISO** — sensor amplification; higher = more light + more noise

The unit of light is the **stop**. Each stop doubles or halves exposure, and all three controls are measured in stops so trades are intuitive — close aperture one stop = double shutter time = same exposure.

The internalised lesson: these three are NOT independent. *Moving one corner of the triangle forces movement at another* to hold exposure constant.`,
    assignmentSeed:
      `Without leaving the house, take three photographs of the **same subject** (a houseplant, mug, or window view) on the a6700 in manual mode:

1. One prioritising **depth of field**
2. One prioritising **motion freeze**
3. One prioritising **low ISO**

For each, write down all three settings and explain in one sentence which corner of the triangle was the priority and what was traded off.

**Rubric:**

- Correct exposure across all three *(core)*
- Three visibly different stylistic choices *(core)*
- Clear reasoning per image *(non-core)*`,
  },
  {
    id: 'operating-camera.aperture-priority',
    branch: 'operating-camera',
    tier: 1,
    name: 'Aperture Priority (A)',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'Letting the camera pick shutter while you control depth of field — the right default for most outdoor and travel work and the best mode to start in.',
    theorySeed:
      `In **A mode**, you pick aperture and ISO, and the camera picks shutter to match the meter. This is the right default when depth of field is the visual decision driver and light is variable — walking around, candid people work, landscape grand-views.

It is also the best mode to learn in: *one creative decision (aperture) is yours*, and exposure happens for you.

The risk is that in low light the camera will pick a shutter speed too slow for handheld; mitigate with **auto-ISO** (set a max ISO + min shutter speed) or watch the shutter readout. On the a6700, set **ISO Auto Min SS** to about 1/(2×focal length) for handheld safety.`,
    assignmentSeed:
      `Take a **20-frame walk** outside (yard or block) in aperture priority:

- For half the frames use **f/2.8** on the Sigma
- For the other half use **f/8**
- Subjects: vary — close-ups, mid-distance, scenes

Submit one f/2.8 frame and one f/8 frame that best illustrate when each aperture was the right choice, with a sentence explaining each.

**Rubric:**

- Depth-of-field difference clearly visible *(core)*
- Thoughtful pairing not random *(core)*
- Exposure correct in both *(non-core)*`,
  },
  {
    id: 'operating-camera.iso-behavior',
    branch: 'operating-camera',
    tier: 1,
    name: 'ISO Behavior',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'How ISO actually works on a modern APS-C sensor — base ISO, dual-gain transitions, noise vs detail, and when to push it.',
    theorySeed:
      `**ISO** is sensor signal amplification, not "sensitivity" — it brightens the captured signal *after* exposure.

The a6700 has **base ISO 100** with the cleanest output and a second native gain stage near **ISO 800-1000** where noise actually drops slightly. Higher ISO trades clean shadows for the ability to use a faster shutter or smaller aperture; in low light it is usually better than blur or camera shake. Modern denoise tools recover usable detail up to **ISO 6400-12800**.

The *hierarchy when light is short*:

1. Open aperture first
2. Drop shutter to handheld limit (1/focal-length-eq)
3. THEN raise ISO`,
    assignmentSeed:
      `In a dim indoor scene (lamp-lit room after dusk), shoot the same composition at **ISO 100, 400, 1600, 6400, and 12800** — adjusting shutter speed at each step to hold exposure constant, aperture fixed at f/2.8 on the Sigma.

1. Crop into a shadow area at 100% and compare noise
2. Identify the highest ISO you would accept for:
   - A phone-shared snapshot
   - An Instagram post
   - A print on the ET-8550

**Rubric:**

- Exposure held constant across all five *(core)*
- Informed comparison with specific noise observations *(core)*
- Realistic per-output thresholds *(non-core)*`,
  },
  {
    id: 'operating-camera.evf-live-view',
    branch: 'operating-camera',
    tier: 1,
    name: 'EVF, Zebras, Focus Peaking, Magnify',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'Using the a6700\'s electronic viewfinder and live-view aids to nail exposure and focus IN THE MOMENT instead of chimping after each frame.',
    theorySeed:
      `The a6700's **EVF** shows a real-time preview of what the sensor sees — including exposure. The big shift from DSLR or phone: *what you see in the EVF is what you get*.

Live-view aids supercharge this:

- **Zebras** (configurable to 70/100/100+) flag over-exposed pixels in real time — set to 100 to see what will blow out
- **Focus Peaking** highlights edges in sharp focus with a colour overlay — essential for manual focus, useful as a sanity check in AF
- **Magnify** (assigned to a custom button) zooms into the focus point for critical-focus checks
- **Live histogram** in the EVF gives data instead of guesses

Together: you can see and adjust exposure and focus *before* pressing the shutter, not after.`,
    assignmentSeed:
      `Configure your a6700:

1. Enable **Zebras** at 100
2. Turn on **Focus Peaking** (red, medium level)
3. Show **live histogram** in EVF
4. Assign **Magnify** to a custom button (C1 or AEL works)

Then go take five photos of anything where critical focus or highlight protection matters — backlit subjects, fine detail, manual-focus close-ups. For each, narrate (in a Telegram message) which aid you actually relied on for the shot. Submit the five photos.

**Rubric:**

- All four aids visibly configured *(core)*
- Each photo tied to a real use of an aid *(core)*
- No overexposed highlights blown past zebras *(non-core)*`,
  },
  {
    id: 'operating-camera.raw-vs-jpeg',
    branch: 'operating-camera',
    tier: 1,
    name: 'RAW vs JPEG',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'What you give up shooting JPEG and what you gain shooting RAW — and why "RAW always" is the right default to learn in.',
    theorySeed:
      `**JPEG** bakes the camera's colour, contrast, sharpening, and white-balance decisions into an 8-bit compressed file ready to share.

**RAW** (Sony ARW) stores the sensor data unprocessed — 14-bit, much larger, requires Lightroom or similar to view. RAW gives huge latitude: *recover blown highlights and crushed shadows, change WB freely, push exposure ±2 stops cleanly*. JPEG is faster to deliver and storage-cheap.

The a6700 can shoot RAW+JPEG simultaneously — overkill for learning.

Defaults:

- **RAW only** — for everything you might want to edit
- **JPEG** (or RAW with phone-shareable preview) — for snapshots you share immediately to a phone`,
    assignmentSeed:
      `Shoot one scene with deliberately challenging dynamic range — a bright window from inside a darker room — twice:

1. Once as **JPEG only**
2. Once as **RAW only**

Import both into Lightroom. Push the JPEG to recover highlights and lift shadows; do the same to the RAW. Submit both processed versions side-by-side and write one sentence on the visible difference (banding, colour shift, noise in the JPEG).

**Rubric:**

- Visible artefacts in the JPEG vs clean RAW recovery *(core)*
- Comparable starting point *(core)*
- Correct identification of WHERE the JPEG breaks down *(non-core)*`,
  },

  // ─── Tier 2 — Control (6) ───────────────────────────────────────────────
  {
    id: 'operating-camera.shutter-priority',
    branch: 'operating-camera',
    tier: 2,
    name: 'Shutter Priority (S)',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'Letting the camera pick aperture while you control motion — for action, panning, and intentional motion blur.',
    theorySeed:
      `In **S mode**, you pick shutter and ISO, the camera picks aperture. Use it when motion is the decision driver:

- Freezing a kid running — **1/500+**
- Panning a cyclist — **1/30-1/60**
- Capturing flowing water — **1/4-2s**

The risk in low light is that the camera maxes out at the widest aperture and underexposes; watch the aperture readout flashing as a warning.

**Auto-ISO** complements S nicely — let ISO float to hold both your shutter and a usable aperture.

*Rule of thumb for handheld sharpness:* shutter ≥ 1/(equivalent focal length).`,
    assignmentSeed:
      `Find any moving subject — running water, pets, kids, a fan, traffic. Shoot it at **1/1000, 1/250, 1/60, and 1/15** in shutter priority. Submit four frames.

Identify which shutter best matches your creative intent for THIS subject and write one sentence explaining why.

**Rubric:**

- Visible motion difference across the four *(core)*
- Correct stated intent for chosen frame *(core)*
- No motion blur in the 1/1000 shot from camera shake *(non-core)*`,
  },
  {
    id: 'operating-camera.manual-mode',
    branch: 'operating-camera',
    tier: 2,
    name: 'Manual Mode (M)',
    prereqs: ['operating-camera.aperture-priority', 'operating-camera.shutter-priority'],
    description: 'Setting all three exposure controls yourself, reading the meter, and deciding when manual is right vs an auto mode.',
    theorySeed:
      `**Manual mode** is full control: you set aperture, shutter, and ISO, and the in-viewfinder meter shows **±EV** from what the camera thinks is correct.

Use manual when:

- The light is stable and you want consistency across a sequence (studio, landscapes, controlled portraits)
- You intentionally want to override what the meter wants (back-lit subjects, snow, night)

*Workflow:*

1. Pick aperture for depth of field
2. Pick shutter for motion
3. Raise ISO to make the meter agree

The a6700 has dedicated dials for aperture and shutter — learn to drive them without looking at the screen.`,
    assignmentSeed:
      `Set the a6700 to **M**. Photograph one subject in three different lighting conditions inside your home:

1. Window-lit
2. Lamp-lit
3. Mixed

In each, dial in settings using the meter to hit **"0 EV"**. Then re-shoot one of them deliberately at **+1 EV** and **-1 EV**. Submit five frames.

**Rubric:**

- Meter at 0 EV on three "correct" frames *(core)*
- Deliberate overexposed/underexposed pair visible *(core)*
- All five in manual not aperture/shutter priority *(core)*`,
  },
  {
    id: 'operating-camera.exposure-compensation',
    branch: 'operating-camera',
    tier: 2,
    name: 'Exposure Compensation',
    prereqs: ['operating-camera.aperture-priority'],
    description: 'Telling the camera "make it brighter / darker than the meter wants" in A or S mode — and reading when you need to.',
    theorySeed:
      `**Exposure compensation** (the +/- dial) shifts the meter's "0 EV" by a chosen number of stops in A, S, or P mode.

- **Positive comp** — when the scene is dominated by bright things the meter wants to render grey (snow, white sand, bright sky → **+1 to +2**)
- **Negative comp** — when the scene is dominated by dark things (black animal on black fabric, night street → **-1 to -2**)

Useful even in everyday work — *a backlit face often needs +2/3 to +1 to look right*.

On the a6700, comp is a dedicated dial; in M mode with auto-ISO, comp shifts the ISO the camera picks.`,
    assignmentSeed:
      `Photograph two scenes using aperture priority:

1. A **high-key scene** (snow, white wall in bright light, white plate with white food)
2. A **low-key scene** (something dark — a black coat, a dim interior corner)

For each, take three frames:

- At **0 EV** (meter's default)
- At the **+/- comp value** where the result looks right to your eye

Submit all six.

**Rubric:**

- Meter-default frames demonstrably wrong for the scene *(core)*
- Corrected frames at sensible comp values *(core)*
- Brief note on the comp value chosen and why *(non-core)*`,
  },
  {
    id: 'operating-camera.metering-modes',
    branch: 'operating-camera',
    tier: 2,
    name: 'Metering Modes',
    prereqs: ['operating-camera.exposure-compensation'],
    description: 'How the camera measures light (multi, centre-weighted, spot, highlight), and when to override the default.',
    theorySeed:
      `The meter reads light off the scene to decide "correct exposure":

- **Multi** (evaluative) — averages across the frame with bias toward the AF point; right for most scenes
- **Centre-weighted** — prioritises the middle ~60%; useful when the subject is centred and the edges are bright/dark distractions
- **Spot** — reads only ~3%; use it to expose for a specific small subject in tough light (backlit face, bird against sky)
- **Highlight-priority** — biases against blowing highlights; useful for stage lighting, snow, white animals, wedding dresses

The meter is calibrated for **18% grey**; *very white or very dark scenes will fool it unless you compensate*.`,
    assignmentSeed:
      `Find a backlit scene — a window, a sunset doorway, anything where the bright background dominates. Photograph it three times with the same exposure mode and settings:

1. Once on **Multi** metering
2. Once on **Centre-weighted**
3. Once on **Spot** (with the AF point on the foreground subject)

Submit all three plus a one-sentence note on which got the subject right, and why the others did not.

**Rubric:**

- Visible exposure difference across the three *(core)*
- Correct identification of the best for the subject *(core)*
- AF point on the subject for the spot frame *(non-core)*`,
  },
  {
    id: 'operating-camera.histogram-reading',
    branch: 'operating-camera',
    tier: 2,
    name: 'Reading the Histogram',
    prereqs: ['operating-camera.raw-vs-jpeg'],
    description: 'Why the back-of-camera image lies in bright light, and how the histogram is the truth about exposure.',
    theorySeed:
      `The **histogram** plots tonal distribution from pure black (left) to pure white (right).

- A **clipped right edge** means highlights are blown — *gone forever*, recoverable only if you were shooting RAW and were within ~1 stop
- A **clipped left edge** means shadows are crushed — recoverable in RAW with noise

The back-of-camera image at full brightness looks fine outdoors when in fact it is 2 stops underexposed; *the histogram does not lie*. Train yourself to glance at it after every shot in tough light.

The a6700 can show a live histogram in EVF — turn it on for studio and landscape, off for snap-shooting.`,
    assignmentSeed:
      `In bright outdoor light, take three frames where the rear LCD looks "fine" but the histogram tells a different story:

1. One with **clipped highlights** (sky blown)
2. One **underexposed** (histogram shoved left)
3. One **correctly exposed** (full range used, no clipping)

Submit all three with the histogram visible in the corner (or describe each verbally).

**Rubric:**

- Clear histogram differences across the three *(core)*
- Correct verbal interpretation of each *(core)*
- Uses the rule *"expose to the right without clipping"* for the correct frame *(non-core)*`,
  },
  {
    id: 'operating-camera.white-balance',
    branch: 'operating-camera',
    tier: 2,
    name: 'White Balance (Auto, Presets, Custom)',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'Why white balance matters even when shooting RAW, and when to override Auto WB with a preset or custom Kelvin value.',
    theorySeed:
      `**White balance** maps "what the camera saw" to "what looks neutral to your eye" by setting a colour temperature in **Kelvin** (*warmer = lower K*).

**Auto WB** on the a6700 is excellent but it can flip between frames in mixed light (tungsten + window), which is annoying in Lightroom.

In RAW you can change WB freely after the fact, but a wrong WB still affects the preview, the histogram, and your live decisions about exposure.

- **Preset** (Daylight 5500K, Shade 7500K, Tungsten 3200K) — for consistency across a sequence
- **Custom** (a grey card) — when colour matters most — products, portraits, prints`,
    assignmentSeed:
      `Photograph the same scene three times under mixed light (a window-lit room with at least one lamp on):

1. Once at **Auto WB**
2. Once at **Daylight preset**
3. Once at **Tungsten preset**

Submit all three side-by-side. Then go to Lightroom and demonstrate that you can match the Daylight version starting from the Tungsten file using just the temperature slider.

**Rubric:**

- Visible colour shift across the three *(core)*
- Lightroom match within reason *(core)*
- Notes on which version best matched your eye *(non-core)*`,
  },

  // ─── Tier 3 — Focus & Motion (6) ────────────────────────────────────────
  {
    id: 'operating-camera.focus-modes',
    branch: 'operating-camera',
    tier: 3,
    name: 'Focus Modes (AF-S, AF-C, AI Subject)',
    prereqs: ['operating-camera.manual-mode'],
    description: 'Picking the right autofocus mode for a static subject vs a moving one — and using the a6700\'s subject-recognition AF.',
    theorySeed:
      `- **AF-S** (single) — locks focus once; right for static subjects — landscapes, posed portraits, still life
- **AF-C** (continuous) — tracks focus while the shutter is half-pressed; right for anything that moves — kids, pets, sport, wildlife

The a6700 adds **AI subject recognition**: enable *Human / Animal / Bird / Insect / Car / Train / Airplane* and the camera prioritises eyes on that subject inside the AF area.

Combinations:

- **AF-C + subject recognition** — moving organic subjects (dog running)
- **AF-S + spot AF** — compositions where you want exact placement on a specific element, like the corner of a window`,
    assignmentSeed:
      `Photograph a moving subject (pet, kid, car, even a friend walking toward you) twice:

1. Once with **AF-S**
2. Once with **AF-C + appropriate subject recognition**

Take 5-10 frames each. Submit one frame from each set:

- The AF-S frame should show focus lag (subject not sharp where you wanted)
- The AF-C frame should be tack-sharp on the intended point

**Rubric:**

- Clear sharpness contrast between the two *(core)*
- Subject recognition was the right type for the subject *(core)*
- Correct AF area mode chosen *(non-core)*`,
  },
  {
    id: 'operating-camera.af-subject-recognition',
    branch: 'operating-camera',
    tier: 3,
    name: 'AF Subject Recognition (Eye AF, Animal, Bird, Insect)',
    prereqs: ['operating-camera.focus-modes'],
    description: 'The a6700\'s real superpower — AI-driven subject recognition that locks focus on eyes across humans, animals, birds, insects, cars, trains, and airplanes.',
    theorySeed:
      `The a6700 (and Sony's newer bodies generally) include **subject-recognition AF** that beats anything available three years ago.

Set the **Recognition Target** — *Human, Animal, Bird, Insect, Car/Train/Airplane* — and the camera prioritises eyes on that subject anywhere in the AF area.

- **AF-C + Wide AF area** — you can compose freely and the camera tracks the subject
- **AF-S + small AF area** — nails the eye exactly where you placed it

*Right-target matters:* "Animal" misses birds, "Bird" misses dogs. There's a **"Both: Human / Animal"** preset for mixed scenes.

Recognition works through obstacles (subject turns away, walks behind a tree, comes back) — *far more forgiving than older systems*.`,
    assignmentSeed:
      `Three frames, each with the appropriate Recognition Target and **AF-C**:

1. A **pet or animal** with the eye in sharp focus
2. A **human face** (yourself in a mirror, or a friend)
3. Something the camera should fail on with default Human/Animal — try **Insect** on a bug, or **Bird** on a backyard bird

Note in your caption which target you used and whether the camera locked the eye.

**Rubric:**

- Each frame shot with the correct Recognition Target for the subject *(core)*
- Eye visibly in sharpest focus on at least two of three *(core)*
- Thoughtful note on the failure case *(non-core)*`,
  },
  {
    id: 'operating-camera.drive-modes',
    branch: 'operating-camera',
    tier: 3,
    name: 'Drive Modes (Single, Burst, Self-Timer)',
    prereqs: ['operating-camera.focus-modes'],
    description: 'Picking single-shot vs burst speeds vs self-timer based on the type of moment you are trying to capture.',
    theorySeed:
      `The a6700 offers:

- **Single**
- **Continuous-Lo** (~3 fps)
- **Continuous-Mid** (~6 fps)
- **Continuous-Hi** (~11 fps)
- **2s and 10s self-timer**
- **Bracketing**

When to use what:

- **Single** — landscape, still life, posed work — *every shutter press is a deliberate decision*
- **Burst** — unpredictable peak-action moments: kid laughing, dog mid-jump, wave breaking. Higher fps = more frames to cull but better odds of catching the peak; lower fps wastes less card + battery
- **Self-timer** — tripod work (avoid shake at slow shutter speeds — use 2s with electronic first-curtain), or for getting yourself in the frame`,
    assignmentSeed:
      `Run two shoots:

1. A **still-life arrangement** on a table, **Single drive**, 5 frames each a deliberate composition variant
2. Something with **unpredictable peak action** — a pet playing, water splashing, a kid being a kid — **Continuous-Hi burst**, 30+ frames. Cull the burst to the single best frame.

Submit the best still-life frame and the best burst-derived frame.

**Rubric:**

- Still-life shows compositional intent across the series *(core)*
- Burst captures a peak moment that would have been missed at Single *(core)*
- Realistic cull ratio not "kept everything" *(non-core)*`,
  },
  {
    id: 'operating-camera.motion-control',
    branch: 'operating-camera',
    tier: 3,
    name: 'Camera Shake, Freezing Motion, Panning',
    prereqs: ['operating-camera.shutter-priority'],
    description: 'How shutter speed interacts with handheld stability, subject speed, and IBIS — and how to deliberately use motion as a creative choice.',
    theorySeed:
      `Two motion problems:

- **Camera shake** — your hands shaking the camera
- **Subject motion** — the thing you're shooting moving

*Rule of thumb* for camera shake on the Sigma 18-50: **shutter ≥ 1 / (focal-length × crop factor)** — so at 50mm, at least **1/75s** handheld. The a6700's **IBIS** buys you ~3 stops, so handheld at 50mm down to maybe **1/8s** is realistic.

Subject motion needs more shutter:

- Walking person — **1/125s**
- Running pet — **1/500s**
- Fast sports — **1/1000s+**

**Panning** (matching camera motion to subject) lets you use a slow shutter to blur the background while keeping the subject sharp — *a stylised cycling/wildlife technique that takes practice but creates motion in still images*.`,
    assignmentSeed:
      `Two parts:

1. Find a moving subject (kid, pet, car):
   - **Freeze** it at **1/1000s**
   - Then deliberately **blur** it at **1/30s** while standing still
   - Submit both
2. Attempt a **pan**: same moving subject, **1/30s**, follow the subject smoothly with the camera as you fire a burst. Submit the best pan from the burst.

**Rubric:**

- Tack-sharp freeze frame at 1/1000s *(core)*
- Visible motion blur at 1/30s standing still *(core)*
- At least one pan with sharp(ish) subject + clearly blurred background *(non-core)*`,
  },
  {
    id: 'operating-camera.depth-of-field',
    branch: 'operating-camera',
    tier: 3,
    name: 'Depth of Field + Bokeh',
    prereqs: ['operating-camera.aperture-priority'],
    description: 'How aperture, focal length, and distance combine to determine what\'s sharp — and how to use shallow DOF for subject isolation without losing the eye.',
    theorySeed:
      `Three things determine depth of field:

- **Aperture** — wider = shallower
- **Focal length** — longer = shallower at the same composition
- **Focus distance** — closer = shallower

At **f/2.8 on the Sigma 18-50 at 50mm**, focusing 3 feet away, only about 2 inches will be sharp — enough for an eye but not both ears on a dog. The **Sony 70-350 at 350mm and f/6.3** still produces strong subject isolation thanks to focal length, even though it's a slower lens.

**Bokeh** quality (background blur character) depends on lens design — *Sigma's rounded aperture blades give smooth circles wide-open, less hexagonal stopped down*.

Wide-open isn't always the answer: sometimes **f/4** keeps the whole face sharp while still throwing the background out.`,
    assignmentSeed:
      `Photograph the same subject (a coffee mug, a houseplant, a willing friend) from the same distance using the Sigma at 50mm:

1. At **f/2.8**
2. At **f/5.6**
3. At **f/11**

Notice how the background sharpens as you stop down. Then move closer (about 2 feet) and shoot one more at **f/2.8** — see how much shallower DOF becomes. Submit all four.

**Rubric:**

- Visible DOF change across the three aperture variations *(core)*
- Even shallower DOF in the closer frame *(core)*
- Background quality observation included *(non-core)*`,
  },
  {
    id: 'operating-camera.focal-length-fov',
    branch: 'operating-camera',
    tier: 3,
    name: 'Focal Length + Field of View',
    prereqs: ['operating-camera.exposure-triangle'],
    description: 'How focal length shapes field of view, perspective, and subject isolation — and how the a6700\'s APS-C crop factor plays into focal-length choices.',
    theorySeed:
      `**Focal length** (in mm) is the optical property that determines field of view: *shorter = wider, longer = narrower*.

The a6700 has an **APS-C sensor** with a **1.5× crop factor**, so an 18mm lens behaves like 27mm on full-frame — *an important detail when reading focal-length advice written for full-frame shooters*.

Focal length also changes the apparent compression of the scene:

- **Wide angles** — exaggerate distance (foreground large, background small)
- **Telephoto** — compresses (background pulls forward)

Tom's lenses:

- **Sigma 18-50** — wide-to-normal (27-75mm equivalent)
- **Sony 70-350** — telephoto-to-super-tele (105-525mm equivalent)

*Pick focal length first based on the visual story; then dial settings.*`,
    assignmentSeed:
      `Stand in one spot. Photograph the same subject (a tree, a person, a building corner) at three focal lengths:

1. **18mm**
2. **50mm**
3. **350mm** (you'll need to swap to the Sony 70-350 for the third)

Keep the SUBJECT the same approximate size in each frame by walking forward or backward. Submit all three. Notice how the background looks compared to the subject in each — *that's perspective compression in action*.

**Rubric:**

- Subject size approximately matched across three *(core)*
- Visible background compression difference *(core)*
- 35mm-equivalent focal lengths correctly identified in caption *(non-core)*`,
  },

  // ─── Tier 4 — Discipline & Gear Mastery (6) ─────────────────────────────
  {
    id: 'operating-camera.card-management',
    branch: 'operating-camera',
    tier: 4,
    name: 'Card Management',
    prereqs: ['operating-camera.raw-vs-jpeg'],
    description: 'How to format cards, plan capacity, and avoid the worst-case "lost a day of shooting" scenario.',
    theorySeed:
      `SD cards fail, get corrupted, or get accidentally erased. *Defensive practice:*

- Always **format the card IN the camera** (not on a computer)
- **Never delete files** from the computer back onto the card
- **Format before each shoot** once images are safely backed up
- Carry at least **two cards** so a failure mid-shoot is recoverable

*Estimate capacity:* a 26MP RAW on the a6700 is ~30 MB; a **128 GB card holds ~4000 RAWs** — enough for almost any day. **UHS-II V60+** cards keep up with the a6700's 11fps burst.

*Workflow:*

1. Shoot
2. Import to computer
3. Verify backup
4. Reformat in camera`,
    assignmentSeed:
      `*Not a photo assignment — a workflow one.*

Document your end-to-end card workflow: how cards get from camera to backup. Include:

- Which card(s) you use
- Where files land on the computer
- What backup exists (cloud, external drive, both)
- Whether you erase before re-using
- One improvement you should make

Submit as a short Telegram message (no photo needed).

**Rubric:**

- Clear step-by-step workflow *(core)*
- At least one backup beyond the working drive *(core)*
- Identifies one realistic improvement *(non-core)*`,
  },
  {
    id: 'operating-camera.file-naming',
    branch: 'operating-camera',
    tier: 4,
    name: 'File Naming + Folder Structure',
    prereqs: ['operating-camera.card-management'],
    description: 'A naming and folder convention that scales — so you can find a photo from two years ago in under a minute.',
    theorySeed:
      `Default camera filenames (**DSC04738**) collide every ~10000 frames and tell you nothing.

*A scalable convention:*

- Import folders as \`YYYY/YYYY-MM-DD-short-keyword/\` (e.g., \`2026/2026-05-18-fundamentals-test/\`)
- Files renamed on import to \`YYYY-MM-DD-NNNN.ARW\` (Lightroom can do this in one click)

Search by date is then trivial, and reasonable directory listings sort right.

*Avoid keywords in filenames* — Lightroom's metadata is better for that.

Sync the working drive to a cloud or external backup as the final step before formatting the card.`,
    assignmentSeed:
      `In Lightroom, set up an **Import preset** that:

1. Copies files to your chosen working drive under \`YYYY/YYYY-MM-DD-{prompt-for-keyword}/\`
2. Renames files to \`YYYY-MM-DD-NNNN.ext\`
3. Applies your default Develop preset
4. Flags everything for backup

Demonstrate it works by importing a small batch and submitting a screenshot of the resulting folder + filenames.

**Rubric:**

- Matches the dated folder pattern *(core)*
- Files renamed not at default *(core)*
- Import preset saved for re-use *(non-core)*`,
  },
  {
    id: 'operating-camera.settings-hygiene',
    branch: 'operating-camera',
    tier: 4,
    name: 'Settings Hygiene (Pre-Shoot Checklist)',
    prereqs: ['operating-camera.file-naming'],
    description: 'A 30-second pre-shoot mental checklist so you never discover "ISO 6400 in daylight" or "JPEG only" two hours in.',
    theorySeed:
      `A **pre-shoot checklist** catches the mistakes that ruin an outing. *The minimum:*

- **Card** — formatted (or has known free space)
- **Battery** — charged
- **ISO** — at a sane starting value (100 for daylight, 800 for indoor)
- **Drive mode** — appropriate (Single for landscape, Burst for action)
- **AF mode** — appropriate (AF-S still, AF-C moving)
- **File format** — correct (RAW for keepers, RAW+JPEG only when sharing matters)
- **WB** — sensible (Auto unless you have a reason)

*Do this scan EVERY time you turn the camera on after a gap.*

Tom should also bank a **"custom dial 1"** preset on the a6700 for a known-good starting point.`,
    assignmentSeed:
      `Configure **C1** (or any custom button) on the a6700 to recall a sensible default setup:

- M mode
- ISO 100
- 1/250
- f/5.6
- AF-S
- Single drive
- RAW
- Auto WB

Test that pressing C1 from any other configuration restores it. Document the steps as a 5-line Telegram message AND submit one photo taken using the recalled defaults (subject of your choice) to prove they actually work.

**Rubric:**

- Recall button correctly restores all 7 settings *(core)*
- Photo demonstrates the recalled state *(core)*
- Documented steps clear enough to repeat from memory *(non-core)*`,
  },
  {
    id: 'operating-camera.gear-care',
    branch: 'operating-camera',
    tier: 4,
    name: 'Gear Care (Cleaning, Storage, Travel)',
    prereqs: ['operating-camera.settings-hygiene'],
    description: 'How to keep the a6700 and lenses physically reliable — sensor and lens cleaning, humidity, packing for travel.',
    theorySeed:
      `Cameras are robust, but *neglected gear fails at the worst moments*.

- **Front-element cleaning** — rocket blower first, then microfibre with one drop of fluid — *never dry-rub dust into the coating*
- **Sensor cleaning** — trigger the built-in self-clean (Menu) before any visible dust appears; for stuck spots, the wet-swab method or a service appointment
- **Storage** — dry, not in a sealed plastic bag (condensation breeds fungus); silica-gel packets help in humid climates
- **Travel** — lenses in a padded bag with the body separately, batteries in carry-on (lithium rules), card reader + spare cards always

*Insurance for the kit is worth it once you cross ~$3k in value, which Tom is already past.*`,
    assignmentSeed:
      `Inventory your photo kit physically: lay everything out on a table — body, lenses, batteries, cards, chargers, cleaning supplies, bag.

1. Identify what's missing (rocket blower? microfibre cloths? sensor swabs? spare battery? cable?)
2. Identify what's broken or wearing out

Submit a phone photo of the laid-out kit plus a 3-5-item shopping list of what to buy or replace.

**Rubric:**

- At least one missing-item gap identified *(core)*
- Realistic shopping list *(core)*
- Plan for where in the bag everything lives *(non-core)*`,
  },
  {
    id: 'operating-camera.a6700-custom-buttons',
    branch: 'operating-camera',
    tier: 4,
    name: 'a6700 Custom Buttons + Function Menu',
    prereqs: ['operating-camera.settings-hygiene'],
    description: 'Wiring the a6700\'s C1/C2/C3/C4 buttons + Fn menu to the things you actually reach for, so you almost never enter the full menu.',
    theorySeed:
      `The a6700 has four customisable buttons (**C1** on top, **C2/C3** on the back, **C4** effectively the AEL button) plus a **12-slot Fn menu** that overlays on a half-press of Fn. *The default assignments are middling.*

*A recommended remap:*

- **C1** — Recall Custom Hold (jump to a saved settings set)
- **C2** — Focus Magnifier (critical for manual focus + check)
- **C3** — ISO (constant adjustment in changing light)
- **C4/AEL** — Eye AF override / back-button focus

*Fn menu:*

- **Top row** — AF Area, Drive Mode, ISO, WB, Metering, File Format
- **Bottom row** — rarely-changed but important

*The point:* muscle memory beats menu diving when light is changing fast.`,
    assignmentSeed:
      `Remap your a6700's four custom buttons and 12-slot Fn menu per your preferred shooting style (use the recommended starting point above or your own).

1. Document each assignment in a short Telegram message
2. Test it: shoot a short series (5-10 frames) where you have to change at least three settings between shots, using ONLY the custom buttons and Fn menu — *no entry into the main menu*

Submit one frame + the documentation.

**Rubric:**

- All 4 custom buttons assigned + at least 6 Fn slots set *(core)*
- Shooting session demonstrates muscle-memory use *(core)*
- At least one assignment specific to YOUR shooting style not just the defaults *(non-core)*`,
  },
  {
    id: 'operating-camera.a6700-ibis-practice',
    branch: 'operating-camera',
    tier: 4,
    name: 'a6700 IBIS in Practice',
    prereqs: ['operating-camera.motion-control'],
    description: 'When IBIS earns its keep, when it does not, and when to deliberately disable it (tripod, panning, long exposures).',
    theorySeed:
      `**IBIS** (In-Body Image Stabilisation) on the a6700 corrects for handheld camera shake and gives **~3-5 stops** of usable shutter relief depending on focal length and your hands.

*Real-world:* at 50mm on the Sigma, the no-IBIS handheld limit is ~**1/75s**; with IBIS you can confidently shoot at **1/15s** and sometimes **1/8s**.

*IBIS does NOT help subject motion* — a slow shutter with IBIS still blurs a moving person.

*Disable IBIS:*

- **On a tripod** — it can introduce micro-wobble correcting for non-existent shake
- **During panning** — it fights the intentional motion

For exposures **over ~1s**, tripod with IBIS off is the only correct answer.

*Quick toggle:* assign IBIS on/off to a custom button.`,
    assignmentSeed:
      `Two-part:

1. **Find the handheld limit with IBIS on.** At 50mm on the Sigma, shoot the same static subject at **1/30, 1/15, 1/8, 1/4s** — handheld, IBIS on. Identify the slowest shutter where you got a usable sharp frame.
2. **Tripod test:** mount the camera on any tripod (or solid surface), set shutter to **1s**, take one frame with IBIS on and one with IBIS off. Compare at 100% for any micro-blur from IBIS over-correction.

Submit best handheld + both tripod frames + your findings.

**Rubric:**

- Identified personal handheld limit with IBIS *(core)*
- Tripod IBIS-off frame demonstrably sharper or equal *(core)*
- Notes on when to leave IBIS on vs off *(non-core)*`,
  },
];
