import {
  makeListHandler,
  makeCreateHandler,
  makeUpdateHandler,
  makeDeleteHandler,
} from '@/lib/crud'
import { customerSchema, customerUpdateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const cfg = {
  table: 'customers',
  columns: 'id, name, phone, email, address, created_at',
  createSchema: customerSchema,
  updateSchema: customerUpdateSchema,
  orderBy: 'name',
  label: 'Customer',
}

export const GET = makeListHandler(cfg)
export const POST = makeCreateHandler(cfg)
export const PATCH = makeUpdateHandler(cfg)
export const DELETE = makeDeleteHandler(cfg)
