# Outdoor domain

The only domain implemented in v1.

Scope: Tom's broad outdoor companion — knowledgeable across hiking, backpacking, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, and other outdoor activities. Not just a gear advisor.

Files (built progressively across phases — see `docs/PLAN.md`):

- `categories.ts` — sub-categories + classification rules (Phase 1)
- `classifier.ts` — domain-routing + in-domain category assignment (Phase 1)
- `inventory.ts` — query helpers over the sheet (Phase 2)
- `agent.ts` — system prompt + tool registry, Sonnet 4.6 (Phase 2 — broadened in 2.5 with web_search)
- `maintenance.ts` — age/maintenance rule engine (Phase 5.5)
- `integrations/weather.ts` — OpenWeatherMap or NOAA (Phase 3)
- `integrations/trails.ts` — AllTrails MCP or OSM Overpass fallback; covers hiking, MTB, trail running (Phase 4)
- `integrations/freecamping.ts` — Recreation.gov primary (Phase 5)

Architectural rules:
- Can import from `lib/`
- Cannot import from other domains
