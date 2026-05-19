# Column Customization Implementation Plan

> Executes the spec at `docs/superpowers/specs/2026-05-19-column-customization-design.md`. Tasks use checkbox syntax for tracking.

**Goal:** Add a gear-icon column toggle/reorder menu + a right side-panel (mobile bottom-sheet) detail view to the items table.

**Architecture:** Pure frontend. New `ColumnPrefs` type persisted in localStorage. Items-table iterates a dynamic column list instead of hardcoded `<Th>` calls. Detail panel state lives in `ItemsTable` (single `openRowKey: string | null`). No backend, no data-layer, no plugin deps.

**Tech Stack:** Next.js 14, React 18, TypeScript 5, Tailwind, vitest, HTML5 native drag-and-drop.

---

## File structure

| Path | Status | Responsibility |
|---|---|---|
| `app/lib/columns.ts` | new | `ColumnId` / `ColumnPrefs` / `COLUMN_DEFS` / `DEFAULT_PREFS` / localStorage read+write |
| `app/lib/hooks/use-column-prefs.ts` | new | Client hook: localStorage ↔ React state |
| `app/components/column-settings.tsx` | new | Gear button + dropdown (checkboxes + drag-reorder) |
| `app/components/detail-panel.tsx` | new | Right side-panel (desktop) / bottom-sheet (mobile) |
| `app/components/items-table.tsx` | modify | Dynamic columns, row-click → panel, chevron column, drop sub-cat-under-name + invisible URL link |
| `tests/app/lib/columns.test.ts` | new | Defaults + localStorage round-trip + edge cases |

---

## Task 1: `app/lib/columns.ts` + tests

- [ ] Write `tests/app/lib/columns.test.ts` with the failing cases:
  - `DEFAULT_PREFS` has all 15 ColumnIds, 6 visible (in order), 9 hidden
  - `loadColumnPrefs()` returns DEFAULT_PREFS when localStorage is empty / invalid JSON / missing the key
  - `loadColumnPrefs()` returns the saved prefs when present
  - `saveColumnPrefs()` writes JSON to the expected key
  - `loadColumnPrefs()` merges in any new ColumnIds (forward-compat: if storage was saved before a new column was added, the new column appears hidden at the bottom of `columns`)
- [ ] Run vitest, confirm fail
- [ ] Implement `app/lib/columns.ts`:
  - `ColumnId` union type (15 values)
  - `ColumnDef` interface: `{ id, label, sortable, align?, render?, accessor? }`
  - `COLUMN_DEFS: Record<ColumnId, ColumnDef>` — each entry has the column metadata
  - `ColumnPrefs` interface with `columns: Array<{id, visible}>`
  - `DEFAULT_PREFS` constant
  - `loadColumnPrefs(): ColumnPrefs` — reads `inventory.columnPrefs.v1`, validates, merges new IDs, falls back to defaults on error
  - `saveColumnPrefs(prefs: ColumnPrefs): void` — writes JSON
  - `STORAGE_KEY = 'inventory.columnPrefs.v1'` exported for tests
- [ ] Run vitest, confirm pass
- [ ] Commit: `feat(web): column defs + prefs persistence (localStorage)`

## Task 2: `app/lib/hooks/use-column-prefs.ts`

- [ ] Create the hook:
  - Client-only (`'use client'`)
  - On mount: read from localStorage, set state
  - Returns `[prefs, setPrefs]` where `setPrefs` writes to both state and localStorage
  - Handles SSR: initial state is `DEFAULT_PREFS` (server render); useEffect hydrates from localStorage
- [ ] Commit: `feat(web): useColumnPrefs hook`

## Task 3: `app/components/column-settings.tsx`

- [ ] Create the component:
  - Gear button (30×30, rounded, lives in the toolbar at the right end)
  - Click toggles a dropdown menu, anchored right-aligned beneath
  - Menu lists all 15 columns from `prefs.columns` in order:
    - Each row: checkbox (`visible`), label (from `COLUMN_DEFS[id].label`), drag handle (`⋮⋮`)
    - Checkbox of the last-visible column is disabled (prevents zero columns)
  - Drag handle: HTML5 native `draggable`. On `dragstart` mark source; on `dragover` indicate drop target; on `drop` reorder `prefs.columns`.
  - Bottom: "Reset defaults" link (left), "Done" link (right). Click-outside also closes.
- [ ] Visual smoke check (build + load page mentally — no test framework for React UI)
- [ ] Commit: `feat(web): ColumnSettings (gear menu + reorder)`

## Task 4: `app/components/detail-panel.tsx`

- [ ] Create the component, accepting `row: MasterRow | null` and `onClose: () => void`:
  - Renders `null` when `row` is null
  - Desktop (≥768px): fixed-width column on the right of the table (handled by parent layout)
  - Mobile (<768px): fixed bottom-sheet with backdrop + 12-16px top inset
  - Content (both):
    - Header: brand (eyebrow), itemName (17/600), sub-cat · category (meta), `×` close
    - Hero: price (22/700), status pill
    - "Open product page" button (link to productUrl; hidden if empty)
    - Field groups: Purchase (date, year, source, orderId, qty) · Domain (domain, type) · Variant (color, size)
    - Reasoning card + Notes card at bottom
  - Escape key closes
- [ ] Commit: `feat(web): DetailPanel component`

## Task 5: `app/components/items-table.tsx` refactor

- [ ] Modify to consume `useColumnPrefs`:
  - Import `useColumnPrefs`, `COLUMN_DEFS`
  - Compute `visibleColumns = prefs.columns.filter(c => c.visible).map(c => c.id)`
  - Replace hardcoded `<Th>` list with `.map()` over `visibleColumns`
  - Render cells dynamically via `COLUMN_DEFS[id].render(row)` or fallback to `accessor(row)`
  - Remove sub-cat-stacked-under-itemName
  - Remove invisible `<a>` link on itemName (URL now lives in the panel button)
  - Append a fixed 40px chevron column at the end (not in ColumnPrefs)
  - Make row `<tr>` clickable: opens panel via `setOpenRowKey`
  - Add `<ColumnSettings />` in the toolbar right side, before the rows-count
  - Wrap the table + panel in a flex layout when panel is open (table flex-1, panel 320px on desktop)
  - On mobile: panel renders as the bottom-sheet (positioned: fixed, full screen on small viewports)
- [ ] Verify typecheck + build
- [ ] Commit: `feat(web): items-table consumes column prefs + opens detail panel on row click`

## Task 6: Verification pass

- [ ] `npm run typecheck` — clean
- [ ] `npm test` — all green (including new columns tests)
- [ ] `npm run web:build` — succeeds
- [ ] Dev-server visual: open `http://localhost:3000`, verify
  - Gear menu toggles + reorders + persists across refresh
  - Row click opens panel; click another row swaps it; `×` closes
  - Mobile (375px): bottom-sheet works
- [ ] Commit any small visual fixes
- [ ] Done — ready to merge to main

---

## Notes

- This branch (`web-columns`) was created from main at commit `4a43cff`, which is the merged + pushed web-ui-redesign baseline.
- Total: ~6 tasks, ~5 commits, all on the `web-columns` branch.
- No new npm deps unless drag-and-drop on Safari forces `@dnd-kit/core` (decision after Task 3 visual smoke).
