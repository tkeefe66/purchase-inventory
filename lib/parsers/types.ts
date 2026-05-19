export interface ParsedItem {
  itemName: string;
  brand?: string;
  color?: string;
  size?: string;
  quantity: number;
  price: number;
  productUrl: string;
  /**
   * Product image URL extracted from the source email HTML. Undefined when
   * the parser couldn't find one; the cron's `resolveImage` then falls back
   * to AI lookup.
   */
  imageUrl?: string;
}

export interface ParsedOrder {
  source: 'REI' | 'Amazon';
  orderId: string;
  items: ParsedItem[];
}
