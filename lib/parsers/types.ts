export interface ParsedItem {
  itemName: string;
  brand?: string;
  color?: string;
  size?: string;
  quantity: number;
  price: number;
  productUrl: string;
}

export interface ParsedOrder {
  source: 'REI' | 'Amazon';
  orderId: string;
  items: ParsedItem[];
}
