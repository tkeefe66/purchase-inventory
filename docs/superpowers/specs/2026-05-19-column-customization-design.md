# Column Customization + Detail Panel — Design Spec

**Date:** 2026-05-19
**Status:** Draft, pending user review
**Scope:** Extend the items table on `/` with user-toggleable columns (any of 15 fields), a right side-panel showing all 18 MasterRow fields, and tweak the default column set.

## Background

The Web UI Redesign (2026-05-18) shipped a fixed 6-column items table: Date · Brand · Item · Category · Price · Status. Sub-category was stacked under the Item name. Other MasterRow fields (color, size, qty, source, orderId, type, reasoning, notes) were not surfaced anywhere.

This pass adds:
1. A gear-icon menu in the toolbar to toggle and reorder columns (any field, no protected defaults).
2. A right side-panel that opens when a row is clicked, showing the full record (all 18 fields).
3. A reordered default column set: Date · Category · Item · Brand · Price · Status — promoting Category to position 2 (more useful when scanning) and Brand to position 4 (less front-of-mind than Category).
4. Sub-category moved out from under the Item name; promoted to its own optional column.

Domain-scoped KPIs (server-side filter) and per-header sort affordances shipped separately to main in commit 4a43cff and are not in this scope.

## Goals

1. Let Tom show or hide any column without code changes; persist his choice per device.
2. Give visibility to the long tail of fields (color, size, reasoning, notes, etc.) without crowding the table.
3. Preserve the existing filter / sort / search flows unchanged.
4. Mobile gets a parallel detail surface that feels native (not a desktop side-panel squished onto a phone).

## Non-goals

- Editing fields from the detail panel. Read-only stays read-only.
- Server-synced column preferences (cross-device). LocalStorage per-device is the v1 contract.
- Reordering columns via drag in the table headers themselves. Reordering happens in the gear menu only.
- Sharing column layouts via URL.
- Bulk-row actions (select multiple, export, etc.).

## Decisions (locked during brainstorm)

| Topic | Decision | Why |
|---|---|---|
| Toggle UI | Gear icon in toolbar, right-aligned next to the rows-count | Discoverable, doesn't crowd the chip row, conventional. |
| Toggle behavior | Every column toggleable — no "always shown" group | Tom asked explicitly. No column is protected. |
| Default visible columns | Date · Category · Item · Brand · Price · Status (in that order) | Matches Tom's preferred order during brainstorm. |
| Default-hidden columns | Sub-category, Domain, Year, Color, Size, Qty, Type, Source, Order ID | Useful sometimes; not worth always-on cost. |
| Detail-only fields | Reasoning, Notes | Long text; don't fit table cells, surfaced only in detail panel. |
| Detail panel surface (desktop) | Right side-panel (slides in from right, table stays visible on left) | Linear-issue model. Scan + drill simultaneously. |
| Detail panel surface (mobile) | Bottom-sheet (slides up from bottom, fills screen) | Native iOS feel. Right-panel doesn't work at 375px. |
| Detail trigger | Click anywhere on a row (no separate affordance) | Lower-friction than a dedicated icon. Faint `›` chevron appears on hover to telegraph. |
| Persistence | localStorage, per-device | Personal preference, not part of "this filtered view." No URL pollution. |
| Sub-category | No longer stacked under Item name | Cleaner table. Surfaces in optional column or detail panel. |
| Product URL | Moved from invisible link on item name to explicit "Open product page" button in the detail panel | Currently undiscoverable; the panel makes it a real action. |
| Column reorder | Drag handle in gear menu (`⋮⋮`) reorders columns | One affordance, one place. |

## Architecture

### Routes

Unchanged. `/`, `/spending`, `/needs-review` all the same.

### Component map

**New files:**

| Path | Responsibility |
|---|---|
| `app/components/column-settings.tsx` | Gear icon + dropdown with checkbox list and drag-to-reorder |
| `app/components/detail-panel.tsx` | Right side-panel (desktop) / bottom-sheet (mobile) showing all 18 fields for a selected row |
| `app/lib/columns.ts` | Pure functions: default column config, column definitions (label, accessor, sortable), localStorage read/write |
| `app/lib/hooks/use-column-prefs.ts` | Client hook tying localStorage column prefs to React state |

**Modified files:**

| Path | What changes |
|---|---|
| `app/components/items-table.tsx` | Replace hardcoded column list with dynamic render based on column prefs; emit row-click → opens detail panel; remove sub-category stacked under Item; remove invisible productUrl link on item name |
| (no page changes — the column toggle and panel are entirely inside `<ItemsTable>`) | |

### Data model

A new `ColumnId` type enumerates the toggleable columns:

```ts
export type ColumnId =
  | 'date' | 'category' | 'itemName' | 'brand' | 'price' | 'status'
  | 'subCategory' | 'domain' | 'year' | 'color' | 'size' | 'qty'
  | 'type' | 'source' | 'orderId';
```

(15 entries — the 18 MasterRow fields minus `reasoning`, `notes`, and `productUrl` which are detail-only.)

`ColumnPrefs` is the persisted shape — a single ordered list where each item carries its own visibility flag. This keeps drag-to-reorder uniform regardless of whether a column is shown:

```ts
export interface ColumnPrefs {
  columns: Array<{ id: ColumnId; visible: boolean }>;
}
```

Defaults — every column listed, visibility set per the agreed defaults:

```ts
export const DEFAULT_PREFS: ColumnPrefs = {
  columns: [
    { id: 'date',        visible: true  },
    { id: 'category',    visible: true  },
    { id: 'itemName',    visible: true  },
    { id: 'brand',       visible: true  },
    { id: 'price',       visible: true  },
    { id: 'status',      visible: true  },
    { id: 'subCategory', visible: false },
    { id: 'domain',      visible: false },
    { id: 'year',        visible: false },
    { id: 'color',       visible: false },
    { id: 'size',        visible: false },
    { id: 'qty',         visible: false },
    { id: 'type',        visible: false },
    { id: 'source',      visible: false },
    { id: 'orderId',     visible: false },
  ],
};
```

localStorage key: `inventory.columnPrefs.v1`. Stored as JSON.

### Behavior

**Gear menu:**
- Click gear icon → menu opens beneath, anchored right-aligned to the icon
- Menu shows ALL 15 column options as a single ordered list
- Each row: checkbox (visible toggle) · column label · drag handle (`⋮⋮`)
- Checking flips `visible` for that column; the position in `columns` doesn't change
- Drag handle reorders any column (visible or hidden) within the single list. The order of `columns` IS the table's column order (filtered to `visible: true`)
- "Reset defaults" link at bottom restores `DEFAULT_PREFS`
- "Done" link (or click-outside) closes the menu
- All changes persist to localStorage immediately (no save button)

**Detail panel (desktop, ≥768px):**
- When a row is clicked, layout shifts: table column on left, panel column on right (320px wide, sticky top)
- Panel content:
  - Header: brand (caps eyebrow), item name (17/600), sub-category · category (small meta), `×` close
  - Hero: price (22/700), status pill below
  - "Open product page" button (linked to `productUrl`; hidden if URL is empty)
  - Field groups:
    - **Purchase:** date · year · source · orderId · qty
    - **Domain:** domain · type
    - **Variant:** color · size
  - **Reasoning:** card with `reasoning` field (LLM's classifier note)
  - **Notes:** card with `notes` field (Tom's free-text)
- Panel closes via: `×` click, Escape key, or clicking another row (which immediately swaps content)
- Clicking the currently-selected row again toggles the panel closed

**Detail panel (mobile, <768px):**
- Tapping a card → bottom-sheet slides up from the bottom, covers full screen with a 12-16px top inset showing the dimmed list peek behind
- Same content as desktop panel, optimized for vertical scrolling
- Closes via: `×` close button (top-right of sheet header) or tap on the dimmed peek area. Swipe-down-to-dismiss is a nice-to-have; not v1.

**Row click on desktop:**
- Click anywhere on the row body → opens detail panel for that row
- A faint `›` chevron appears on the right edge of the row on hover (its own fixed-width 40px column appended to the end of every row, after all data columns) to telegraph clickability
- Currently-open row gets `bg-bg-surface-raised` highlight + chevron in `text.secondary` color
- The chevron column is **not** in `ColumnPrefs` and cannot be hidden — it's a UI affordance, not data

**Row click on mobile:**
- Tap card → opens bottom-sheet detail
- The card itself is the whole tap target (cards already render this way)

**Column header changes:**
- Sort indicator (`↕` / `↑` / `↓`) unchanged — header still click-to-sort
- Filter `▾` icon unchanged — appears on hover, opens column-filter menu
- Removing a column via gear menu hides its `<th>` and the corresponding `<td>` in each row
- Adding a column inserts it at the end of `order` (and a new `<th>` + `<td>` per row)

### Edge cases

- **No columns visible:** at least one column must always be visible. The gear menu disables the last checked checkbox so it can't be unchecked. Reset Defaults always available.
- **Mobile + detail panel + filter chip overflow:** when the detail bottom-sheet is open, the filter chip row beneath gets dimmed/inactive — taps go to the sheet, not the chips.
- **localStorage unavailable** (incognito, etc.): fall back to in-memory defaults for the session. Changes don't persist but everything works.
- **localStorage corrupted JSON:** `try/catch` JSON.parse; on failure, fall back to defaults and overwrite the bad value.
- **Schema migration:** the localStorage key includes `.v1` so a future breaking change to `ColumnPrefs` can bump to `.v2` and migrate cleanly.

## Visual system

All tokens reused from the existing redesign (`tailwind.config.ts`). No new colors / radius / shadows needed. The new components match the popover shell and chip patterns already established.

Gear icon: 30×30, 8px radius, `bg.surface`, `border.subtle` 1px, `text.secondary` color, hover `text.primary` + `bg.surface-raised`.

Detail panel: `bg.surface` background, `border.subtle` border, `shadow-card`, 14px radius. Field groups separated by section labels (10/600/0.08em caps, `text.muted`). Each field row: label `text.muted` 12px / value `text.primary` 12px, separator `border.divider`.

## Implementation notes

### Persistence behavior

The `use-column-prefs` hook returns `[prefs, setPrefs]`. On mount, it reads localStorage (with `try/catch`); on change, writes back. The hook is client-only — the items-table is already a client component so this fits cleanly.

Server-side render shows the DEFAULT_PREFS columns (no localStorage on the server). On hydration, the client swaps to the user's saved prefs. Acceptable flash given the read-only nature of the page.

### Column definitions

`app/lib/columns.ts` exports a `COLUMN_DEFS: Record<ColumnId, ColumnDef>` map:

```ts
interface ColumnDef {
  id: ColumnId;
  label: string;            // shown in gear menu + table header
  accessor: (r: MasterRow) => string | number;
  sortable: boolean;        // true for all in v1
  align?: 'left' | 'right'; // 'right' for price/qty
  width?: string;           // optional fixed CSS width; default = auto
  render?: (r: MasterRow) => React.ReactNode; // override for status pill, date format, etc.
}
```

The items-table iterates `prefs.order` and looks up each `ColumnDef` to render the header + cell.

### Detail panel state

State is held in `useTableFilters` or a sibling `useDetailPanel()` hook: `{ openRowKey: string | null, open(key), close() }`. Row key is `${orderId}-${itemName}-${index}` (matches the existing React key in the table).

### Drag-to-reorder

Use HTML5 native drag-and-drop. No new dep. Listeners on each menu row's drag handle. On `dragend`, swap the dragged item to the drop position in `prefs.columns`. React re-renders.

(If HTML5 D&D proves janky on Safari, fallback is `@dnd-kit/core` — small, well-maintained — but try native first.)

### Mobile bottom-sheet

CSS only — no library. `position: fixed; inset: 0; transform: translateY(100%)` then `translateY(0)` with transition on open. Backdrop overlay. Native scroll inside. Swipe-down-to-dismiss is a nice-to-have; not in v1.

## Files affected (summary)

```
NEW:
  app/components/column-settings.tsx
  app/components/detail-panel.tsx
  app/lib/columns.ts
  app/lib/hooks/use-column-prefs.ts
  tests/app/lib/columns.test.ts        (defaults + localStorage round-trip)

MODIFIED:
  app/components/items-table.tsx       (dynamic columns, row click → panel, layout flexes when panel open)
```

No backend changes. No data layer changes. No tailwind config changes.

## Acceptance

Done when:

1. Gear icon visible top-right of items toolbar. Clicking opens a menu showing all 15 columns.
2. Default columns on first load: Date · Category · Item · Brand · Price · Status.
3. Unchecking a column hides it; checking adds it at the end.
4. Drag handles reorder visible columns; changes persist across reloads (localStorage).
5. Reset Defaults restores the default column set + order.
6. Clicking a row opens a right side-panel (≥768px) or bottom-sheet (<768px) showing all 18 fields grouped logically.
7. Detail panel shows an "Open product page" button when `productUrl` exists.
8. Clicking another row swaps the panel content. Clicking the same row twice closes it. Escape / `×` / outside-click closes it.
9. Sub-category no longer appears stacked under Item name in the table.
10. Item name no longer has a hidden link on it (link moved to detail panel button).
11. Filter / sort / search unchanged — they still work as before.
12. Unit tests pass for `columns.ts` (defaults + localStorage round-trip).
13. Production build (`npm run web:build`) succeeds. `npm run typecheck` + `npm run test` green.

## Future / queued (NOT this pass)

- Cross-row drag-reorder in gear menu (drag a hidden column above the visible divider to show + position it).
- Column width customization.
- Cross-device sync of preferences.
- Editable detail panel (write back to sheet).
- Keyboard navigation through rows + detail panel.
