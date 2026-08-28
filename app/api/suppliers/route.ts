import {
  makeListHandler,
  makeCreateHandler,
  makeUpdateHandler,
  makeDeleteHandler,
} from '@/lib/crud'
import { supplierSchema, supplierUpdateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const cfg = {
  table: 'suppliers',
  columns: 'id, name, contact, phone, email, address, created_at',
  createSchema: supplierSchema,
  updateSchema: supplierUpdateSchema,
  orderBy: 'name',
  label: 'Supplier',
}

export const GET = makeListHandler(cfg)
export const POST = makeCreateHandler(cfg)
export const PATCH = makeUpdateHandler(cfg)
export const DELETE = makeDeleteHandler(cfg)
