import { formatInTimeZone } from 'date-fns-tz';
import type { Classification, ClassifyInput } from './classifier.js';
import type { ParsedItem, ParsedOrder } from './parsers/types.js';
import type { MasterRow } from './types.js';

const TZ = 'America/Denver';

export interface RouteItemInput {
  parsedOrder: ParsedOrder;
  parsedItem: ParsedItem;
  emailDate: Date;
}

export type ClassifyFn = (input: ClassifyInput) => Promise<Classification>;

/**
 * Takes one parsed line item + classifier and produces a fully-populated
 * MasterRow ready to append to the sheet. The classifier (Haiku-backed)
 * fills in Domain, Type, Category, Sub-Category, Brand, and Reasoning.
 *
 * Date Purchased is derived from the email's Date header in Mountain time
 * per DECISIONS.md (#14). New rows always get Status="active".
 */
export async function routeItem(
  input: RouteItemInput,
  classify: ClassifyFn,
): Promise<MasterRow> {
  const { parsedOrder, parsedItem, emailDate } = input;

  const classification = await classify({
    itemName: parsedItem.itemName,
    source: parsedOrder.source,
  });

  const date = formatInTimeZone(emailDate, TZ, 'yyyy-MM-dd');
  const year = formatInTimeZone(emailDate, TZ, 'yyyy');

  return {
    year,
    date,
    category: classification.category,
    subCategory: classification.subCategory,
    brand: classification.brand || (parsedItem.brand ?? ''),
    itemName: parsedItem.itemName,
    color: parsedItem.color ?? '',
    size: parsedItem.size ?? '',
    qty: parsedItem.quantity,
    price: parsedItem.price,
    source: parsedOrder.source,
    orderId: parsedOrder.orderId,
    status: 'active',
    domain: classification.domain,
    productUrl: parsedItem.productUrl,
    type: classification.type,
    reasoning: classification.reasoning,
  };
}
