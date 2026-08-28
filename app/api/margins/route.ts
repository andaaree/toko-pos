import {
  makeListHandler,
  makeCreateHandler,
  makeUpdateHandler,
  makeDeleteHandler,
} from '@/lib/crud'
import { marginSchema, marginUpdateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * margins has UNIQUE(product_id, effective_from), so re-posting the same
 * product+date returns 409 from mapDbError rather than silently overwriting a
 * historical price. Use PATCH to change an existing row.
 *
 * effective_from is optional on create: the column defaults to CURRENT_DATE.
 * Ordering is by id, not name — margins has no name column.
 */
const cfg = {
  table: 'margins',
  columns:
    'id, product_id, pricing_type, margin_value, sell_price, min_discount, auto_update, effective_from',
  createSchema: marginSchema,
  updateSchema: marginUpdateSchema,
  orderBy: 'id',
  label: 'Margin',
}

export const GET = makeListHandler(cfg)
export const POST = makeCreateHandler(cfg)
export const PATCH = makeUpdateHandler(cfg)
export const DELETE = makeDeleteHandler(cfg)
