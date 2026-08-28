# Toko — Finalized Technical Specification (v2)

Supersedes `DESIGN.md` v1.1. Deltas only where v1.1 stays valid.
Status: PENDING APPROVAL — Stage 1 gate.

## Resolved Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | App auth = `users` table + next-auth (JWT) only. Drop jose/iron-session mention. | One session lib; already implemented in `lib/auth.ts`. |
| D2 | Supabase access model: **anon key = read-only** (direct API calls, free account). **All writes via Next.js API routes using `service_role` key** (server-side only, never in browser). | Free Supabase, no Supabase Auth. `auth.uid()` is NULL for anon → v1.1 RLS policies cannot work. |
| D3 | RLS enabled on **every** table. v1.1 `is_admin()` function removed. | v1.1 left `users` (incl. `password_hash`), `categories`, `suppliers`, `customers` unprotected; `is_admin()` depended on `auth.uid()`. |
| D4 | Add `products.stock_qty bigint NOT NULL DEFAULT 0`, maintained by trigger on `stock_ledger`. Current stock = O(1) read. | v1.1 Query E sums whole ledger per product; slow + race-prone. |
| D5 | `sale_items.unit_cost` = weighted-average cost (v1.1 Query B) snapshotted at sale time, same transaction. | v1.1 left rule undefined. |
| D6 | `sales.total_amount` / `total_cost` maintained by trigger on `sale_items`. | v1.1 denormalized without enforcement. |
| D7 | Role checks (admin/cashier) happen in Next.js API routes: session user → `users.role` via service_role query. Never in RLS. | Follows from D2. |
| D8 | Automation trigger: **manual only**, `./run-automation.sh` after script run. No cron/systemd/n8n schedule. | User decision 2026-08-28. |

## 1. Supabase / RLS (replaces DESIGN.md §1.2)

```sql
-- Enable RLS on ALL tables
alter table users          enable row level security;
alter table categories     enable row level security;
alter table suppliers      enable row level security;
alter table customers      enable row level security;
alter table products       enable row level security;
alter table margins        enable row level security;
alter table purchases      enable row level security;
alter table product_costs  enable row level security;
alter table stock_ledger   enable row level security;
alter table sales          enable row level security;
alter table sale_items     enable row level security;

-- users: NO anon access (contains password_hash). service_role only.
alter table users force row level security;

-- Read-only anon on all business tables.
-- NOTE: PostgreSQL has no ALTER TABLE ... ADD POLICY — use CREATE POLICY.
-- Migration implements this as an idempotent DO block (pg_policies guard)
-- looping the 10 tables:
--   CREATE POLICY anon_read ON public.<t> FOR SELECT TO anon USING (true)
-- Tables: categories, suppliers, customers, products, margins, purchases,
--         product_costs, stock_ledger, sales, sale_items
-- No INSERT/UPDATE/DELETE policies for anon or authenticated anywhere.
-- Writes only via service_role (bypasses RLS) inside Next.js API routes.
```

Drop `is_admin()` function from v1.1.

## 2. Schema deltas (on top of DESIGN.md §1.1)

```sql
alter table products add column stock_qty bigint not null default 0;
create index idx_products_stock on products (stock_qty);
create index idx_ledger_product_time on stock_ledger (product_id, created_at desc);
create index idx_sale_items_product on sale_items (product_id, sale_id);
create index idx_margins_product_from on margins (product_id, effective_from desc);
create index idx_sales_created on sales (created_at desc);
```

## 3. Triggers

```sql
-- T1: stock balance + cached stock, serialized per product
-- Schema uses qty_in/qty_out (DESIGN.md §1.1); net change = qty_in - qty_out.
create or replace function trg_stock_ledger() returns trigger
language plpgsql as $$
declare cur bigint;
begin
  perform pg_advisory_xact_lock(hashtext('stock:' || new.product_id));
  select coalesce(sum(qty_in - qty_out), 0) into cur
    from stock_ledger where product_id = new.product_id;
  new.balance_after := cur + (new.qty_in - new.qty_out);
  update products set stock_qty = new.balance_after where id = new.product_id;
  return new;
end $$;

create trigger stock_ledger_bi before insert on stock_ledger
for each row execute function trg_stock_ledger();

-- T2: sales totals from sale_items
create or replace function trg_sale_items_totals() returns trigger
language plpgsql as $$
begin
  update sales set
    total_amount = coalesce((select sum(quantity * unit_price) from sale_items where sale_id = coalesce(new.sale_id, old.sale_id)), 0),
    total_cost   = coalesce((select sum(quantity * unit_cost)  from sale_items where sale_id = coalesce(new.sale_id, old.sale_id)), 0)
  where id = coalesce(new.sale_id, old.sale_id);
  return coalesce(new, old);
end $$;

create trigger sale_items_ai after insert on sale_items
for each row execute function trg_sale_items_totals();
create trigger sale_items_au after update on sale_items
for each row execute function trg_sale_items_totals();
create trigger sale_items_ad after delete on sale_items
for each row execute function trg_sale_items_totals();
```

## 4. Query fixes (replaces DESIGN.md §1.3 A, D, E)

- **Query A**: fetch margin with effective-date filter:
  `select * from margins where product_id = $1 and effective_from <= now() order by effective_from desc limit 1`
- **Query D** (renamed: ledger history, admin audit): cursor pagination over `stock_ledger` stays as-is — it is history, not current stock.
- **Query E** (current stock): `select id, name, stock_qty from products order by name` — O(1) per product via D4.
- **Query B, C, F**: unchanged.

## 5. Write flow (all mutations)

Vite SPA dashboard and Next.js admin: reads → Supabase anon direct. Writes → `POST /api/...` (Next.js), which:
1. Verifies next-auth session; loads `users.role` via service_role; enforces admin-only ops (UC-K03, master data).
2. Sale atomicity: supabase-js cannot do multi-table transactions over HTTP, so the unit of work lives in SQL — `create_sale()` (plpgsql, SECURITY DEFINER, migration 0002) inserts sales, snapshots weighted-avg unit_cost per item (Query B), inserts sale_items, and inserts the stock_ledger OUT entry — one RPC, one transaction, full rollback incl. insufficient stock. `get_weighted_hpp()` also in 0002.
3. Stock mutation = single `stock_ledger` insert via service_role (T1 does the rest). Admin-only.
4. Master data CRUD via service_role, admin-only. `stock_qty`/`balance_after`/totals never client-writable.

## 6. Team mapping (fixes WORKFLOW_STATE.md roster assumption)

Actual team = 5 agents, not 11. Each teammate runs its Agent → Reviewer → Tester sequence sequentially in one session:

| WORKFLOW_STATE role | Actual agent |
|---|---|
| DB Agent / DB Reviewer / DB Tester | Database Team |
| Backend Agent / Backend Reviewer / Backend Tester | Backend Team |
| Frontend Agent / Frontend Reviewer / Frontend Tester | Frontend Team |
| Summarizer Agent | Summarizer Agent |
| Coordination / spec | The Architect (lead) |

## 7. Open build defect (separate from spec)

`npm run build` fails: `session.strategy` string vs `SessionStrategy` in `app/api/auth/[...nextauth]/route.ts`; `authOptions` imported from wrong path in `app/api/profit-simulation/route.ts` and `app/api/stock-management/route.ts`. Task `01a045da` assigned to Backend Team.
