-- Toko Initial Migration
-- Supabase PostgreSQL schema
-- Based on DESIGN.md §1.1 and spec §2 deltas
-- RLS policies per spec §1
-- Triggers per spec §3
--
-- ---------------------------------------------------------------------------
-- PRE-EXISTING TABLES IN THE TARGET SUPABASE PROJECT — DO NOT RECREATE
-- ---------------------------------------------------------------------------
-- The following tables already exist and are owned by the user's project.
-- This migration must coexist with them; it never issues CREATE TABLE or
-- DROP TABLE against any of them:
--
--   users             (id int, username UNIQUE, password_hash, created_at, updated_at)
--   roles
--   permissions
--   role_permissions
--   user_roles
--   stocks
--
-- users is extended in place with ADD COLUMN IF NOT EXISTS (section 1a below).
-- RLS is still enabled + forced on users (section 3/4).
-- ---------------------------------------------------------------------------

-- Enable UUID extension if needed (not used in this schema)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create tables (from DESIGN.md §1.1)

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1a. Extend the PRE-EXISTING users table (no CREATE TABLE — see header)
-- Existing columns: id, username UNIQUE, password_hash, created_at, updated_at

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role VARCHAR(32) DEFAULT 'cashier' CHECK (role IN ('admin','cashier'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE TABLE suppliers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact VARCHAR(255),
  phone VARCHAR(32),
  email VARCHAR(255),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  unit VARCHAR(32) DEFAULT 'pcs',
  min_stock INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchases (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT REFERENCES suppliers(id),
  invoice_no VARCHAR(128),
  purchase_date DATE DEFAULT CURRENT_DATE,
  total_amount NUMERIC(14,2) NOT NULL,
  status VARCHAR(32) DEFAULT 'received' CHECK (status IN ('draft', 'received', 'cancelled')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_costs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id BIGINT REFERENCES purchases(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  additional_cost NUMERIC(12,2) DEFAULT 0 CHECK (additional_cost >= 0),
  effective_cost NUMERIC(12,2) GENERATED ALWAYS AS (
    unit_cost + (additional_cost / NULLIF(quantity, 0))
  ) STORED,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE margins (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pricing_type VARCHAR(32) DEFAULT 'percentage' CHECK (pricing_type IN ('percentage', 'fixed')),
  margin_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2),
  min_discount NUMERIC(5,2) DEFAULT 0,
  auto_update BOOLEAN DEFAULT TRUE,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, effective_from)
);

CREATE TABLE stock_ledger (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  ref_type VARCHAR(32) NOT NULL CHECK (ref_type IN ('purchase', 'sale', 'adjustment', 'transfer')),
  ref_id BIGINT,
  qty_in INT DEFAULT 0 CHECK (qty_in >= 0),
  qty_out INT DEFAULT 0 CHECK (qty_out >= 0),
  balance_after BIGINT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(32),
  email VARCHAR(255),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales (
  id BIGSERIAL PRIMARY KEY,
  invoice_no VARCHAR(128) UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES customers(id),
  total_amount NUMERIC(14,2) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,
  payment_method VARCHAR(32) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'transfer', 'qris')),
  status VARCHAR(32) DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'cancelled')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  subtotal NUMERIC(14,2) NOT NULL,
  profit NUMERIC(12,2) GENERATED ALWAYS AS (
    (unit_price - unit_cost) * quantity
  ) STORED
);

-- 2. Apply spec §2 deltas

ALTER TABLE products ADD COLUMN stock_qty BIGINT NOT NULL DEFAULT 0;

CREATE INDEX idx_products_stock ON products (stock_qty);
CREATE INDEX idx_ledger_product_time ON stock_ledger (product_id, created_at DESC);
CREATE INDEX idx_sale_items_product ON sale_items (product_id, sale_id);
CREATE INDEX idx_margins_product_from ON margins (product_id, effective_from DESC);
CREATE INDEX idx_sales_created ON sales (created_at DESC);

-- 3. Enable RLS on ALL tables (spec §1)

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE margins ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- 4. Set up RLS policies per spec §1

-- users: NO anon access (contains password_hash). service_role only.
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Read-only anon on all business tables (except users)
-- CREATE POLICY is idempotent-guarded via pg_policies lookup so the migration
-- can be re-run safely.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','suppliers','customers','products','margins',
    'purchases','product_costs','stock_ledger','sales','sale_items'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'anon_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY anon_read ON public.%I FOR SELECT TO anon USING (true)', t
      );
    END IF;
  END LOOP;
END $$;

-- 5. Create triggers per spec §3

-- T1: stock balance + cached stock, serialized per product
CREATE OR REPLACE FUNCTION trg_stock_ledger() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE cur BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('stock:' || NEW.product_id));
  SELECT COALESCE(SUM(qty_in - qty_out), 0) INTO cur
    FROM stock_ledger WHERE product_id = NEW.product_id;
  NEW.balance_after := cur + (NEW.qty_in - NEW.qty_out);
  UPDATE products SET stock_qty = NEW.balance_after WHERE id = NEW.product_id;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_ledger_bi BEFORE INSERT ON stock_ledger
FOR EACH ROW EXECUTE FUNCTION trg_stock_ledger();

-- T2: sales totals from sale_items
CREATE OR REPLACE FUNCTION trg_sale_items_totals() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sales SET
    total_amount = COALESCE((SELECT SUM(quantity * unit_price) FROM sale_items WHERE sale_id = COALESCE(NEW.sale_id, OLD.sale_id)), 0),
    total_cost   = COALESCE((SELECT SUM(quantity * unit_cost)  FROM sale_items WHERE sale_id = COALESCE(NEW.sale_id, OLD.sale_id)), 0)
  WHERE id = COALESCE(NEW.sale_id, OLD.sale_id);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER sale_items_ai AFTER INSERT ON sale_items
FOR EACH ROW EXECUTE FUNCTION trg_sale_items_totals();
CREATE TRIGGER sale_items_au AFTER UPDATE ON sale_items
FOR EACH ROW EXECUTE FUNCTION trg_sale_items_totals();
CREATE TRIGGER sale_items_ad AFTER DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION trg_sale_items_totals();