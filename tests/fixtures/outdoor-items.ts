import type { MasterRow } from '../../lib/types.js';

export const FIXTURE_THERMAREST: MasterRow = {
  year: '2026',
  date: '2026-04-28',
  category: 'Camping Gear',
  subCategory: 'Sleep System',
  brand: 'Therm-a-Rest',
  itemName: 'Z Lite Sol Sleeping Pad',
  color: 'Limon',
  size: 'Reg',
  qty: 1,
  price: 49.95,
  source: 'Amazon',
  orderId: '113-8158227-8962610',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://example.com/thermarest',
  type: 'Gear',
  reasoning: 'Sleeping pad for backpacking',
  notes: '',
};

export const FIXTURE_SALOMON: MasterRow = {
  year: '2026',
  date: '2026-04-29',
  category: 'Hiking Gear',
  subCategory: 'Footwear',
  brand: 'Salomon',
  itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots',
  color: 'Black/Asphalt/Castlerock',
  size: '9',
  qty: 1,
  price: 190,
  source: 'REI',
  orderId: '',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://www.rei.com/search?q=salomon',
  type: 'Gear',
  reasoning: '',
  notes: '',
};

export const FIXTURE_NO_BRAND: MasterRow = {
  year: '2026',
  date: '2026-04-30',
  category: 'Camping Gear',
  subCategory: 'Camp Accessories',
  brand: '',
  itemName: '12 Pack Tent Stake with Hammer',
  color: '',
  size: '',
  qty: 1,
  price: 19.99,
  source: 'Amazon',
  orderId: '113-2080859-2183404',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://example.com/stakes',
  type: 'Gear',
  reasoning: '',
  notes: '',
};

export const FIXTURE_RETIRED: MasterRow = {
  ...FIXTURE_THERMAREST,
  itemName: 'Old Backpack',
  status: 'retired',
  orderId: 'OLD-001',
};

export const FIXTURE_PHOTO: MasterRow = {
  ...FIXTURE_THERMAREST,
  category: 'Camera Lenses',
  subCategory: '',
  brand: 'Sigma',
  itemName: 'SIGMA 18-50mm F2.8',
  color: '',
  size: '',
  domain: 'Photography',
  orderId: 'PHOTO-001',
};

export const FIXTURE_ALL: MasterRow[] = [
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
  FIXTURE_RETIRED,
  FIXTURE_PHOTO,
];
