import { z } from 'zod'

/**
 * Zod request schemas. Every mutating route validates its body here before any
 * database call — no raw `body.field` reaches Supabase.
 */

const id = z.coerce.number().int().positive()
const money = z.coerce.number().nonnegative().finite()

// --- sales -----------------------------------------------------------------

export const saleItemSchema = z.object({
  product_id: id,
  quantity: z.coerce.number().int().positive(),
  unit_price: money,
})

export const createSaleSchema = z.object({
  // Optional: server generates one when omitted, so two clients cannot collide
  // on a value picked in the browser.
  invoice_no: z.string().trim().min(1).max(128).optional(),
  customer_id: id.nullable().optional(),
  payment_method: z.enum(['cash', 'transfer', 'qris']).default('cash'),
  items: z.array(saleItemSchema).min(1, 'at least one item is required'),
})

// --- stock -----------------------------------------------------------------

/**
 * Stock mutation = ONE stock_ledger insert (spec §5.2). `balance_after` is
 * absent by design: trigger T1 computes it. Callers cannot supply it.
 */
export const stockMutationSchema = z
  .object({
    product_id: id,
    ref_type: z.enum(['purchase', 'sale', 'adjustment', 'transfer']),
    ref_id: id.nullable().optional(),
    qty_in: z.coerce.number().int().nonnegative().default(0),
    qty_out: z.coerce.number().int().nonnegative().default(0),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.qty_in > 0 || v.qty_out > 0, {
    message: 'either qty_in or qty_out must be greater than zero',
  })
  .refine((v) => !(v.qty_in > 0 && v.qty_out > 0), {
    message: 'qty_in and qty_out are mutually exclusive in a single entry',
  })

/**
 * Absolute stock-count correction. The server reads current stock_qty and
 * derives the delta, so the client never computes a balance.
 */
export const stockAdjustmentSchema = z.object({
  product_id: id,
  target_qty: z.coerce.number().int().nonnegative(),
  note: z.string().trim().max(500).optional(),
})

// --- master data -----------------------------------------------------------

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1000).nullable().optional(),
})

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contact: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
})

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
})

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  category_id: id.nullable().optional(),
  unit: z.string().trim().max(32).default('pcs'),
  min_stock: z.coerce.number().int().nonnegative().default(0),
  is_active: z.boolean().default(true),
})

// stock_qty is deliberately absent — trigger-owned (D4).
export const productUpdateSchema = productSchema.partial()

export const marginBaseSchema = z.object({
  product_id: id,
  pricing_type: z.enum(['percentage', 'fixed']).default('percentage'),
  margin_value: money.default(0),
  sell_price: money.nullable().optional(),
  min_discount: z.coerce.number().min(0).max(100).default(0),
  auto_update: z.boolean().default(true),
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
})

// "fixed" pricing has no margin percentage to compute from, so an explicit
// sell_price is mandatory (spec §3 pricing rules).
export const marginSchema = marginBaseSchema.refine(
  (v) => v.pricing_type !== 'fixed' || v.sell_price != null,
  { message: 'sell_price is required when pricing_type is "fixed"' }
)

export const marginUpdateSchema = marginBaseSchema.partial()

export const categoryUpdateSchema = categorySchema.partial()
export const supplierUpdateSchema = supplierSchema.partial()
export const customerUpdateSchema = customerSchema.partial()

export const idParamSchema = z.object({ id })
