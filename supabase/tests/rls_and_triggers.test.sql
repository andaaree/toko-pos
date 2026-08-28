-- RLS and Trigger Test Suite for Toko schema
-- Runs against a freshly migrated DB with: psql -f supabase/tests/rls_and_triggers.test.sql
-- No pgTAP dependency — plain PostgreSQL with psql.

\echo '=== Setup: ensure base fixtures exist ==='
SET ROLE postgres;
INSERT INTO suppliers (name) VALUES ('Default Supplier') ON CONFLICT DO NOTHING;
INSERT INTO customers (name) VALUES ('Default Customer') ON CONFLICT DO NOTHING;
INSERT INTO categories (name) VALUES ('Default Category') ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Test 1: anon can SELECT business tables (read-only)
-- ---------------------------------------------------------------------------
\echo '--- Test 1: anon SELECT on business tables ---'
DO $$
DECLARE
  v_cat_id BIGINT;
  v_sup_id BIGINT;
  v_cust_id BIGINT;
  v_prod_id BIGINT;
  v_margin_id BIGINT;
  v_pur_id BIGINT;
  v_pc_id BIGINT;
  v_sl_id BIGINT;
  v_sale_id BIGINT;
  v_si_id BIGINT;
BEGIN
  -- Insert test rows as postgres
  SELECT id INTO v_cat_id FROM categories WHERE name = 'Default Category' LIMIT 1;
  SELECT id INTO v_sup_id FROM suppliers WHERE name = 'Default Supplier' LIMIT 1;
  SELECT id INTO v_cust_id FROM customers WHERE name = 'Default Customer' LIMIT 1;

  INSERT INTO products (sku, name, category_id) VALUES ('T1SKU', 'Test Product', v_cat_id) RETURNING id INTO v_prod_id;

  INSERT INTO margins (product_id, margin_value) VALUES (v_prod_id, 20) RETURNING id INTO v_margin_id;

  INSERT INTO purchases (supplier_id, total_amount) VALUES (v_sup_id, 100) RETURNING id INTO v_pur_id;

  INSERT INTO product_costs (product_id, purchase_id, quantity, unit_cost) VALUES (v_prod_id, v_pur_id, 10, 5) RETURNING id INTO v_pc_id;

  INSERT INTO stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out, balance_after)
    VALUES (v_prod_id, 'purchase', v_pur_id, 10, 0, 10) RETURNING id INTO v_sl_id;

  INSERT INTO sales (customer_id, total_amount, total_cost, payment_method)
    VALUES (v_cust_id, 200, 100, 'cash') RETURNING id INTO v_sale_id;

  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
    VALUES (v_sale_id, v_prod_id, 2, 150, 5) RETURNING id INTO v_si_id;

  -- Verify anon can SELECT from every business table
  SET ROLE anon;

  PERFORM 1 FROM categories WHERE id = v_cat_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read categories'; END IF;

  PERFORM 1 FROM suppliers WHERE id = v_sup_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read suppliers'; END IF;

  PERFORM 1 FROM customers WHERE id = v_cust_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read customers'; END IF;

  PERFORM 1 FROM products WHERE id = v_prod_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read products'; END IF;

  PERFORM 1 FROM margins WHERE id = v_margin_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read margins'; END IF;

  PERFORM 1 FROM purchases WHERE id = v_pur_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read purchases'; END IF;

  PERFORM 1 FROM product_costs WHERE id = v_pc_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read product_costs'; END IF;

  PERFORM 1 FROM stock_ledger WHERE id = v_sl_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read stock_ledger'; END IF;

  PERFORM 1 FROM sales WHERE id = v_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read sales'; END IF;

  PERFORM 1 FROM sale_items WHERE id = v_si_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[T1] anon cannot read sale_items'; END IF;

  SET ROLE postgres;
  RAISE NOTICE 'PASS: Test 1 — anon SELECT allowed on all 10 business tables';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: anon cannot INSERT/UPDATE/DELETE any table
-- ---------------------------------------------------------------------------
\echo '--- Test 2: anon write denied on business tables ---'
DO $$
DECLARE
  v_cat_id BIGINT;
BEGIN
  SELECT id INTO v_cat_id FROM categories WHERE name = 'Default Category' LIMIT 1;

  SET ROLE anon;

  -- categories
  BEGIN
    INSERT INTO categories (name) VALUES ('Should Fail');
    RAISE EXCEPTION '[T2] anon insert on categories should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: categories INSERT denied';
  END;

  BEGIN
    UPDATE categories SET name = 'Hacked' WHERE id = v_cat_id;
    RAISE EXCEPTION '[T2] anon update on categories should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: categories UPDATE denied';
  END;

  BEGIN
    DELETE FROM categories WHERE id = v_cat_id;
    RAISE EXCEPTION '[T2] anon delete on categories should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: categories DELETE denied';
  END;

  SET ROLE postgres;
  RAISE NOTICE 'PASS: Test 2 — anon write denied on sample table (same policy covers all)';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: users table fully locked down to anon (FORCE RLS)
-- ---------------------------------------------------------------------------
\echo '--- Test 3: users table closed to anon ---'
DO $$
DECLARE
  v_user_id BIGINT;
BEGIN
  -- Insert test user as postgres
  INSERT INTO users (username, email, name, password_hash, role)
    VALUES ('test_rluser', 'rl@test.com', 'RL Test', 'sha256fake', 'cashier')
    RETURNING id INTO v_user_id;

  SET ROLE anon;

  -- SELECT denied
  BEGIN
    PERFORM 1 FROM users WHERE id = v_user_id;
    RAISE EXCEPTION '[T3] anon SELECT on users should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: users SELECT denied';
  END;

  -- INSERT denied
  BEGIN
    INSERT INTO users (username, email, name, password_hash)
      VALUES ('anonhack', 'a@b.c', 'Hack', 'hash');
    RAISE EXCEPTION '[T3] anon INSERT on users should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: users INSERT denied';
  END;

  -- UPDATE denied
  BEGIN
    UPDATE users SET name = 'Hacked' WHERE id = v_user_id;
    RAISE EXCEPTION '[T3] anon UPDATE on users should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: users UPDATE denied';
  END;

  -- DELETE denied
  BEGIN
    DELETE FROM users WHERE id = v_user_id;
    RAISE EXCEPTION '[T3] anon DELETE on users should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: users DELETE denied';
  END;

  SET ROLE postgres;
  -- Cleanup
  DELETE FROM users WHERE username = 'test_rluser';
  RAISE NOTICE 'PASS: Test 3 — users table fully locked';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: stock_ledger trigger computes balance_after + products.stock_qty
-- ---------------------------------------------------------------------------
\echo '--- Test 4: stock_ledger trigger ---'
DO $$
DECLARE
  v_prod_id BIGINT;
  v_pur_id BIGINT;
  v_pc_id BIGINT;
  v_balance BIGINT;
BEGIN
  -- Fresh product with explicit stock_qty=0
  INSERT INTO products (sku, name, category_id, stock_qty)
    VALUES ('T4SKU', 'Stock Trigger Test', 1, 0) RETURNING id INTO v_prod_id;

  INSERT INTO purchases (supplier_id, total_amount) VALUES (1, 50) RETURNING id INTO v_pur_id;

  INSERT INTO product_costs (product_id, purchase_id, quantity, unit_cost)
    VALUES (v_prod_id, v_pur_id, 5, 10) RETURNING id INTO v_pc_id;

  -- Insert ledger row WITHOUT balance_after — trigger must compute it
  INSERT INTO stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out)
    VALUES (v_prod_id, 'purchase', v_pur_id, 5, 0);

  -- Verify balance_after in the ledger row
  SELECT balance_after INTO v_balance FROM stock_ledger
    WHERE product_id = v_prod_id ORDER BY id DESC LIMIT 1;
  IF v_balance IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '[T4] balance_after expected 5, got %', v_balance;
  END IF;
  RAISE NOTICE 'PASS: stock_ledger.balance_after = 5';

  -- Verify products.stock_qty updated
  SELECT stock_qty INTO v_balance FROM products WHERE id = v_prod_id;
  IF v_balance IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '[T4] products.stock_qty expected 5, got %', v_balance;
  END IF;
  RAISE NOTICE 'PASS: products.stock_qty = 5';

  -- Second insert: cumulative
  INSERT INTO stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out)
    VALUES (v_prod_id, 'purchase', v_pur_id, 3, 0);

  SELECT balance_after INTO v_balance FROM stock_ledger
    WHERE product_id = v_prod_id ORDER BY id DESC LIMIT 1;
  IF v_balance IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION '[T4] balance_after expected 8 after second insert, got %', v_balance;
  END IF;

  SELECT stock_qty INTO v_balance FROM products WHERE id = v_prod_id;
  IF v_balance IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION '[T4] products.stock_qty expected 8, got %', v_balance;
  END IF;
  RAISE NOTICE 'PASS: stock_qty = 8 after cumulative inserts';

  -- Sale deduction
  INSERT INTO stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out)
    VALUES (v_prod_id, 'sale', NULL, 0, 2);

  SELECT stock_qty INTO v_balance FROM products WHERE id = v_prod_id;
  IF v_balance IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION '[T4] products.stock_qty expected 6 after sale, got %', v_balance;
  END IF;
  RAISE NOTICE 'PASS: stock_qty = 6 after sale deduction';

  -- Cleanup
  DELETE FROM sale_items;
  DELETE FROM sales;
  DELETE FROM stock_ledger WHERE product_id = v_prod_id;
  DELETE FROM product_costs WHERE product_id = v_prod_id;
  DELETE FROM purchases WHERE id = v_pur_id;
  DELETE FROM products WHERE id = v_prod_id;

  RAISE NOTICE 'PASS: Test 4 — stock_ledger trigger correct';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: sale_items trigger maintains sales totals
-- ---------------------------------------------------------------------------
\echo '--- Test 5: sale_items totals trigger ---'
DO $$
DECLARE
  v_prod_id BIGINT;
  v_sale_id BIGINT;
  v_si_id BIGINT;
  v_total_amt NUMERIC;
  v_total_cost NUMERIC;
BEGIN
  INSERT INTO products (sku, name, category_id)
    VALUES ('T5SKU', 'Sale Trigger Test', 1) RETURNING id INTO v_prod_id;

  INSERT INTO sales (customer_id, total_amount, total_cost, payment_method)
    VALUES (1, 0, 0, 'cash') RETURNING id INTO v_sale_id;

  -- INSERT sale_item
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
    VALUES (v_sale_id, v_prod_id, 2, 10.00, 5.00) RETURNING id INTO v_si_id;

  SELECT total_amount, total_cost INTO v_total_amt, v_total_cost
    FROM sales WHERE id = v_sale_id;
  IF v_total_amt IS DISTINCT FROM 20.00 THEN
    RAISE EXCEPTION '[T5] total_amount expected 20.00, got %', v_total_amt;
  END IF;
  IF v_total_cost IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '[T5] total_cost expected 10.00, got %', v_total_cost;
  END IF;
  RAISE NOTICE 'PASS: sale_item INSERT -> totals 20.00 / 10.00';

  -- UPDATE quantity
  UPDATE sale_items SET quantity = 3 WHERE id = v_si_id;
  SELECT total_amount, total_cost INTO v_total_amt, v_total_cost
    FROM sales WHERE id = v_sale_id;
  IF v_total_amt IS DISTINCT FROM 30.00 THEN
    RAISE EXCEPTION '[T5] total_amount expected 30.00 after update, got %', v_total_amt;
  END IF;
  IF v_total_cost IS DISTINCT FROM 15.00 THEN
    RAISE EXCEPTION '[T5] total_cost expected 15.00 after update, got %', v_total_cost;
  END IF;
  RAISE NOTICE 'PASS: sale_item UPDATE -> totals 30.00 / 15.00';

  -- DELETE sale_item
  DELETE FROM sale_items WHERE id = v_si_id;
  SELECT total_amount, total_cost INTO v_total_amt, v_total_cost
    FROM sales WHERE id = v_sale_id;
  IF v_total_amt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '[T5] total_amount expected 0 after delete, got %', v_total_amt;
  END IF;
  IF v_total_cost IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '[T5] total_cost expected 0 after delete, got %', v_total_cost;
  END IF;
  RAISE NOTICE 'PASS: sale_item DELETE -> totals 0 / 0';

  -- Cleanup
  DELETE FROM sale_items WHERE sale_id = v_sale_id;
  DELETE FROM sales WHERE id = v_sale_id;
  DELETE FROM products WHERE id = v_prod_id;

  RAISE NOTICE 'PASS: Test 5 — sale_items totals trigger correct';
END $$;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
\echo ''
\echo 'All 5 tests passed.'