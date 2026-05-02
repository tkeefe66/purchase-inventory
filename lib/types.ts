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

export type Source = 'REI' | 'Amazon';

/**
 * One row in the `All Purchases` tab. 17 columns A–Q.
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
