# Web UI Redesign — Design Spec

**Date:** 2026-05-18
**Status:** Draft, pending user review
**Scope:** Visual refresh + per-column filtering for the Next.js web dashboard. No editing surface in this pass. No agent chat in this pass (slot reserved in sidebar).

## Background

The current web UI (`/app`, deployed to `web-production-93cbd.up.railway.app`) is functional but generic — default Tailwind dark dashboard look with top horizontal nav, four filter dropdowns, and a single dense table. Tom's reaction: "looks awful... feels meh." After brainstorming, the agreed direction is **Gong-energy dark**: purple-tinted dark base, purple→pink gradient accents, rounded surfaces, KPI strip, layered cards, color-confident status pills. Domain-agnostic (not outdoor-themed) since the platform is multi-domain.

The redesign also introduces a sidebar navigation that scales to N domains + cross-cutting pages + a future agent chat surface, and replaces the four hardcoded filter dropdowns with header-dropdown filters on every column.

## Goals

1. Replace the generic "AI dashboard" feel with an aesthetic that has a point of view — warm, alive, modern, welcoming.
2. Introduce a sidebar that handles multiple domains (Outdoor today, Kitchen / Photography / etc. later) and reserves space for an agent chat surface in a future phase.
3. Make every column filterable, with smart filters for Date (natural-language) and Price (range).
4. Carry the same design system to mobile so the phone experience is native-feeling, not a shrunken desktop.

## Non-goals (out of scope this pass)

- Item editing of any kind (status changes, inline edit, manual-item creation, photo upload).
- Agent chat surface — sidebar reserves the slot, no implementation.
- Bigger rethink of /spending and /needs-review beyond re-skinning. Queued for a follow-up.
- New backend or data layer changes. Read-only stays read-only.

## Decisions (locked during brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Aesthetic | Gong-energy dark | Modern AND welcoming. Tom rejected the standard Linear/Vercel/cream-paper playbook. Gong's signature warmth (purple→pink gradients, rounded surfaces, layered cards, color confidence) lands on both axes. |
| Navigation | Sidebar with Domains / Everything / Agent groups | Scales to N domains. Persistent home for the future agent surface. Linear/Notion pattern. |
| Home page (/) | Land on the items page (cross-domain table) | No separate dashboard. /items is where Tom wants to be most of the time. |
| Filter pattern | Per-column header dropdown + mirrored chip toolbar | Spatial — filter lives on its column. Chips above also show what's active, for visibility. |
| Date filter | Natural-language input (chrono-node) + preset chips | Most flexible, fastest for power use ("2024", "may 2025", "last 90 days"). |
| Price filter | Range input + operator + presets | "Under $50", "Between $50–$200", "Over $500", or `≥ $X`. |
| Mobile | Hamburger drawer + card list (no redundant active label) | Drawer scales to unlimited sidebar items. Cards more browsable than dense rows on phone. |
| Density | Comfortable (~52px rows) | Item-name stacked over sub-category. Easier to scan. |
| Color accent | Purple→pink gradient (`#a78bfa → #f472b6`) | Used as Gong does — on the brand mark, active states, focused dots, primary CTAs. Always as a gradient, never a flat hue. |
| Other pages | Re-skinned only; bigger rethink later | Spending + Needs review get the new shell and palette; structural redesign queued. |

## Architecture

### Routes

| Route | Purpose | Changes |
|---|---|---|
| `/` | Cross-domain items table (today's home, restyled) | KPI strip added on top; sidebar; header-dropdown filters on every column; URL-backed filter state |
| `/spending` | 4 charts + KPI strip | Restyled to new palette only |
| `/needs-review` | Parse-failure table | Restyled to new palette only |

Active domain is sourced from the URL `?domain=outdoor` query param (authoritative when present). localStorage holds the last-used domain as a fallback default for direct visits to `/` with no query string. Sidebar reads from the resolved value to highlight the active domain row; pages read it to scope their data. `All items` link sets `?domain=` empty and clears the scope.

### Layout shell

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  small crumb (active domain)                     │
│ sidebar  │  H1 "Items"          ╭───────────────────╮       │
│  170px   │  meta line           │   atmospheric blob │       │
│          │                      │   (top-right)      │       │
│  Domains │  ┌──┐ ┌──┐ ┌──┐      ╰───────────────────╯       │
│  • out   │  │KPI│ │KPI│ │KPI│                                 │
│    kit   │  └──┘ └──┘ └──┘                                    │
│    pho   │                                                    │
│          │  search · chip · chip · +Filter        N of M     │
│  Every-  │  ╭─────────────────────────────────────╮         │
│  thing   │  │ Date  Brand  Item   Cat   Price …   │         │
│  • all   │  │ ─────────────────────────────────── │         │
│    spd   │  │ row                                  │         │
│    rev³  │  │ row                                  │         │
│          │  │ row                                  │         │
│  Agent   │  ╰─────────────────────────────────────╯         │
│   chat°  │                                                    │
└──────────┴──────────────────────────────────────────────────┘
```

Mobile (≤640px): sidebar becomes a slide-in drawer triggered by a hamburger icon top-left. Main content gets the full viewport width. KPI strip becomes a horizontal scroll-snap row. Table becomes a vertical card list.

## Visual system

All values defined as Tailwind tokens in `tailwind.config.ts` under `theme.extend.colors`.

### Surfaces

| Token | Value | Used for |
|---|---|---|
| `bg.base` | `#0f0d1a` | Page background |
| `bg.sidebar` | `#16142a` | Sidebar background |
| `bg.surface` | `#16142a` | Card backgrounds (KPI, table card) |
| `bg.surface-raised` | `#1a1730` | Table column-header row |
| `border.subtle` | `#211e3a` | Card borders |
| `border.divider` | `#1c1a30` | Row dividers inside cards |

### Text

| Token | Value | Used for |
|---|---|---|
| `text.primary` | `#fafafa` | H1, item names |
| `text.body` | `#e2e0eb` | Body copy |
| `text.secondary` | `#a09cb8` | Meta, dates, secondary labels |
| `text.muted` | `#6b6786` | Section headings, placeholders, count text |

### Accent (gradient — never a flat color)

| Token | Value | Used for |
|---|---|---|
| `accent.from` | `#a78bfa` | Gradient start |
| `accent.to` | `#f472b6` | Gradient end |
| `accent.glow` | `#a78bfa80` (50% alpha) | Box-shadow halo on active states |

Apply as `bg-gradient-to-br from-accent-from to-accent-to` for fills; for glows use `shadow-[0_0_8px_var(--accent-glow)]` or a Tailwind plugin token.

The atmospheric blob behind the page H1 uses the same gradient at `opacity: 0.18`, `blur(40px)`, 280px circle, positioned `top:-80px right:-80px` in the main content area.

### Status colors

Used in the Status column pill. Active items are the default-filtered state, so the active pill is muted-by-default on rows. Other statuses pop.

| Status | Text color | Background | Notes |
|---|---|---|---|
| active | `#86efac` | `#14301f` | Default; shown desktop, hidden on mobile cards |
| broken | `#fca5a5` | `#3f1414` | High-contrast — meant to draw the eye |
| retired | `#a1a1aa` | `#1f1f22` | Muted — Tom-owned but not in rotation |
| returned | `#fcd34d` | `#3f2e0e` | Warm amber |
| sold | `#a5b4fc` | `#1e1b4b` | Soft indigo |
| donated | `#c4b5fd` | `#241942` | Soft violet |
| lost | `#fca5a5` | `#3f1414` | Same as broken |
| excluded | `#71717a` | `#18181b` | Lowest contrast |

### Type

- **Font:** Inter (variable). Self-host via `next/font/google` so we control loading. System sans fallback chain unchanged in `globals.css`.
- **Scale:** 26 / 700 / -0.02em (H1) · 17 / 700 / -0.025em (brand) · 14 / 600 (section H2) · 13 / 500 (item names) · 13 / 400 (body) · 12 / 400 (meta) · 11 / 500 (chips) · 10 / 600 / 0.1em uppercase (caps labels) · 10 / 600 (KPI labels).
- All numbers (prices, counts, deltas) use `font-variant-numeric: tabular-nums`.

### Spacing, radius, shadow

- Page gutter: 28px desktop · 16px mobile
- Card padding: 14px inside KPI cards · 18px inside table column-header row · 13px inside table rows · 6×11 inside chips · 3×9 inside row status pills
- Row height: 56px desktop (comfortable density)
- Radius: shell 14px · table card 13px · KPI 11px · chips 9px · inputs 10px · row pills 7px. **No sharp corners anywhere.**
- Shadow: KPI / table cards get `0 1px 3px rgba(17,12,46,0.06)`. Active filter chip gets `0 0 12px #a78bfa20` outer glow. Filter-menu popovers get `0 12px 32px rgba(0,0,0,0.5)`.

## Items page — components

### KPI strip (new)

Three small cards in a horizontal row above the toolbar. Live data from the current items dataset.

| Card | Value | Delta |
|---|---|---|
| Active spend | sum of `price` where `status='active'` for current domain scope | `↑/↓ $X this month` (vs same month last year if available, else vs previous month) |
| Items YTD | count where `date.year = current year` and `status != 'excluded'` | `↑/↓ N vs '25` (vs prior year same period) |
| Needs review | count from `getNeedsReviewRows()` where `!resolved`, clickable → `/needs-review` | none |

Cards use `bg.surface`, 11px radius, 12-14px padding, soft shadow. Label is uppercase 10/600/0.08em in `text.muted`. Value is 20/700/-0.015em in `text.primary`. Delta is 10px, `#4ade80` for up / `#f87171` for down.

On mobile, KPI cards become a horizontal scroll-snap row (overflow-x: auto, no scrollbar).

### Toolbar

`search input` · `active filter chips` · `+ Filter` dashed-add chip · right-aligned `N of M` count

- Search input: 9x14 padding, 10px radius, `bg.surface` background, `border.subtle` 1px, placeholder in `text.muted`.
- Active filter chip: gradient `from #2a1e4a to #3d1d3a`, `#a78bfa40` border, `0 0 12px #a78bfa20` glow, `#e9d5ff` text, 6x11 padding, 9px radius, includes `× ` to remove.
- Add-filter chip: transparent bg, dashed `#3a3550` border, `text.muted` text. Click opens a column picker → operator → value.
- Right meta: `text.muted`, 11px, tabular-nums.

### Table

Single table card. Page scrolls; the table's column-header row is `position: sticky; top: 0` within the card so headers stay visible during scroll.

**Columns (desktop, in order):** Date · Brand · Item (name + sub-category meta) · Category · Price (right-aligned) · Status

**Columns (mobile cards):** Brand (caps meta) · Price (top-right) · Item name (bold) · Sub-category + Date + (non-active status badge if applicable)

**Row interactions:**
- Hover: `bg.surface-raised` overlay
- Click on the item name: opens `productUrl` in a new tab (existing behavior)
- Click on a column header: triggers sort (existing behavior)
- Hover on a column header reveals a `▾` icon; clicking the icon opens the column-filter menu

**Status pill:** color-coded by status. On desktop, all rows show their pill. On mobile cards, the pill is hidden when `status === 'active'` (assumed default), shown for any other status.

### Per-column filter menus

A popover anchored beneath the clicked column header. Width 260px (260px for Date which has more content). `bg.surface` with `border.subtle`, 8px radius, `0 12px 32px rgba(0,0,0,0.5)` shadow. Closes on outside click or `Esc`.

| Column type | Menu contents |
|---|---|
| Text (Brand, Item, Category, Sub-cat, Notes) | Search input · checkboxes for unique values from data (multi-select) · Clear filter link |
| Enum (Status, Domain, Type) | Checkboxes for known values · Clear filter link |
| Year | Pill row of years from data · Clear |
| Date | Natural-language input ("2024", "may 2025", "last 90 days", "between mar 1 and apr 30") · "Or pick" preset row (Last 90d, YTD, 2025, 2024, 2023) · footer shows resolved range + match count · Clear |
| Price | Operator dropdown (≥, ≤, between) · min / max number inputs · preset chips (Under $50, $50–$200, $200–$500, Over $500) · Clear |

Active filters get a small gradient dot beside the column header name AND mirror as a removable chip in the toolbar.

### Sidebar

170px wide on desktop. Sections:

```
Inventory[gradient mark]

DOMAINS
• Outdoor       247
  Kitchen        —
  Photography    —

EVERYTHING
  All items     247
  Spending
  Needs review   3   (amber badge)

AGENT
  Chat          soon  (greyed)

tkeefe66 · v1.4
```

- Brand mark: 22x22 rounded square with the accent gradient + glow shadow
- Section header: 10/600/0.12em uppercase, `text.muted`
- Link: 8x10 padding, 9px radius, 13px font, `text.secondary`
- Active link: linear gradient `from #2a1e4a to #3d1d3a`, `text.primary`, font-weight 600
- Active link dot: 7x7 gradient circle with glow
- Count: right-aligned, tabular-nums, `text.muted`
- Badge (Needs review > 0): amber pill (`#3f2e0e` bg, `#fbbf24` text), 10/600
- Chat link is greyed with "soon" suffix and not clickable

## Mobile adaptation

- Hamburger top-left opens sidebar as a full-height slide-in drawer over a dimmed backdrop. Tap backdrop or swipe left to close.
- Page H1 + meta stack as usual; KPI strip becomes a horizontal scroll-snap row (`overflow-x: auto`, `scroll-snap-type: x mandatory`, hidden scrollbar). At 375px width, the third card is partially visible to signal more content.
- Toolbar chips wrap to multiple lines as needed
- Items render as a vertical card list. Each card: `bg.surface`, 11px radius, 13-14px padding, 8px gap between cards.
  - Top row: brand (caps 10/600/0.1em muted) · price (14/700 primary, tabular-nums)
  - Item name: 14/500 primary, 3-5px margin
  - Bottom row: sub-category · date · non-active status badge (if any)
- Tap card → open product URL in new tab (same as desktop item-name click)
- Filter menus open as bottom sheets (full width, swipe down to dismiss)

## Behavior — URL-backed filter state

The single behavior change beyond visual refresh: filter state moves from component-local `useState` to URL search params via Next.js `useSearchParams`.

**Why:** sharing/bookmarking filtered views, browser back/forward navigation, persistence across reloads.

**Schema:**
- `?domain=outdoor` (or omitted for All)
- `?q=patagonia` (search)
- `?status=active,retired` (multi-value comma-separated)
- `?date=last-90-days` or `?date=2024` or `?date=2024-05` or `?date=range:2024-03-01:2024-04-30`
- `?price=gte:100` or `?price=lte:50` or `?price=range:50:200`
- Other column filters: `?brand=Patagonia,Arc%27teryx`, etc.

A helper module (`app/lib/filters.ts`) parses and serializes this state. ItemsTable becomes a thin shell; filter-state lives in a `useTableFilters()` hook that reads/writes URL params.

## Implementation

### New dependencies

- `chrono-node` (~30 kB gz) — natural-language date parser for the Date filter

That's it. Tailwind already handles gradients, shadows, radius, dark mode. Recharts already installed for /spending.

### Tailwind config changes

Extend `theme.colors` with the tokens from the Visual System section (`bg.base`, `text.primary`, `accent.from`, etc.). Add a custom `boxShadow` for the gradient glow. Add `backgroundImage` named `accent-gradient`.

### Component refactor

| Component | Action |
|---|---|
| `app/layout.tsx` | Replace top nav with sidebar shell. Add Inter font via `next/font/google`. |
| `app/page.tsx` | Add KPI strip + items table. |
| `app/components/items-table.tsx` | Major refactor — extract filter state into hook, swap 4 dropdowns for header-dropdown menus, add chip toolbar. |
| `app/components/spending-charts.tsx` | Restyle to new palette. Same chart types. |
| `app/components/needs-review-table.tsx` | Restyle to new palette. Same structure. |
| `app/globals.css` | Add Inter import + CSS vars for theme tokens used outside Tailwind. |
| **NEW** `app/components/sidebar.tsx` | Sidebar + mobile drawer. |
| **NEW** `app/components/kpi-card.tsx` | The 3 metric cards. |
| **NEW** `app/components/filter-chip.tsx` | Toolbar chip (active + add variant). |
| **NEW** `app/components/column-filter-menu.tsx` | Generic popover; sub-components per type (`text`, `enum`, `date`, `price`, `year`). |
| **NEW** `app/components/status-pill.tsx` | Color-coded status pill. |
| **NEW** `app/lib/filters.ts` | URL filter-state parser + serializer. |
| **NEW** `app/lib/hooks/use-table-filters.ts` | Hook tying URL state to filtered rows. |
| **NEW** `app/lib/kpi.ts` | KPI computations (active spend + delta, items YTD + YoY, needs-review count). |

No backend file is touched. `app/lib/data.ts` is unchanged.

### File-level wiring

- `layout.tsx` renders `<Sidebar>` (which internally renders hamburger + drawer on mobile via media query) and `<main>{children}</main>`
- `page.tsx`, `spending/page.tsx`, `needs-review/page.tsx` each render their own header (crumb + H1 + meta + KPI strip) then their main content
- `items-table.tsx` becomes mostly markup; logic lives in `use-table-filters.ts`

### Testing

- Existing tests are mostly parser/data-layer; no UI tests today.
- Add unit tests for `app/lib/filters.ts` (URL ↔ state round-trip) and `app/lib/kpi.ts` (delta math, YoY edge cases).
- No need for visual regression tests in this pass.

## Acceptance

Done when:

1. Visiting `/` shows the new sidebar + KPI strip + items table with header-dropdown filters, in the Gong-energy dark palette.
2. Every column has a working filter menu (text, date NL, price range).
3. Filter state lives in the URL — refreshing preserves filters, back-button rolls them back.
4. Mobile (375px width) shows the hamburger drawer + horizontal-scroll KPIs + card list.
5. /spending and /needs-review render correctly in the new shell and palette (no structural changes).
6. Lighthouse mobile score ≥ 90 for performance and accessibility.
7. No regressions in existing tests (`npm run typecheck` + `npm run test` both green).

## Future / queued (NOT this pass)

- Bigger redesign of /spending (today's 4 charts stay — but a future pass adds spend-by-domain, spend-by-category drill, year-over-year comparisons).
- Bigger redesign of /needs-review (quick-resolve actions, batch operations).
- Inventory edit actions (status change, inline edit, manual item, photo upload).
- Agent chat surface (sidebar slot exists, implementation deferred).
- Density toggle (Tight vs. Comfortable) in sidebar — easy add later, intentionally omitted from v1 to keep scope tight.
- Saved views / shareable filter URLs as named bookmarks.
- Dark/light mode toggle — v1 ships dark only; light Gong-direct mode could be added later as a sibling palette.
