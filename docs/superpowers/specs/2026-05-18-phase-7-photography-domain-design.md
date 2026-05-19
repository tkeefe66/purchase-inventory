# Design — Phase 7: Photography domain (Outdoor's second-domain successor)

**Date:** 2026-05-18
**Status:** SHIPPED 2026-05-19. This spec is preserved as the original design intent. The actual shipped shape diverged in a few places — see `DECISIONS.md` 2026-05-19 entries for what changed and why (notably: 4-branch tier structure instead of 16 flat tracks, compressed Photo as first-class submission flow not Document/File, 58 topics not "~75").
**Author:** Tom + Claude (brainstorming)

---

## Goal

Add **Photography** as the second domain agent in the inventory platform — a teacher/coach/critic for Tom, a total photography beginner, who recently bought a Sony a6700 + two lenses + an Epson ET-8550 printer. The agent:

- **Teaches** photography fundamentals + the specific gear Tom owns (a6700 menus, Sigma 18-50 quirks, 70-350 use cases, ET-8550 print workflow) + composition + light + Lightroom editing + genre-specific techniques (landscape, dog, wildlife, travel, ski action, etc.).
- **Coaches** via a curated skill-tree of ~75 ordered topics with prereqs. Tom can browse the tree, pick what to learn next, or ask the agent to recommend.
- **Grades** photo submissions against per-assignment rubrics, returning a binary `pass` / `did_not_pass` verdict plus written critique.
- **Grounds in Tom's actual inventory** — the agent knows what camera body, lenses, accessories, and print supplies Tom owns, and tailors every recommendation accordingly.

**Critically, the agent is pull-driven.** No scheduled push, no Sunday nudge, no stale-assignment reminder. Tom asks; the agent responds. This is consistent with the project's "no proactive features in v1" discipline rule.

**Discipline gate:** Phase 6 (web UI) shipped 2026-05-18 and must be in daily use for ≥1 month before Phase 7 build begins. Earliest start: ~2026-06-18. This spec exists to capture the design while it's fresh; the implementation plan is parked until the gate opens.

**Out of scope for v1:**
- Free-form critique outside of an active assignment (assignment-tied only).
- Multi-user (single tenant — Tom).
- Cross-domain features (no "shoot your hiking gear" assignments that bridge Outdoor + Photography).
- Auto-pull photos from Lightroom Cloud / iCloud — Tom must explicitly send a photo to Telegram to submit.
- **ET-8550 remote integration** — printer status, ink levels, automated print jobs. Cloud→home-network bridging is a real side-project (Tailscale tunnel or local polling agent). Deferred to Phase 7.5+. The v1 `printing` curriculum track is ET-8550-specific (paper, ICC, Print Layout walkthroughs) and gives Tom turn-by-turn instructions for printing manually.
- Critique trends / "you've improved at composition" graphs.
- AI-generated reference images for "show me what good looks like."
- Skill-tree editing through the web UI (read-only in v1).

---

## Decisions locked in brainstorming (2026-05-18)

| Question | Answer |
|---|---|
| Delivery vehicle | **Platform replaces the Claude project.** New `domains/photography/` folder mirroring Outdoor's structure. Telegram is the interface. |
| Teaching mode | **Stateful coach with curated curriculum.** Agent recommends what's next based on prereqs + Tom's progress. Tom can pull plans, pick specific topics, or ask "what should I shoot this weekend?" Agent is opinionated. |
| Curriculum source | **Curated skill-tree in code (`skillTree.ts`)**, Claude fills in lesson + assignment + rubric content on the fly using each topic's metadata as a scaffold. |
| Skill-tree visibility | **Browsable.** Tom can see all topics with status; web UI Skills page is the primary browse surface; Telegram `/skills` for in-flow listing. |
| Critique flow | **Assignment-tied only.** Photo submissions outside an active assignment get a polite "no active assignment — `/next` to start one." |
| Grading verdict | **Binary `pass` / `did_not_pass`.** Per-criterion sub-results (pass/partial/fail) feed the binary roll-up but the user-facing verdict is unambiguous. |
| Failed-grade behavior | **Stays active, can retry by resubmitting.** Unlimited retries. `/skip` flips status to `skipped` and unblocks new assignments. |
| Concurrency | **Single active assignment at a time.** Simplifies state machine and the "what am I working on?" UX. |
| Scheduled push | **NONE.** Pull-driven only. No Sunday nudge, no stale-assignment reminder, no Telegram pings initiated by the system. |
| Two interaction modes per topic | **`/learn <topic-id>` (theory, no state change)** vs **`/start <topic-id>` (issues an assignment row)**. Same skill-tree, two delivery paths. |
| Bot routing strategy | **Deterministic, no Claude classifier.** Order: (1) explicit per-message `/photo <msg>` or `/outdoor <msg>` slash override; (2) mode-set commands `/photo` and `/outdoor` set sticky mode; (3) photo-as-Document upload auto-routes to photography; (4) otherwise sticky mode (default: outdoor on first ever message). `/who` returns current mode. |
| EXIF preservation | Photos must be sent **as Document/File** in Telegram to preserve EXIF. Compressed "Photo" sends still get accepted but the bot asks Tom for camera/lens/settings since EXIF is stripped. |
| Grading model | **Opus 4.7 with vision input.** Sonnet 4.6 fallback. (Haiku is too weak for nuanced critique.) |
| Inventory grounding | Same compact-serialization + `cache_control: ephemeral` pattern as Outdoor, filtered to `Domain=Photography AND Status=active`. |
| Web UI v1 scope | **Basic Skills page** at `/photography` — skill-tree status grid + topic detail + assignment history. Read-only. |
| ET-8550 integration | **Curriculum + workflow guide only in v1.** Remote control deferred. |
| Onboarding | **3-question interview** on first photography message → picks Module 1 → issues first assignment. |
| Cron involvement | **None.** Phase 7 adds no new cron tick. The hourly email-ingest cron keeps running and will start landing photography purchases in `Domain=Photography` once the classifier is updated. |

---

## Architecture

### File tree

```
domains/photography/
├── README.md                       # What this domain covers
├── classifier.ts                   # Email-row routing: does this purchase belong to Photography?
├── serialize.ts                    # Compact-row formatter for the agent's system prompt (mirrors outdoor/serialize.ts)
├── inventory.ts                    # Domain-specific query helpers (mostly copies of outdoor/inventory.ts, scoped to Photography)
├── agent.ts                        # System prompt + tool registry
├── skillTree.ts                    # ~75 typed topic objects; the single source of curriculum truth
├── curriculum.ts                   # Runtime: pickNextTopic, checkPrereqs, generatePlan, applyTopicCompletion
├── assignments.ts                  # Sheet I/O for "Photography Assignments" tab
├── grading.ts                      # Vision-grading prompt construction + JSON result parsing
├── exif.ts                         # EXIF reader (exifr) + extraction helpers
└── integrations/
    └── sunTimes.ts                 # Golden / blue hour math (suncalc library, no external API)

apps/bot/
├── router.ts                       # UPDATED — slash override, sticky mode, doc-upload auto-route, /who
├── photographyHandlers.ts          # NEW — /skills /track /next /start /active /skip /learn /plan handlers
└── (existing files unchanged otherwise)

apps/web/                           # (currently lives at repo root /app)
└── app/photography/                # NEW — basic Skills page + topic detail + assignment history
    ├── page.tsx                    # /photography — skill-tree grid
    ├── [topicId]/page.tsx          # /photography/<topic-id> — topic detail (theory text + start-assignment deep link)
    └── assignments/page.tsx        # /photography/assignments — historical assignment list w/ thumbnails

lib/
├── router.ts                       # UPDATED — registers Photography classifier; reclass historical rows
└── (existing unchanged)
```

### Shared infra (re-used from existing platform)

- **Gmail ingest** (`lib/gmail.ts`, `lib/parsers/{rei,amazon}.ts`) — no changes. Existing parsers extract per-item data; the only thing that changes is which domain each item lands in.
- **Sheets I/O** (`lib/sheets.ts`) — no changes. Photography reads/writes through the same `buildHeaderMap` + append-by-header-name path.
- **Inventory cache** (`apps/bot/inventoryCache.ts`) — no changes. Single in-memory snapshot serves both domains; each domain's `serialize.ts` filters to its own scope.
- **Telegram bot** (`apps/bot/index.ts`) — no changes. The bot listener already handles arbitrary messages and photos; only the router and a new handler file are added.
- **Claude wrapper** (`lib/claude.ts`) — no changes. Same prompt-caching + model-fallback pattern.
- **Model catalog** (`lib/models.ts`) — no changes. Same `AGENT_PRIMARY_MODEL` (Opus 4.7) used.
- **Web UI scaffolding** — adds new routes; existing Basic Auth + lib/sheets server-side reads cover Photography too.

### What's new

1. **Domain classifier** (`domains/photography/classifier.ts`) plugged into `lib/router.ts`. Routes camera/lens/printer/paper/Lightroom-subscription/tripod/filter purchases to `Domain=Photography`.
2. **Skill-tree** as a typed code object (~75 topics).
3. **Two new sheet tabs:**
   - `Photography Assignments` — assignment lifecycle rows.
   - `Photography Progress` — one row per topic-id with `status` (locked / available / in-progress / completed / skipped) and timestamps. Cheap to derive from Assignments tab but kept separate so the Skills page renders fast without recomputing.
4. **Bot router rewrite** to support two domains.
5. **Photography agent** (system prompt + tools).
6. **Web UI Skills page** under `/photography`.
7. **One-time backfill script** (`scripts/reclassify-photography.ts`) — walks historical `Domain=Other` rows and re-runs the updated classifier to move photography items into `Domain=Photography`. Dry-run by default.

---

## Curriculum (skill-tree)

### Topic shape

```typescript
type TrackId =
  | 'fundamentals'
  | 'light-composition'
  | 'gear-a6700'
  | 'gear-sigma-1850'
  | 'gear-sony-70350'
  | 'gear-printer'
  | 'genre-landscape'
  | 'genre-dog'
  | 'genre-wildlife'
  | 'genre-travel'
  | 'genre-family'
  | 'genre-action'      // ski + sports
  | 'genre-macro'
  | 'genre-concert'
  | 'lightroom'
  | 'printing';

interface Topic {
  id: string;                  // e.g. 'fundamentals.exposure-triangle'
  track: TrackId;
  name: string;                // 'Exposure Triangle'
  prereqs: string[];           // topic IDs that must be 'completed' (or 'in-progress' for soft prereqs)
  description: string;         // 1-2 sentences shown in /skills and the web UI grid
  theorySeed: string;          // 1-paragraph scaffold Claude expands into the /learn explainer
  assignmentSeed: string;      // 1-paragraph scaffold Claude expands into a concrete assignment + rubric
}
```

### Topic count by track (target)

| Track | Topics | Purpose |
|---|---|---|
| `fundamentals` | ~15 | Exposure triangle, manual mode, aperture priority, shutter priority, ISO behavior, focus modes (single/continuous/AI subject), drive modes (single/burst), WB (auto/preset/custom), metering modes, exposure compensation, histogram reading, RAW vs JPEG, file naming, card management, basic settings hygiene |
| `light-composition` | ~10 | Golden hour, blue hour, hard vs soft light, direction of light, rule of thirds, leading lines, foreground anchors, negative space, framing, subject placement |
| `gear-a6700` | ~5 | Menu structure overview, custom button setup, AF subject recognition modes, IBIS in practice, dynamic range / DRO settings |
| `gear-sigma-1850` | ~3 | Best use cases, f/2.8 constant aperture behavior, reverse focus ring quirk + macro-ish min focus distance |
| `gear-sony-70350` | ~3 | Best use cases (wildlife, compression), slow-lens implications (need light or high ISO), OSS + IBIS together |
| `gear-printer` | ~3 | ET-8550 setup, paper handling (front trays vs rear feed), Epson Print Layout app intro |
| `genre-landscape` | ~5 | Golden-hour planning with weather/trails, foreground composition, depth of field for landscapes, hyperfocal, shooting in CO-specific light |
| `genre-dog` | ~3 | Eye AF on animals, action/burst timing, candids vs portraits |
| `genre-wildlife` | ~3 | Patience + setup, the 70-350 for birds, ethics + distance |
| `genre-travel` | ~3 | Street etiquette, environmental portraits, packing decisions for a trip |
| `genre-family` | ~2 | Available light indoors, group composition |
| `genre-action` | ~3 | Ski/sport panning, shutter speed for motion, predictive AF |
| `genre-macro` | ~2 | Working with the Sigma's close-focus capability, lighting close-ups |
| `genre-concert` | ~2 | Low-light strategies, what's allowed at venues |
| `lightroom` | ~10-12 | Import + library setup, develop module basics, white balance + tone curves, color grading, masking + selective edits, presets, exports + sharpening for output |
| `printing` | ~6-8 | Paper choice, soft proofing, ICC profiles for THIS printer + papers, sharpening for print, finishing prints, the wall-of-prints workflow end-to-end |

**Total: ~75 topics.** Authoring stays tractable because we're not writing full lesson essays — each topic is metadata (id, prereqs, description, `theorySeed`, `assignmentSeed`); Claude generates the prose content on demand.

### Track ordering / prereq philosophy

- `fundamentals` is a hard prereq for everything else. Within `fundamentals`, there's a strict order: exposure triangle → manual mode → focus modes → drive modes → WB → metering → exposure compensation → RAW vs JPEG → histogram.
- `light-composition` and `gear-a6700` open up after `fundamentals.exposure-triangle` + `fundamentals.manual-mode` + `fundamentals.focus-modes`.
- Genre tracks open up after `light-composition` is mostly done — genre topics assume the user knows what golden hour is, what aperture controls, what AF mode to use.
- `lightroom` opens after `fundamentals.raw-vs-jpeg`. Internally, `lightroom` topics are strictly ordered (import before develop before masking before export).
- `printing` opens after `lightroom` is mostly done — there's no point teaching print sharpening if you don't have an exported file yet.

The agent enforces hard prereqs: trying to `/start lightroom.develop-module` without `fundamentals.raw-vs-jpeg` completed gets a polite "you'll get more out of this with RAW basics done first — want to do `fundamentals.raw-vs-jpeg` first, or override?"

### Authoring strategy

- The skill-tree is authored once during the implementation phase, in `domains/photography/skillTree.ts`.
- Each topic's `theorySeed` and `assignmentSeed` are 50-150 words each — enough to anchor Claude's generation without writing the full lesson text.
- We'll author it Claude-assisted: I draft each track's topics in conversation with Tom, he reviews, we commit.
- Total authoring effort: ~2-3 hours of Tom + Claude collaboration once we're building.

---

## Assignment lifecycle

### Sheet tab: `Photography Assignments`

One row per assignment, both active and historical. Columns:

| Col | Header | Notes |
|---|---|---|
| A | `id` | UUID v4, agent-generated |
| B | `date_issued` | ISO timestamp when status became `active` |
| C | `date_submitted` | ISO timestamp on first photo submission |
| D | `date_graded` | ISO timestamp when verdict written |
| E | `topic_id` | e.g. `genre-landscape.foreground-anchors` |
| F | `assignment_text` | Full prose shown in `/active` |
| G | `rubric_json` | JSON array of `{criterion, description, is_core: boolean}` (verbatim from issuance). At least one criterion per rubric MUST be flagged `is_core: true` — see grading rules. |
| H | `status` | `proposed` / `active` / `submitted` / `passed` / `did_not_pass` / `skipped` |
| I | `submitted_photo_telegram_file_id` | Telegram file_id of most recent submission |
| J | `camera` | From EXIF or user-stated |
| K | `lens` | From EXIF or user-stated |
| L | `settings_extracted` | JSON: aperture, shutter, ISO, focal length, GPS, exposure mode |
| M | `ai_verdict` | `pass` / `did_not_pass` (set when graded) |
| N | `ai_critique` | Multi-paragraph written critique (set when graded) |
| O | `per_criterion_json` | JSON array of `{criterion, result: 'pass'|'partial'|'fail', reason}` |
| P | `retry_count` | Increments each time a new photo is submitted on the same row |
| Q | `user_notes` | Tom's caption / context at submission time |
| R | `skipped_reason` | If `status=skipped`, the reason (user override / max-retries / etc.); blank otherwise |

### State machine

```
            /next or /start
proposed ───────────────────► active
                                │
                                │ Tom sends photo
                                ▼
                            submitted
                                │
                                │ grading.ts runs
                                ▼
                          passed | did_not_pass
                          │       │
              archive ◄───┘       │ Tom resubmits → status flips back to `submitted` → re-grade
                                  │              (retry_count++)
                                  │
                                  │ Tom sends /skip
                                  ▼
                              skipped
```

Constraints:
- **At most one row in `active` or `submitted` state at any time.** Enforced by `assignments.ts` (checked before issuing a new one).
- `passed` and `did_not_pass` are terminal-ish — `passed` is fully terminal; `did_not_pass` accepts resubmits.
- `skipped` is terminal. To revisit a skipped topic, Tom issues a fresh `/start <topic-id>` which creates a new row.

### Sheet tab: `Photography Progress`

Cheap denormalized view for the web UI Skills page so it doesn't have to scan all Assignments rows on every render.

| Col | Header | Notes |
|---|---|---|
| A | `topic_id` | e.g. `fundamentals.exposure-triangle` |
| B | `status` | `locked` / `available` / `in-progress` / `completed` / `skipped` |
| C | `last_activity_at` | ISO timestamp |
| D | `assignments_passed` | Integer |
| E | `assignments_failed` | Integer |
| F | `theory_last_read_at` | ISO timestamp of last `/learn <topic-id>` |

Updated by `curriculum.ts` after every state transition.

---

## Photo submission + grading

### Submission flow

1. Tom sends a photo to the bot. **Preferred:** as Document/File (Telegram preserves EXIF). Acceptable: as a regular compressed Photo (EXIF stripped — bot asks for camera/lens/settings).
2. Bot recognizes incoming media:
   - If `Document` with `mime_type: image/jpeg` (or `image/x-sony-arw` for ARW) → photography assignment submission.
   - If compressed Photo → ambiguous. If sticky mode is `photography`, treat as submission with EXIF-missing flag. If sticky mode is `outdoor`, ignore (existing behavior).
3. Bot downloads file via Telegram Bot API `getFile`.
4. **EXIF extraction** via `exifr` library. Extracts: `Make`, `Model`, `LensModel`, `FNumber`, `ExposureTime`, `ISO`, `FocalLength`, `FocalLengthIn35mmFilm`, `ExposureMode`, `WhiteBalance`, `GPSLatitude`, `GPSLongitude`, `DateTimeOriginal`.
5. Bot fetches Tom's active assignment row from `Photography Assignments`.
   - If no active row → reply: *"No active assignment. `/next` to get one, or `/start <topic-id>` to pick a specific topic."* Bail.
6. Bot constructs the grading prompt (see below) and calls Claude Opus 4.7 with vision input.
7. Bot parses the JSON response, updates the row (`status`, `ai_verdict`, `ai_critique`, `per_criterion_json`, `date_graded`).
8. Bot replies via Telegram with: verdict (bold), 2-3 sentence critique, per-criterion breakdown, suggested next action.

### Grading prompt construction

The grading call is a separate, focused Claude invocation — NOT a continuation of Tom's chat conversation. This gives us prompt control and lets us cache the grading rubric structure across all assignments.

```
System (cached):
  You are grading a photo against a specific assignment rubric. Be honest, direct,
  and specific. Cite what you see in the image. Do not soften feedback. Tom wants
  to learn — flattery doesn't help him.

  Output JSON only, matching this schema:
  {
    "verdict": "pass" | "did_not_pass",
    "per_criterion": [
      {"criterion": string, "result": "pass" | "partial" | "fail", "reason": string}
    ],
    "overall_critique": string,
    "suggested_next_step": string
  }

  Verdict rules:
  - All criteria pass OR (n-1 of n criteria pass, where the failing one is NOT core) → verdict: pass
  - Two or more criteria fail OR any criterion marked is_core: true fails → verdict: did_not_pass
  - Each rubric is generated with `is_core: true` on the criteria that capture the assignment's central skill being tested; non-core criteria are "nice to have" technical points

User (per-call):
  ## Assignment
  {assignment_text from sheet row}

  ## Rubric
  {rubric_json from sheet row, formatted as numbered list with each criterion's
   description and whether it's marked core}

  ## Gear Tom used
  Camera: {camera, from EXIF or row}
  Lens: {lens, from EXIF or row}
  Settings: aperture f/{FNumber}, shutter {ExposureTime}, ISO {ISO}, focal length
    {FocalLength}mm ({FocalLengthIn35mmFilm}mm full-frame eq.), mode {ExposureMode}
  GPS: {if present, lookup nearest place via Nominatim and include}
  Time taken: {DateTimeOriginal}

  ## Tom's caption
  {user_notes, if provided}

  ## The photo
  [vision attachment]

  Grade this photo. Be specific — cite what you see. If technical settings hurt
  the result (wrong aperture for the intent, motion blur from too-slow shutter,
  blown highlights), call it out.
```

The rubric is **stored on the row at issuance time** and used verbatim at grading time. This guarantees that even if Tom submits a week later and we've updated the rubric-generation prompt in code, the grade still uses the rubric he saw when he accepted the assignment.

### EXIF gotchas

- **Telegram compresses photos sent as "Photo" type.** EXIF is stripped. Workaround: send as Document. Bot detects which type was sent and prompts for missing info if needed.
- **Sony RAW (.ARW) files** are large (~50 MB on a 26 MP a6700) and unsupported as Claude vision inputs. If Tom sends a raw file, bot replies: *"Send the JPEG export or a Lightroom-export with EXIF preserved. RAW files don't work for vision input."*
- **No EXIF AT ALL** (e.g., screenshot, Photoshop-saved JPEG with metadata stripped): bot prompts *"I couldn't read your camera/lens/settings. Want to tell me what you shot with? Format: 'a6700 / Sigma 18-50 / f/8 / 1/250 / ISO 200 / 35mm'"*
- **EXIF says wrong gear** (e.g., shot with an iPhone): bot calls it out — *"This was shot on an iPhone, not your a6700. The assignment is for the a6700; submit a frame from it."*

---

## Bot routing

Currently `apps/bot/router.ts` always dispatches to the outdoor handler. Phase 7 rewrites it to support two domains.

### Routing precedence (most-deterministic first)

1. **Per-message slash override**: message body starts with `/photo <text>` or `/outdoor <text>` — route just THIS message to that domain. Sticky mode unchanged.
2. **Mode-set command**: message body is exactly `/photo` or `/outdoor` (no body) — set sticky mode to that domain. Reply `"📸 Photography mode."` or `"🏕 Outdoor mode."`.
3. **Photo-as-Document upload**: any photo sent as a Document with image MIME type → auto-route to photography (it's an assignment submission). Sticky mode unchanged.
4. **`/who`**: reply with current sticky mode.
5. **Sticky mode fallback**: route to whichever domain is currently sticky.
6. **First-ever message** (no sticky set): default to outdoor (preserves existing behavior).

Sticky mode persists per chat ID in a small file `local-data/bot-sticky-mode.json` (or Railway volume `/data/bot-sticky-mode.json` in prod) — keyed by `chat_id` so it survives bot restarts.

**Why no Claude-based intent classifier?** Cost + latency + non-determinism. With ~15 commands per domain and clear slash conventions, the deterministic router is faster, cheaper, and easier to debug. Tom can always force the right domain with a one-character prefix.

### Per-domain command sets

Outdoor commands (existing — unchanged):
- `/log`, `/lost`, `/sold`, `/donated`, `/retired`, `/broken`, `/ack-maintenance`, `/refresh`, `/stats`, `/plan-trip`, `/cancel-trip`, `/scan`

New photography commands:
- `/skills` — list all topics with status (paginated, grouped by track)
- `/track <track-id>` — list topics in a specific track
- `/next` — propose the next assignment based on completed prereqs
- `/start <topic-id>` — issue an assignment for a specific topic (with prereq override prompt if needed)
- `/active` — show the current active assignment text + rubric
- `/skip` — skip the active assignment (`status=skipped`)
- `/learn <topic-id>` — deliver theory for a topic without issuing an assignment (no state change)
- `/plan <duration>` — generate a multi-week plan (e.g., `/plan 2 weeks` or `/plan next month`)

Universal commands:
- `/photo`, `/outdoor`, `/who` — mode control
- `/help` — context-aware help (different for each domain mode)

---

## Inventory grounding

Same approach as Outdoor (per `docs/superpowers/specs/2026-05-02-outdoor-agent-inventory-retrieval-design.md`).

- `apps/bot/inventoryCache.ts` is unchanged — same 15-min refresh, content-hash invalidation, atomic snapshot swap.
- New file `domains/photography/serialize.ts` filters the snapshot to `Domain=Photography AND Status=active` and produces a compact view in the same format as `domains/outdoor/serialize.ts`.
- Photography agent's system prompt embeds the compact view with `cache_control: { type: 'ephemeral' }`.
- For a fresh photographer (Tom now), the photography inventory is ~12-18 items: camera body, 2 lenses, printer, 4 lens cases / sleeve, batteries, SD cards, Capture Clip, eventually paper, Lightroom subscription, etc. Token cost is negligible.

**Prerequisite for shipping:** historical photography purchases must be classified in the sheet with `Domain=Photography`. A one-time `scripts/reclassify-photography.ts` walks `Domain=Other` rows, re-classifies through the updated router, and applies changes. Dry-run by default; `--apply` to write.

---

## Web UI extensions

### `/photography` — Skills page

Layout: skill-tree grid grouped by track. Each track is a section with topic cards inside.

```
┌─ Fundamentals ─────────────────────────────────────┐
│  [✓] Exposure Triangle    [▶] Manual Mode          │
│  [○] Focus Modes          [🔒] Drive Modes          │
│  ...                                               │
└────────────────────────────────────────────────────┘

┌─ Light & Composition ──────────────────────────────┐
│  [🔒] Golden Hour         [🔒] Hard vs Soft Light   │
│  ...                                               │
└────────────────────────────────────────────────────┘
```

Status icons: `✓` completed, `▶` in-progress, `○` available, `🔒` locked (prereqs not met), `⊘` skipped.

Each card is clickable → topic detail page.

### `/photography/<topic-id>` — Topic detail

- Topic name + track + prereq status
- Description (from `skillTree.ts`)
- "Read theory" button → renders the `/learn <topic-id>` output server-side (Claude call on page render, cached briefly)
- "Start assignment" button → opens a `tg://` deep link that pre-fills `/start <topic-id>` in Tom's Telegram
- Assignment history for this topic: list of past attempts with verdicts + thumbnails (if any submissions)

### `/photography/assignments` — Assignment history

- Reverse-chrono list of all assignment rows (passed / did_not_pass / skipped)
- Thumbnail of submitted photo (if any)
- Verdict pill, topic name, date
- Click → full row detail with critique text and per-criterion breakdown

All read-only. No editing or deleting from the web UI in v1.

---

## Onboarding

First time Tom sends a photography-mode message AND `Photography Progress` sheet shows zero `completed` topics:

Agent runs a 3-question interview:

1. *"Quick orienting questions. How would you describe your confidence with manual mode today? (none / shaky / decent / strong)"*
2. *"Anything specific you want to start with, or should I pick the most logical first step?"*
3. *"What's a realistic shooting cadence? (every weekend / opportunistic / ramping up / not sure yet)"*

Based on the answers:
- If confidence = `strong` → skip exposure-triangle theory and jump straight to a "shoot manual at f/8 / 1/250 / ISO 200" assignment to verify.
- If confidence = `none` / `shaky` → start with `/learn fundamentals.exposure-triangle` followed by an `/start fundamentals.manual-mode` assignment.
- If Tom named a specific topic → check prereqs; if met, start there; otherwise propose the most-foundational prereq first.

The interview is captured in a single short Telegram exchange (3 messages) — no separate state machine. After the interview, normal flow.

If Tom never does the interview (just sends a photo on day one), the bot replies: *"No active assignment. Hi — want to go through a 3-question intake to get started? Type 'go' or just `/start <topic-id>` if you already know where you want to begin."*

---

## Agent tools

The photography agent's tool registry. Tools marked **(new)** are domain-specific; others are shared.

| Tool | Source | Purpose |
|---|---|---|
| `web_search` (server tool) | Anthropic built-in | Current gear info, current photo blogs, technique demos, paper availability |
| `get_forecast(location, days)` | `domains/outdoor/integrations/weather.ts` | Plan shoots around weather; check golden hour conditions |
| `lookup_trail(name, activity?)` | `domains/outdoor/integrations/trails.ts` | Find shoot locations on hiking trails |
| `search_trails_nearby(lat, lng, radius_km, activity?)` | `domains/outdoor/integrations/trails.ts` | Discover landscape shoot spots near a location |
| **`get_sun_times(lat, lng, date)`** **(new)** | `domains/photography/integrations/sunTimes.ts` | Golden/blue hour, sunrise, sunset, civil twilight. Uses `suncalc` npm library; no external API. |
| **`get_active_assignment()`** **(new)** | `domains/photography/assignments.ts` | Returns the user's currently-active assignment row, or null. |
| **`start_assignment(topic_id, override_prereqs?)`** **(new)** | `domains/photography/assignments.ts` | Creates a new active assignment row. Generates assignment text + rubric from the topic's `assignmentSeed`. Returns the row. Fails if another assignment is active. |
| **`mark_topic_complete(topic_id)`** **(new)** | `domains/photography/curriculum.ts` | Manually flag a topic as completed (used for theory-only topics like `printing.paper-types` where there's no submission, just an acknowledgement). |
| **`list_topics(track?, status?)`** **(new)** | `domains/photography/curriculum.ts` | Returns filtered topic list for `/skills` rendering. |
| **`get_topic_theory(topic_id)`** **(new)** | `domains/photography/curriculum.ts` | Generates and returns the theory explanation for a topic. Used by `/learn`. |

Cross-domain note: photography re-uses `get_forecast` and `lookup_trail` from outdoor's integration layer. This is the first time the codebase crosses the "domains don't import from other domains" rule — to keep architecture clean, we'll **move weather + trails + sun-times to `lib/integrations/`** during Phase 7 implementation. Both outdoor and photography import from there. (Small, clean refactor; mentioned in the implementation plan.)

---

## Acceptance criteria

Phase 7 ships when ALL of these pass:

1. **Classifier + reclassify:** historical photography purchases (camera, lenses, printer, accessories, Lightroom) all appear in the sheet with `Domain=Photography`. `scripts/reclassify-photography.ts --apply` completes cleanly.
2. **Skill-tree complete:** `skillTree.ts` defines all ~75 topics across all tracks. Each topic has a non-empty `theorySeed` and `assignmentSeed`. Prereqs form a valid DAG (no cycles).
3. **Bot routing:**
   - `/photo` sets sticky mode; subsequent messages route to photography.
   - `/outdoor` sets sticky mode back; subsequent messages route to outdoor.
   - `/photo <message>` routes one message without changing sticky mode.
   - `/who` returns current mode.
   - Photo-as-Document upload routes to photography regardless of sticky.
   - Outdoor's existing commands (e.g., `/log`, `/scan`) still work in sticky outdoor mode.
4. **Telegram commands all functional:** `/skills`, `/track`, `/next`, `/start`, `/active`, `/skip`, `/learn`, `/plan`.
5. **Onboarding:** brand-new user (zero completed topics) gets the 3-question intake on first photography message and a first assignment after.
6. **Assignment lifecycle end-to-end:**
   - Issue an assignment via `/next` or `/start`.
   - Submit a photo as Document → bot reads EXIF → grades via Opus 4.7 vision → row updated → Telegram reply with verdict + critique.
   - On `pass`, topic marked completed, `/next` proposes the next topic.
   - On `did_not_pass`, row stays open, resubmit increments `retry_count` and re-grades.
   - `/skip` marks `skipped` and unblocks new assignments.
7. **EXIF handling:**
   - Sent as Document → EXIF read, settings shown in critique.
   - Sent as compressed Photo → bot prompts for camera/lens/settings; grading still works once provided.
   - No EXIF AND no caption → bot asks; doesn't crash.
8. **Inventory grounding:** agent answers a question like *"do I already own a polarizer?"* correctly based on sheet data. `/stats` shows the photography inventory size + cache health.
9. **Web UI Skills page:** `/photography` renders the full tree with correct status icons. Clicking a topic loads `/photography/<topic-id>` with theory + start-assignment deep link. `/photography/assignments` renders historical assignments with thumbnails + verdicts. All behind existing Basic Auth.
10. **5-question acceptance test:** Tom puts the agent through:
    1. *"Explain RAW vs JPEG to me using my a6700 — when should I shoot what?"* → solid theory answer grounded in his gear.
    2. *"Give me a 2-week plan to learn manual mode on landscape shoots."* → coherent plan, sequenced, opens with `fundamentals.manual-mode` or an active prereq, references his Sigma 18-50.
    3. *"What should I shoot this Saturday near Boulder if the weather looks good for golden hour?"* → combines `get_forecast` + `lookup_trail` + `get_sun_times` + inventory knowledge.
    4. *Submits a landscape photo for an active foreground-anchor assignment* → grades honestly, cites what's in the frame, returns valid verdict.
    5. *"What's next?"* → uses progress state to recommend a coherent next step.

All five pass → Phase 7 ships.

---

## Risks + open questions

| Risk | Severity | Mitigation |
|---|---|---|
| Authoring 75 topics is more work than estimated | Medium | Author Claude-assisted, in track-sized batches. Topics are metadata, not essays. |
| Grading rubric quality varies (Claude generates them on the fly) | Medium | Each assignment's rubric is stored on the row at issuance — same rubric at grade time. Add a `/regrade <assignment-id>` command if needed for v1.1 to re-run grading with a hand-edited rubric. |
| EXIF compatibility across editing tools (Lightroom export, Photoshop, etc.) | Low | `exifr` handles standard tags from all mainstream tools. Edge cases (re-saved JPEGs with stripped metadata) fall back to the "tell me your settings" prompt. |
| Telegram file size limits for high-res photos | Low | Telegram caps at 50 MB for documents; a JPEG export from a6700 is ~10-30 MB. Should fit. ARW raws (~50 MB) bump up against the limit — bot rejects ARW anyway. |
| Photography purchases the existing classifier misses | Low | Reclass script catches them at backfill time. Going forward, keyword list tuned to Tom's actual purchases. |
| Cross-domain tool placement (weather/trails) | Low | Refactor weather + trails + sun-times into `lib/integrations/` during Phase 7 build. Small change. |
| Web UI build expanding Phase 7 scope | Medium | Skills page is read-only and uses existing Next.js + Sheets reads — adds ~3 files, ~500 lines. Bounded. |
| User-facing cost of grading calls (Opus 4.7 vision per submission) | Low | Each grading call is ~$0.10-0.20 depending on prompt + image size. Even 10 submissions/week = $5-10/mo. Acceptable. |
| ET-8550 remote integration creep | Low | Explicitly deferred. The `printing` track is workflow-guidance only in v1. |
| Photography is starting Phase 7 in a more-ambitious posture than Outdoor's Phase 2 | Medium | Counterbalanced by: (a) extensive reuse of shared infra; (b) no new cron services; (c) skill-tree is data, not code. But this IS a bigger build than Outdoor's Phase 2 was. Realistic estimate: 3-4 weeks of focused work after the Phase 6 soak gate opens (≥2026-06-18). |

---

## Implementation phasing (preview — actual plan via writing-plans)

Recommended ordering once Phase 7 build begins:

1. **Foundation** (week 1) — bot router rewrite (slash override + sticky mode + /who), classifier + reclassify script, sheet tab creation, `serialize.ts` for inventory grounding.
2. **Skill-tree + curriculum core** (week 1-2) — author `skillTree.ts` Claude-assisted (track by track), implement `curriculum.ts` (pickNext, checkPrereqs, generatePlan), implement `/skills`, `/track`, `/next`, `/learn`.
3. **Assignment lifecycle** (week 2-3) — `assignments.ts` sheet I/O, `/start`, `/active`, `/skip`, the agent's tool wiring.
4. **Photo submission + grading** (week 2-3) — Telegram media handling, `exif.ts`, `grading.ts`, end-to-end submission flow.
5. **Web UI** (week 3-4) — `/photography` Skills page, topic detail page, assignment history page.
6. **Acceptance test pass + iteration** (week 3-4) — 5-question test, fix what doesn't pass.

Total: ~3-4 weeks of focused build. Soak test similar to Phase 1: a couple weeks of real use before declaring v1 done.

---

## What's NOT in this spec (deferred to Phase 7.5+)

- **ET-8550 remote integration** — status queries, ink levels, direct print triggering. Requires cloud↔home-network bridging (Tailscale or local agent). Tom noted: *"push it for later but don't forget."*
- **Free-form photo critique outside assignments** — *"just tell me what's wrong with this photo, no assignment context."*
- **Critique trends / improvement over time** — *"have I gotten better at exposure?"* — graphs and longitudinal analysis.
- **AI-generated reference images** — *"show me what a properly-exposed shot would look like"* — image generation.
- **Cross-domain assignments** — *"shoot your camping gear for an REI listing"* — bridges Outdoor + Photography.
- **Photo auto-pull from Lightroom Cloud / iCloud** — currently requires manual Telegram send.
- **Multi-user** — second photographer's progress + inventory.
- **Editing inventory via the web UI** — adding manual photography rows, marking gear retired without Telegram, etc.
- **Reclassify scheduled** — currently one-shot. Could later run as part of weekly audit.
