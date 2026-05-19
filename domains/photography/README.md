# Photography Domain

**Status: shipped 2026-05-19** (Phase 7 of `docs/PLAN.md`).

This domain owns photography learning, gear context, and assignment-based critique for Tom — a beginner with a fresh Sony a6700 + Sigma 18-50 f/2.8 + Sony 70-350 + Epson ET-8550. It's a full curriculum + grading + agent platform, not just a router target.

## Surface

- **Skill tree** (`skillTree.ts` + `tracks/*.ts`) — 58 topics in 4 branches × 4 tiers (`operating-camera`, `seeing`, `editing`, `printing`). Each topic has a name, prereqs, description, theory seed, and assignment seed — the seeds are scaffolds the Claude expander turns into polished lessons + concrete assignments.
- **Curriculum runtime** (`curriculum.ts`) — pure functions: `computeStatuses`, `checkPrereqs`, `pickNextTopic`, `generatePlan`, `applyProgressUpdate`.
- **Expander** (`expander.ts`) — Sonnet 4.6 + OSM trail tools. Generates time-agnostic assignment text + rubrics from the topic's assignment seed. Used by `/start` and `/learn`.
- **Grading** (`grading.ts`) — Opus 4.7 vision call against the rubric stored on the assignment row. JSON verdict + per-criterion + critique. Triggered by photo submission in sticky-photography mode.
- **Photography agent** (`agent.ts` + `tools.ts`) — free-form Q&A. Tools: `get_forecast`, `lookup_trail`, `search_trails_nearby`, `get_sun_times` (new), `get_active_assignment`, `list_topics`, `get_topic_theory`. Server tool: `web_search` (photography-curated allowed-domains list).
- **EXIF** (`exif.ts`) — `exifr` wrapper; tolerant of compressed Photos that have stripped EXIF.
- **Inventory + classifier + serialize** (existing pattern from outdoor) — filters to `Domain=Photography`, formats compact inventory text for agent grounding.

## Bot commands

- `/photo` / `/outdoor` / `/who` — sticky-mode control
- `/skills` — summary across 4 branches
- `/track <branch>` — full topic list for one branch
- `/next` — recommended next topic (in-progress wins, else lowest-tier available)
- `/active` — current open assignment
- `/skip` — mark active assignment skipped
- `/plan <duration>` — generate an N-week plan
- `/learn <topic-id>` — Claude-expanded lesson
- `/start <topic-id>` — create assignment (writes to Photography Assignments tab)

## Submission flow

1. User sends a photo in sticky-photography mode (normal compressed Photo from camera roll — Document/File also accepted)
2. Bot downloads bytes, extracts EXIF (best-effort)
3. Fetches the active assignment row
4. Updates row status=`submitted` BEFORE grading (audit trail)
5. Calls grading: Opus 4.7 vision + rubric + assignment text + caption + gear
6. Parses verdict; updates row status=`passed` or `did_not_pass`
7. Updates Progress tab via `applyProgressUpdate`
8. Replies with formatted verdict + per-criterion + suggested next step

## Web UI

- `/photography` — Skills grid (collapsible branches, status glyphs, KPI strip with active + suggested-next)
- `/photography/[topicId]` — topic detail (prereqs, theory seed, assignment seed, per-topic history, deep-links to Telegram `/learn` / `/start` / `/skip`)
- `/photography/assignments` — reverse-chrono history with status filter

## Spec + design

- `docs/superpowers/specs/2026-05-18-phase-7-photography-domain-design.md` — original design spec
- `DECISIONS.md` 2026-05-19 entries — what changed vs the spec, why, and how to apply
- `docs/PLAN.md` Phase 7 section — implementation summary
