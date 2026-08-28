import {
  makeListHandler,
  makeCreateHandler,
  makeUpdateHandler,
  makeDeleteHandler,
} from '@/lib/crud'
import { productSchema, productUpdateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * stock_qty is exposed on read but is NOT writable through this route: neither
 * productSchema nor productUpdateSchema contains it, so a client-supplied value
 * is stripped by Zod. The column belongs to trigger T1 (spec D4).
 *
 * DELETE is a soft delete (is_active = false) — product_costs, sale_items and
 * stock_ledger all reference products, so a hard delete would break history.
 */
const cfg = {
  table: 'products',
  columns: 'id, sku, name, category_id, unit, stock_qty, min_stock, is_active, created_at',
  createSchema: productSchema,
  updateSchema: productUpdateSchema,
  orderBy: 'name',
  label: 'Product',
  softDelete: true,
}

export const GET = makeListHandler(cfg)
export const POST = makeCreateHandler(cfg)
export const PATCH = makeUpdateHandler(cfg)
export const DELETE = makeDeleteHandler(cfg)
