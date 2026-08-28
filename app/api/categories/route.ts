import {
  makeListHandler,
  makeCreateHandler,
  makeUpdateHandler,
  makeDeleteHandler,
} from '@/lib/crud'
import { categorySchema, categoryUpdateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const cfg = {
  table: 'categories',
  columns: 'id, name, description, created_at',
  createSchema: categorySchema,
  updateSchema: categoryUpdateSchema,
  orderBy: 'name',
  label: 'Category',
}

export const GET = makeListHandler(cfg)
export const POST = makeCreateHandler(cfg)
export const PATCH = makeUpdateHandler(cfg)
export const DELETE = makeDeleteHandler(cfg)
