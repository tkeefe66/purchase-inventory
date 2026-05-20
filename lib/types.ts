/**
 * Centralized type definitions for the platform. Schema source of truth lives
 * in `docs/PLAN.md` (sheet schema table). Changes here must keep PLAN.md in sync.
 */

export const STATUS_VALUES = [
  'active',
  'retired',
  'returned',
  'lost',
  'broken',
  'sold',
  'donated',
  'excluded',
] as const;
export type Status = (typeof STATUS_VALUES)[number];

export const DOMAIN_VALUES = [
  'Outdoor',
  'Photography',
  'Kitchen',
  'Home',
  'Tech',
  'Wardrobe',
  'Auto',
  'Fitness',
  'Health',
  'Media',
  'Other',
] as const;
export type Domain = (typeof DOMAIN_VALUES)[number];

export const ITEM_TYPE_VALUES = ['Gear', 'Consumable', 'Service'] as const;
export type ItemType = (typeof ITEM_TYPE_VALUES)[number];

/**
 * Canonical source values surfaced as quick-select options. Source is no
 * longer a closed enum — /addgear lets the user type a free-text retailer
 * (e.g. "Backcountry", "Patagonia") — but these are the values seeded into
 * dropdowns and used by parsers. 'Image' was removed when the photo-upload
 * flow stopped conflating "where I got the data" with "where I bought it".
 */
export const SOURCE_VALUES = ['REI', 'Amazon', 'Other'] as const;
export type Source = string;

/**
 * How a row got into the sheet. Set once at row creation; never inferred
 * later (except by the one-shot backfill script for existing data).
 *   email  — ingested by the cron from a retailer order/shipment email
 *   photo  — captured via /addgear in Telegram
 *   manual — typed directly into the sheet by the user
 *   import — written by the historical CSV import script
 */
export const ENTRY_METHOD_VALUES = ['email', 'photo', 'manual', 'import'] as const;
export type EntryMethod = (typeof ENTRY_METHOD_VALUES)[number];

/**
 * One row in the `All Purchases` tab. Position-independent — code accesses
 * fields by header name, not column letter.
 */
export interface MasterRow {
  year: string;
  date: string;          // YYYY-MM-DD
  category: string;
  subCategory: string;
  brand: string;
  itemName: string;
  color: string;
  size: string;
  qty: number;
  price: number;
  source: Source;
  orderId: string;
  status: Status;
  domain: Domain;
  productUrl: string;
  type: ItemType;
  reasoning: string;
  /**
   * Free-form notes the admin enters manually. The agent reads this for
   * additional context it can't infer from structured fields ("gift from
   * Sarah", "bought for Iceland trip", "stored at the cabin", etc.).
   * Empty by default; never written by parsers or classifiers.
   */
  notes: string;
  /**
   * Image reference — either the upstream source URL (e.g.
   * `https://m.media-amazon.com/.../foo.jpg`, written by the cron and
   * backfill) or a web-relative local path (`/images/<id>.jpg`, written by
   * the manual-upload API route when a user uploads from the web UI).
   * Empty string when no image has been resolved. The web UI renders this
   * directly as `<img src>`; both forms work for the browser. Bytes are also
   * persisted to `/data/images/<id>.<ext>` on the Railway volume as a hedge
   * against upstream URL rot — see `lib/integrations/resolve-image.ts`.
   */
  image: string;
  /**
   * How this row was created. Email-ingest, /addgear photo-upload, manual
   * sheet edit, or historical CSV import. See {@link EntryMethod}.
   */
  entryMethod: EntryMethod;
}

/**
 * Vocabulary built from existing sheet rows; used to seed the classifier so
 * it prefers the user's existing taxonomy rather than inventing new categories.
 */
export interface Vocab {
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
  brands: string[];
}
