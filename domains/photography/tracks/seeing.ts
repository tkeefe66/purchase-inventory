import type { Topic } from '../skillTree.js';

/**
 * Branch 2 — Seeing. Making photos that are about something, not just
 * technically correct. Runs in parallel with Branch 1 (you don't have to
 * finish Operating Camera Tier 4 to start Tier 1 here).
 *
 * Tier 1 — Fundamentals:   composition, light, story (the three pillars)
 * Tier 2 — Refinement:     lens language, color vs b&w, simplicity
 * Tier 3 — Genre Recipes:  composable recipes for landscape, wildlife, dog,
 *                          travel/street, and low-light concert
 *
 * Recipes ASSUME competence with Branch 1 fundamentals (AF-C, aperture
 * priority, etc.). The agent should suggest Branch 1 work first if the
 * user hasn't done it. Branches are independent in code (the validator
 * enforces this), but they cross-reference in conversation.
 */
export const SEEING_TOPICS: readonly Topic[] = [
  // ─── Tier 1 — Fundamentals (3, all rootless) ────────────────────────────
  {
    id: 'seeing.composition-fundamentals',
    branch: 'seeing',
    tier: 1,
    name: 'Composition Fundamentals',
    prereqs: [],
    description: 'The reusable building blocks of strong composition: rule of thirds, leading lines, framing, balance, foreground anchors.',
    theorySeed:
      `Composition is the arrangement of elements inside the frame. A handful of patterns work across genres because they map to how the eye reads images.

- **Rule of thirds** — place key elements on the 1/3 lines, not dead-centre, to create visual tension
- **Leading lines** — roads, fences, shorelines lead the eye to the subject
- **Framing within the frame** — doorways, branches, windows wrap the subject and add depth
- **Balance** — a heavy element on one side asks for a counterweight on the other (or *deliberate imbalance* for tension)
- **Foreground anchors** — give the eye something to land on before travelling deeper

These are *tools, not rules* — break them when the photo asks for it, but know them so the breaking is deliberate.`,
    assignmentSeed:
      `Take five photos this week, each demonstrating ONE of these compositional choices clearly:

1. **Rule of thirds**
2. **Leading lines**
3. **Framing**
4. **Deliberate imbalance**
5. **Foreground anchor**

Subjects can be anything — kitchen, walk around the block, anywhere. In the caption, name the technique you used and which element of the frame embodies it.

**Rubric:**

- Each photo clearly demonstrates the named technique *(core)*
- Variety of subjects, not all the same kind *(core)*
- One or more photos succeed compositionally not just technically *(non-core)*`,
  },
  {
    id: 'seeing.light-quality',
    branch: 'seeing',
    tier: 1,
    name: 'Light Quality (Golden, Blue, Hard, Soft, Direction)',
    prereqs: [],
    description: 'How time of day, weather, and angle determine the character of light — and why "the same scene" looks completely different across hours.',
    theorySeed:
      `Light has four dimensions:

- **Intensity** — bright vs dim
- **Direction** — front, side, back, top
- **Quality** — hard / direct vs soft / diffused
- **Colour** — warm vs cool, measured in Kelvin

**Golden hour** (~1 hour after sunrise / before sunset) gives warm, low, side-lit, soft light — the most universally flattering for almost any subject. **Blue hour** (~30 minutes before sunrise / after sunset) gives cool, low-intensity, ambient light — moody and good for cityscapes. **Mid-day sun** is hard, top-down, contrasty — usually fights you, but great for high-contrast graphic work. **Overcast** = giant softbox in the sky — flattering for portraits, flat for landscapes.

**Backlighting** creates silhouettes and rim light; **sidelighting** reveals texture; **flat front-lighting** is technically safe but visually boring.

The agent has a \`get_sun_times\` tool to plan around golden / blue hour.`,
    assignmentSeed:
      `Photograph the same subject (a tree, your front door, a person willing to sit for you, a still-life) at three different times of day in the same week:

1. **Mid-day**
2. **Golden hour**
3. **Blue hour**

Same composition, same focal length. Submit all three. Notice how the *same thing* photographs as three different images depending on light alone.

**Rubric:**

- Visibly different light quality across the three *(core)*
- Best of the three identified with reasoning *(core)*
- Composition held constant so light is the only variable *(non-core)*`,
  },
  {
    id: 'seeing.subject-and-story',
    branch: 'seeing',
    tier: 1,
    name: 'Subject + Story (What is this photo OF, and WHY?)',
    prereqs: [],
    description: 'The single most underrated skill: before pressing the shutter, knowing what the photo is about and why anyone should care.',
    theorySeed:
      `A technically perfect photo of nothing in particular is still a photo of nothing in particular. Before you press the shutter, ask:

- What is this photo **of**?
- What makes it **interesting**?
- What is the viewer's eye supposed to **land on**?

If the answer is "I don't know", don't take it — or take it knowing it's practice.

The strongest photos have a clear **subject** (one thing the eye returns to) and a small **story** (a relationship, a moment, an emotion, a place at a moment in time). "Mountain at sunset" is a subject but barely a story. "The trail my dog ran down five minutes before this golden light hit" is a story.

Storytelling does not require a person in the frame — *a single boot by a campfire tells one*. Subject + story is what separates "vacation snapshots" from "photographs."`,
    assignmentSeed:
      `Before shooting, write down (Telegram, to me) the **subject** and **one-sentence story** for a photo you intend to take this week. Then go shoot it. Submit the photo plus your original pre-shot description.

Be specific in the description — not "a sunset" but "the bench at the trailhead where I waited for the storm to pass".

**Rubric:**

- Pre-shot description clear and specific *(core)*
- Final photo recognisably matches the pre-shot intent *(core)*
- Story is something a viewer could intuit without your caption *(non-core)*`,
  },

  // ─── Tier 2 — Refinement (3) ────────────────────────────────────────────
  {
    id: 'seeing.lens-language',
    branch: 'seeing',
    tier: 2,
    name: 'Lens Language (What 18mm vs 350mm Actually Feels Like)',
    prereqs: ['seeing.composition-fundamentals'],
    description: 'The artistic counterpart to focal-length-fov — how lens choice changes the FEEL of an image, not just what fits in the frame.',
    theorySeed:
      `Lens choice is a **storytelling decision**, not just a "how much fits" decision.

- **Wide angles** (18-24mm on Sigma) put the viewer *inside* the scene: foreground feels close, background feels far, the room feels bigger than it is
- **Telephoto** (200-350mm on the Sony 70-350) flattens space: a distant mountain looks closer to a foreground subject than it really is, layers stack, the world compresses into ribbons
- **Normal** (35-50mm) approximates what the eye sees and feels documentary-honest

The same subject shot wide vs tele tells two completely different stories: wide says *"this is a place"*; tele says *"this is a moment within a place."*

Skilled photographers pre-visualise lens before composition: I want the viewer to feel small in this landscape → wide; I want intimacy with this dog's expression → tele.`,
    assignmentSeed:
      `Pick one scene (your backyard, a park, a parking lot — anywhere with depth). Photograph it twice telling DIFFERENT stories with lens alone:

1. **18mm on the Sigma** — "this is a place, I was here" feel
2. **350mm on the Sony** — "this is a specific moment / detail within the place" feel

Compose each to feel intentional, not just "wide" and "zoomed in." Submit both with a one-sentence story for each.

**Rubric:**

- Stories are demonstrably different, not just framing *(core)*
- Each lens chosen for the right reason *(core)*
- Both compositions feel deliberate *(non-core)*`,
  },
  {
    id: 'seeing.color-vs-bw',
    branch: 'seeing',
    tier: 2,
    name: 'Color vs Black & White',
    prereqs: ['seeing.subject-and-story'],
    description: 'When colour serves the photo, when it distracts from it, and what black-and-white reveals that colour hides.',
    theorySeed:
      `A photo is in colour OR in black-and-white as a **story choice**, not a stylistic afterthought.

- **Colour belongs** when colour is part of the subject: a red barn at sunset, autumn leaves, a market full of fabric
- **Colour fights you** when it competes with form: a portrait against a busy multicoloured background, a landscape where the eye gets pulled toward a distracting orange jacket instead of the mountain
- **Black-and-white** strips away colour and reveals: *shape, line, light, texture, expression*

Documentary work, character portraits, gritty street scenes, architectural studies often live in B&W because the subject is structure or emotion, not colour.

The decision should be made BEFORE the shoot when possible — you compose for tone, light, and form differently than for colour palette. Lightroom can convert in seconds, but the strongest B&W photos were *envisioned that way at capture*.`,
    assignmentSeed:
      `Pick one subject (a face, a building, an object with strong form). Photograph it twice:

1. Once envisioning a **colour** image — compose for the palette, the warmth, the colour story
2. Once envisioning a **black-and-white** — compose for shape, light, contrast (the second shot might use harder light or stronger lines)

Process the colour shot in colour, convert the B&W shot to monochrome in Lightroom. Submit both.

**Rubric:**

- Each photo justifies its chosen mode *(core)*
- Compositional choices visibly differ between the two *(core)*
- B&W conversion uses tone curves not just "desaturate" *(non-core)*`,
  },
  {
    id: 'seeing.negative-space-and-simplicity',
    branch: 'seeing',
    tier: 2,
    name: 'Negative Space + Simplicity',
    prereqs: ['seeing.composition-fundamentals'],
    description: 'The hardest beginner skill — leaving empty space in the frame on purpose and removing every element that does not serve the subject.',
    theorySeed:
      `*Beginners fill the frame. Pros empty it.*

**Negative space** (the "blank" area around the subject) gives the subject room to breathe, directs the eye, and creates mood — a small subject in a vast empty frame reads as quiet, lonely, contemplative.

**Simplicity** means asking of every element in the frame: *does this serve the subject?* If no — recompose to exclude it (move feet, change angle, swap lens, crop). The discipline is HARD because the eye notices what is there, not what is missing; a busy background feels "complete" but actually weakens the photo.

Tactics:

- Shoot against simple backdrops (sky, blank wall, water)
- Use a longer lens to compress out clutter
- Get LOWER to put the subject against the sky
- Get CLOSER to fill the frame with just the subject

*Five things in the frame is usually one too many.*`,
    assignmentSeed:
      `Take five photos of any single subject (one per shot), each with the SIMPLEST possible composition. No more than 2-3 elements in any frame. Use one of these tactics for each:

1. Shoot against the **sky** from low
2. Shoot against a **blank wall**
3. Use the **70-350 at long end** to compress out background clutter
4. Get **very close** so subject fills frame
5. Deliberately leave **70% of the frame as negative space**

Submit all five.

**Rubric:**

- Each frame has clearly one subject and minimal distractions *(core)*
- At least one frame uses extreme negative space well *(core)*
- Photos feel quieter than your usual work *(non-core)*`,
  },

  // ─── Tier 3 — Genre Recipes (5) ─────────────────────────────────────────
  {
    id: 'seeing.landscape-recipe',
    branch: 'seeing',
    tier: 3,
    name: 'Landscape Recipe',
    prereqs: ['seeing.composition-fundamentals', 'seeing.light-quality', 'seeing.lens-language'],
    description: 'Composable recipe for landscape work — hyperfocal focus, foreground anchors, planning light + weather, when to wait vs when to shoot.',
    theorySeed:
      `**Pre-shoot:** check golden / blue hour times for the location (\`get_sun_times\` tool), check weather (clear sky is boring; clouds and storms are *gifts*), arrive 30 min early to scout.

**Gear:** Sigma 18-50 for grand-views and wides, Sony 70-350 for compressed mountain layers and distant detail, tripod if shutter < 1/30s or stacking exposures.

**Composition:** lead with a **foreground anchor** (rock, log, flower) at ~3-6 ft, **middle ground**, then the **grand scenic background** — three layers, not just "mountain".

**Focus:** hyperfocal (focus ~1/3 into the frame at f/8-f/11) to keep everything sharp; on the Sigma at 18mm f/8, focus ~6 ft and everything from 3 ft to infinity is sharp.

**Exposure:** shoot RAW, expose for the highlights (sky / clouds), recover shadows in Lightroom.

*Wait for the light — return the next day if it does not happen.*`,
    assignmentSeed:
      `Apply the landscape recipe to a real scene.

1. **Pre-shoot:** pick a location, check sunrise / sunset, plan to be there 30 minutes before
2. **Shoot:** at least 3 frames at the chosen golden / blue hour using the three-layer composition (foreground anchor + middle + background), f/8-f/11, hyperfocal focus, RAW
3. **Edit** one in Lightroom (basic — exposure, highlights, shadows)

Submit the final edited landscape plus the original RAW.

**Rubric:**

- Clear three-layer composition *(core)*
- Light is golden or blue hour, not mid-day *(core)*
- Final processed image looks deliberate, not snapshot *(non-core)*`,
  },
  {
    id: 'seeing.wildlife-bird-recipe',
    branch: 'seeing',
    tier: 3,
    name: 'Wildlife + Bird Recipe',
    prereqs: ['seeing.light-quality', 'seeing.subject-and-story'],
    description: 'Composable recipe for wildlife and birds — the 70-350 at long end, AF-C with subject recognition, shutter speed floor, patience, ethics.',
    theorySeed:
      `**Pre-shoot:** learn the SUBJECT — when does it move, what does it do, where does it stop? *A morning hour watching is worth a week of random walking.*

**Gear:** Sony 70-350 racked to long end, no tripod (you need to react), spare battery (continuous AF eats them).

**Settings:**

- Shutter priority **1/1000s minimum** (subject motion + handheld 350mm)
- Auto-ISO unlimited
- AF-C with **Recognition Target = Animal** (mammals) or **Bird** (birds — yes they are different settings on the a6700)
- Wide AF area
- Continuous-Hi burst

**Composition:** leave space in the direction the animal is looking / moving, **get LOW** (eye-level beats above-eye-level for nearly all wildlife), focus on the eye — *the eye must be sharp or the frame is rejected*.

**Ethics:** never bait, never push closer than the animal's comfort distance (back away if it changes behaviour), no nest disturbance during breeding season.

**Patience:** 90% of wildlife shooting is waiting; the keepers are 1 in 100.`,
    assignmentSeed:
      `Find a wildlife subject — backyard birds, squirrels, dogs at a park, ducks at a pond, anything. Apply the recipe:

1. Sony **70-350**
2. **S mode at 1/1000s**, auto-ISO
3. **AF-C + Animal or Bird Recognition**, Wide AF
4. **Continuous-Hi**

Shoot at least 30 frames. Cull to ONE keeper where the eye is sharp and the composition leaves space for the subject's gaze. Submit the keeper.

**Rubric:**

- Eye visibly sharp at 100% *(core)*
- Composition follows the "space in the direction of gaze" rule *(core)*
- Realistic cull from a burst, not just three lucky frames *(non-core)*`,
  },
  {
    id: 'seeing.dog-action-recipe',
    branch: 'seeing',
    tier: 3,
    name: 'Dog + Action Recipe',
    prereqs: ['seeing.composition-fundamentals', 'seeing.subject-and-story'],
    description: 'Composable recipe for dogs (and kids) at full speed — burst mode, animal Eye AF, anticipating the peak moment, getting the personality.',
    theorySeed:
      `**Pre-shoot:** warm the subject up — let the dog run for 5 minutes before you pick up the camera so they ignore you and behave normally.

**Gear:** Sigma 18-50 for close work, Sony 70-350 if you want subject-isolation, no tripod.

**Settings:**

- Shutter priority **1/500s** (run) or **1/1000s** (full sprint)
- Auto-ISO
- AF-C + **Recognition Target = Animal**
- Wide AF area
- Continuous-Hi burst

**Composition:** **GET LOW** — knee-level or lower puts you in the dog's world; eye contact with the dog's eye is the whole shot. Anticipate the **peak moment**: the dog at apex of a jump, the catch, the look-back. Burst through the moment, cull ruthlessly.

**Story:** capture personality — goofy ears, tongue out, eye expression — not just "dog running." A perfect-exposure shot of a tired dog beats a flawed shot of a joyful one *only if the tired one tells a story too*.`,
    assignmentSeed:
      `Photograph any dog (yours, a neighbor's, a park stranger's with permission) in motion for 10 minutes. Apply the recipe:

1. **Low angle**
2. **AF-C + Animal**
3. **Burst**
4. **1/500s+**
5. **Anticipate** peak moments

Cull to TWO keepers:

- One **technically sharp + peak-action**
- One that **captures personality** (could be calmer)

Submit both.

**Rubric:**

- At least one frame eye-sharp at 100% *(core)*
- Low angle in both *(core)*
- One frame demonstrably has personality / story, not just action *(non-core)*`,
  },
  {
    id: 'seeing.travel-street-recipe',
    branch: 'seeing',
    tier: 3,
    name: 'Travel + Street Recipe',
    prereqs: ['seeing.composition-fundamentals', 'seeing.lens-language'],
    description: 'Composable recipe for travel and street — discretion, lens choice for the environment, the decisive moment, environmental portraits over snapshots.',
    theorySeed:
      `**Gear:** ONE lens to commit to discretion. Sigma 18-50 at **35mm** is the classic street choice — wide enough for environment, narrow enough to isolate. Black or wrapped camera (less attention than red logos), neck strap not bag, ready to shoot in one motion.

**Settings:**

- Aperture priority **f/5.6-f/8** (deep DOF means you don't miss focus)
- Auto-ISO 100-6400
- AF-C + Wide area
- **Single drive** (the "decisive moment" is one frame)

**Composition:** **environmental portraits over snapshots** — show the person in context (their stall, their street, their work). Capture small moments: a gesture, a glance, an interaction. Wait for the moment when the elements align — the right person walks into the right light at the right gesture.

**Ethics:** be visible, smile, ask if challenged, delete on request. Tourists with cameras are everywhere — *be the one who clearly cares about the people, not the one stealing*.`,
    assignmentSeed:
      `Spend one hour photographing in a public space — a market, a busy street, a transit hub, a park.

1. **ONE lens only** — commit to 35mm on the Sigma
2. **Aperture priority f/5.6-f/8**, AF-C, Single drive
3. Shoot **30-50 frames**

Cull to TWO keepers:

- One **environmental portrait** (a person in their context)
- One **moment** (a gesture / interaction / decisive instant)

Submit both with one sentence on the story each tells.

**Rubric:**

- Each frame has a clear subject + context *(core)*
- Both frames demonstrably "moments", not just snapshots *(core)*
- Used one lens the whole time as a discipline *(non-core)*`,
  },
  {
    id: 'seeing.low-light-concert-recipe',
    branch: 'seeing',
    tier: 3,
    name: 'Low-Light + Concert Recipe',
    prereqs: ['seeing.light-quality', 'seeing.subject-and-story'],
    description: 'Composable recipe for low-light, concerts, dim interiors — pushing ISO, using your fastest lens, embracing noise as a stylistic choice.',
    theorySeed:
      `**Pre-shoot:** scout the venue if possible — where is the stage light hitting, where are the dead zones? Check the venue's photography rules.

**Gear:** Sigma 18-50 **f/2.8** is your low-light hero (the Sony 70-350 at f/6.3 is too slow for indoor stage work); *leave the slow lens at home*.

**Settings:**

- Shutter priority **1/200s** (people in motion blur slower than this)
- Auto-ISO unlimited (yes, **ISO 12800 is fine** — noise is part of the aesthetic)
- AF-C + Recognition = Human
- Wide or Zone AF (lights change fast)

**Exposure:** meter for the **LIT performer**, let the background go black (this is the look you want anyway).

**Composition:** faces, hands, instruments — small details over wide shots. The classic shot is one performer, eyes closed, hands on instrument, single coloured light hitting their face.

**Post:** in Lightroom, embrace contrast and saturation; *do NOT try to "fix" the noise* — denoise lightly, but the grain is mood, not damage.`,
    assignmentSeed:
      `Find a low-light scenario — a dimly-lit restaurant, a concert (live or streamed-on-TV reshot for practice), a candlelit room, anything where you need ISO 3200+. Apply the recipe:

1. **f/2.8** on the Sigma
2. **1/200s** shutter floor
3. **Auto-ISO uncapped**
4. **AF-C + Human Recognition**

Shoot 10-15 frames. Cull to ONE keeper that embraces the low-light aesthetic — high contrast, deep shadows, noise as texture not flaw. Edit in Lightroom (contrast + saturation up, light denoise). Submit.

**Rubric:**

- Shot at f/2.8, not stopped down *(core)*
- ISO at least 3200 *(core)*
- Final image embraces low-light aesthetic instead of fighting it *(non-core)*`,
  },
];
