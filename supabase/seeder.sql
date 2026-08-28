-- ===========================================================================
-- Toko — Seed Data
-- ===========================================================================
-- Run AFTER 0001_init.sql:
--   psql "$DATABASE_URL" -f supabase/seeder.sql
--
-- Properties:
--   * IDEMPOTENT — safe to run repeatedly. Tables with a UNIQUE key use
--     ON CONFLICT DO NOTHING; tables WITHOUT one (categories, suppliers,
--     customers, purchases, product_costs, stock_ledger, sale_items) use
--     WHERE NOT EXISTS natural-key guards instead. See note [A] below.
--   * FK-ORDERED — users -> categories/suppliers/customers -> products ->
--     margins -> purchases -> product_costs -> stock_ledger -> sales ->
--     sale_items.
--   * TRIGGER-AWARE — stock_ledger rows omit balance_after (trg_stock_ledger
--     BEFORE INSERT computes it and writes products.stock_qty); products.stock_qty
--     is NEVER set by hand. sales rows are inserted with total_amount/total_cost
--     = 0 and trg_sale_items_totals recomputes them as sale_items land.
--   * Does NOT touch pre-existing tables: roles, permissions, role_permissions,
--     user_roles, stocks.
--
-- ###########################################################################
-- # SECURITY — DEFAULT PASSWORDS. CHANGE BEFORE ANY DEPLOYMENT.             #
-- #                                                                         #
-- #   admin   / admin123     (role: admin)                                  #
-- #   cashier / cashier123   (role: cashier)                                #
-- #                                                                         #
-- # Hashes below are bcrypt cost 10, generated with bcryptjs to match       #
-- # lib/auth.ts verification. These are throwaway development credentials   #
-- # committed to the repo — anyone with repo access knows them. Rotate on    #
-- # first login and never run this seeder against production.               #
-- ###########################################################################
--
-- [A] Idempotency caveat: the natural keys used for guarding (category name,
--     supplier name, customer name, purchase invoice_no, ...) are NOT enforced
--     by database constraints. Concurrent runs of this seeder could still
--     duplicate rows. It is single-run/serial-safe, not concurrency-safe.
--
-- [B] users.updated_at is set explicitly. The pre-existing users table may
--     declare it NOT NULL without a default; relying on a default would break
--     the insert there.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. users  (pre-existing table, extended by 0001_init.sql section 1a)
--    username is UNIQUE -> ON CONFLICT works.
-- ---------------------------------------------------------------------------
INSERT INTO public.users (username, email, name, password_hash, role, is_active, updated_at)
VALUES
  ('admin',   'admin@toko.local',   'Administrator', '$2a$10$lH5EdjKpVWqxiYcngvAX6Ox1pSk6CFsoOqdEQ3q1KQhPDB9tCnG6a', 'admin',   TRUE, NOW()),
  ('cashier', 'cashier@toko.local', 'Kasir Toko',    '$2a$10$sIVNjdxyM1F6mzq1lrpuo.G.b5A/GhAcReFDHxIQkqLDxTTqH.0zW', 'cashier', TRUE, NOW())
ON CONFLICT (username) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. categories  (no UNIQUE constraint -> NOT EXISTS guard on name)
-- ---------------------------------------------------------------------------
INSERT INTO public.categories (name, description)
SELECT v.name, v.description
FROM (VALUES
  ('Makanan',    'Produk makanan kemasan dan curah'),
  ('Minuman',    'Minuman ringan, kopi, teh'),
  ('Sembako',    'Kebutuhan pokok sehari-hari'),
  ('Kebersihan', 'Sabun, deterjen, perawatan rumah'),
  ('Rokok',      'Produk tembakau')
) AS v(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE c.name = v.name
);

-- ---------------------------------------------------------------------------
-- 3. suppliers
-- ---------------------------------------------------------------------------
INSERT INTO public.suppliers (name, contact, phone, email, address)
SELECT v.name, v.contact, v.phone, v.email, v.address
FROM (VALUES
  ('PT Sumber Pangan',    'Budi Santoso', '021-5551001', 'sales@sumberpangan.co.id', 'Jl. Industri Raya 12, Jakarta'),
  ('CV Minuman Segar',    'Siti Aminah',  '022-5552002', 'order@minumansegar.co.id', 'Jl. Soekarno Hatta 88, Bandung'),
  ('UD Sembako Jaya',     'Agus Wijaya',  '031-5553003', 'agus@sembakojaya.com',     'Jl. Pasar Besar 5, Surabaya'),
  ('PT Bersih Sejahtera', 'Rina Dewi',    '021-5554004', 'cs@bersihsejahtera.co.id', 'Jl. Cikarang Blok C, Bekasi')
) AS v(name, contact, phone, email, address)
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers s WHERE s.name = v.name
);

-- ---------------------------------------------------------------------------
-- 4. customers
-- ---------------------------------------------------------------------------
INSERT INTO public.customers (name, phone, email, address)
SELECT v.name, v.phone, v.email, v.address
FROM (VALUES
  ('Pelanggan Umum', NULL,           NULL,                  'Walk-in customer'),
  ('Warung Bu Ani',  '0812-1111-001', 'buani@mail.local',   'Jl. Melati 3, Depok'),
  ('Toko Pak Joko',  '0812-1111-002', 'joko@mail.local',    'Jl. Kenanga 17, Tangerang'),
  ('Kantin Sekolah', '0812-1111-003', NULL,                 'SDN 04 Pagi, Jakarta Timur')
) AS v(name, phone, email, address)
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c WHERE c.name = v.name
);

-- ---------------------------------------------------------------------------
-- 5. products  (sku is UNIQUE -> ON CONFLICT works)
--    stock_qty deliberately omitted: trg_stock_ledger owns that column.
-- ---------------------------------------------------------------------------
INSERT INTO public.products (sku, name, category_id, unit, min_stock, is_active)
SELECT v.sku, v.name, c.id, v.unit, v.min_stock, TRUE
FROM (VALUES
  ('SKU-MKN-001', 'Indomie Goreng',          'Makanan',    'pcs',  24),
  ('SKU-MKN-002', 'Biskuit Roma Kelapa',     'Makanan',    'pcs',  12),
  ('SKU-MNM-001', 'Aqua 600ml',              'Minuman',    'pcs',  48),
  ('SKU-MNM-002', 'Teh Botol Sosro 350ml',   'Minuman',    'pcs',  24),
  ('SKU-MNM-003', 'Kopi Kapal Api Sachet',   'Minuman',    'pcs',  30),
  ('SKU-SMB-001', 'Beras Premium 5kg',       'Sembako',    'sak',   5),
  ('SKU-SMB-002', 'Gula Pasir 1kg',          'Sembako',    'kg',   10),
  ('SKU-SMB-003', 'Minyak Goreng 2L',        'Sembako',    'pcs',   8),
  ('SKU-KBR-001', 'Sabun Lifebuoy 85g',      'Kebersihan', 'pcs',  20),
  ('SKU-KBR-002', 'Deterjen Rinso 800g',     'Kebersihan', 'pcs',  10)
) AS v(sku, name, category_name, unit, min_stock)
JOIN public.categories c ON c.name = v.category_name
ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. margins  (UNIQUE(product_id, effective_from) -> ON CONFLICT works)
--    percentage margins for most items; two fixed-price examples.
-- ---------------------------------------------------------------------------
INSERT INTO public.margins (product_id, pricing_type, margin_value, sell_price, min_discount, auto_update, effective_from)
SELECT p.id, v.pricing_type, v.margin_value, v.sell_price, v.min_discount, TRUE, CURRENT_DATE
FROM (VALUES
  ('SKU-MKN-001', 'percentage', 20.00, NULL,     0.00),
  ('SKU-MKN-002', 'percentage', 25.00, NULL,     5.00),
  ('SKU-MNM-001', 'percentage', 30.00, NULL,     0.00),
  ('SKU-MNM-002', 'percentage', 22.00, NULL,     0.00),
  ('SKU-MNM-003', 'percentage', 28.00, NULL,     5.00),
  ('SKU-SMB-001', 'fixed',       0.00, 68000.00, 0.00),
  ('SKU-SMB-002', 'percentage', 12.00, NULL,     0.00),
  ('SKU-SMB-003', 'fixed',       0.00, 36000.00, 0.00),
  ('SKU-KBR-001', 'percentage', 35.00, NULL,     0.00),
  ('SKU-KBR-002', 'percentage', 18.00, NULL,     2.50)
) AS v(sku, pricing_type, margin_value, sell_price, min_discount)
JOIN public.products p ON p.sku = v.sku
ON CONFLICT (product_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. purchases  (no UNIQUE on invoice_no -> NOT EXISTS guard)
--    created_by resolved from the seeded admin user.
-- ---------------------------------------------------------------------------
INSERT INTO public.purchases (supplier_id, invoice_no, purchase_date, total_amount, status, created_by)
SELECT s.id, v.invoice_no, v.purchase_date::DATE, v.total_amount, 'received', u.id
FROM (VALUES
  ('PT Sumber Pangan',    'PO-2026-0001', '2026-08-01',  1524000.00),
  ('CV Minuman Segar',    'PO-2026-0002', '2026-08-05',  1684800.00),
  ('UD Sembako Jaya',     'PO-2026-0003', '2026-08-10',  7396000.00),
  ('PT Bersih Sejahtera', 'PO-2026-0004', '2026-08-14',  1221600.00)
) AS v(supplier_name, invoice_no, purchase_date, total_amount)
JOIN public.suppliers s ON s.name = v.supplier_name
JOIN public.users u ON u.username = 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchases pu WHERE pu.invoice_no = v.invoice_no
);

-- ---------------------------------------------------------------------------
-- 8. product_costs  (guard on purchase_id + product_id)
--    effective_cost is GENERATED — never inserted.
-- ---------------------------------------------------------------------------
INSERT INTO public.product_costs (product_id, purchase_id, quantity, unit_cost, additional_cost, received_at)
SELECT p.id, pu.id, v.quantity, v.unit_cost, v.additional_cost, pu.purchase_date::TIMESTAMPTZ
FROM (VALUES
  ('PO-2026-0001', 'SKU-MKN-001', 240,  2600.00, 24000.00),
  ('PO-2026-0001', 'SKU-MKN-002', 120,  7200.00, 12000.00),
  ('PO-2026-0002', 'SKU-MNM-001', 288,  2400.00, 28800.00),
  ('PO-2026-0002', 'SKU-MNM-002', 144,  4900.00, 14400.00),
  ('PO-2026-0002', 'SKU-MNM-003', 180,  1300.00, 10800.00),
  ('PO-2026-0003', 'SKU-SMB-001',  60, 62000.00, 60000.00),
  ('PO-2026-0003', 'SKU-SMB-002', 100, 13500.00, 10000.00),
  ('PO-2026-0003', 'SKU-SMB-003',  80, 28000.00, 16000.00),
  ('PO-2026-0004', 'SKU-KBR-001', 240,  2900.00, 12000.00),
  ('PO-2026-0004', 'SKU-KBR-002', 120,  4200.00,  9600.00)
) AS v(invoice_no, sku, quantity, unit_cost, additional_cost)
JOIN public.purchases pu ON pu.invoice_no = v.invoice_no
JOIN public.products p ON p.sku = v.sku
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_costs pc
  WHERE pc.purchase_id = pu.id AND pc.product_id = p.id
);

-- ---------------------------------------------------------------------------
-- 9. stock_ledger — GOODS IN from purchases
--     balance_after is intentionally OMITTED. trg_stock_ledger (BEFORE INSERT)
--     computes it from the running sum and writes products.stock_qty. The
--     NOT NULL check on balance_after runs after the BEFORE trigger, so a
--     supplied value is unnecessary — and supplying one would be overwritten.
--     products.stock_qty is never touched directly anywhere in this seeder.
-- ---------------------------------------------------------------------------
INSERT INTO public.stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out, note, created_at)
SELECT p.id, 'purchase', pu.id, pc.quantity, 0,
       'Penerimaan barang ' || pu.invoice_no, pu.purchase_date::TIMESTAMPTZ
FROM public.product_costs pc
JOIN public.purchases pu ON pu.id = pc.purchase_id
JOIN public.products p ON p.id = pc.product_id
WHERE pu.invoice_no IN ('PO-2026-0001','PO-2026-0002','PO-2026-0003','PO-2026-0004')
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_ledger sl
    WHERE sl.ref_type = 'purchase' AND sl.ref_id = pu.id AND sl.product_id = p.id
  );

-- ---------------------------------------------------------------------------
-- 10. sales  (invoice_no UNIQUE -> ON CONFLICT works)
--     total_amount / total_cost seeded as 0: trg_sale_items_totals recomputes
--     both from sale_items in section 11. Do not hand-maintain them.
-- ---------------------------------------------------------------------------
INSERT INTO public.sales (invoice_no, customer_id, total_amount, total_cost, payment_method, status, created_by, created_at)
SELECT v.invoice_no, c.id, 0, 0, v.payment_method, 'completed', u.id, v.created_at::TIMESTAMPTZ
FROM (VALUES
  ('INV-2026-0001', 'Pelanggan Umum', 'cash',     '2026-08-20 09:15:00+07'),
  ('INV-2026-0002', 'Warung Bu Ani',  'transfer', '2026-08-21 14:30:00+07'),
  ('INV-2026-0003', 'Toko Pak Joko',  'qris',     '2026-08-22 11:05:00+07'),
  ('INV-2026-0004', 'Kantin Sekolah', 'cash',     '2026-08-25 16:45:00+07')
) AS v(invoice_no, customer_name, payment_method, created_at)
JOIN public.customers c ON c.name = v.customer_name
JOIN public.users u ON u.username = 'cashier'
ON CONFLICT (invoice_no) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. sale_items
--     unit_cost is read from product_costs.effective_cost (the generated
--     column) rather than hardcoded, so seeded margins stay consistent with
--     seeded purchase costs. subtotal = quantity * unit_price is supplied
--     because the column is NOT NULL and not generated; profit IS generated
--     and therefore never inserted.
--     Each INSERT fires trg_sale_items_totals, which refreshes sales totals.
-- ---------------------------------------------------------------------------
INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
SELECT s.id, p.id, v.quantity, v.unit_price, pc.effective_cost,
       v.quantity * v.unit_price
FROM (VALUES
  ('INV-2026-0001', 'SKU-MKN-001', 10,  3240.00),
  ('INV-2026-0001', 'SKU-MNM-001',  6,  3250.00),
  ('INV-2026-0002', 'SKU-SMB-001',  2, 68000.00),
  ('INV-2026-0002', 'SKU-SMB-002',  5, 15232.00),
  ('INV-2026-0002', 'SKU-KBR-002', 3,  5050.40),
  ('INV-2026-0003', 'SKU-MNM-002', 12,  6100.00),
  ('INV-2026-0003', 'SKU-MNM-003', 20,  1740.80),
  ('INV-2026-0003', 'SKU-KBR-001',  8,  3982.50),
  ('INV-2026-0004', 'SKU-MKN-002', 24,  9125.00),
  ('INV-2026-0004', 'SKU-SMB-003',  3, 36000.00)
) AS v(invoice_no, sku, quantity, unit_price)
JOIN public.sales s ON s.invoice_no = v.invoice_no
JOIN public.products p ON p.sku = v.sku
JOIN LATERAL (
  SELECT pc2.effective_cost
  FROM public.product_costs pc2
  WHERE pc2.product_id = p.id
  ORDER BY pc2.received_at DESC, pc2.id DESC
  LIMIT 1
) pc ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.sale_items si
  WHERE si.sale_id = s.id AND si.product_id = p.id
);

-- ---------------------------------------------------------------------------
-- 12. stock_ledger — GOODS OUT from sales
--     Same trigger contract as section 9: balance_after omitted.
-- ---------------------------------------------------------------------------
INSERT INTO public.stock_ledger (product_id, ref_type, ref_id, qty_in, qty_out, note, created_at)
SELECT si.product_id, 'sale', s.id, 0, si.quantity,
       'Penjualan ' || s.invoice_no, s.created_at
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.invoice_no IN ('INV-2026-0001','INV-2026-0002','INV-2026-0003','INV-2026-0004')
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_ledger sl
    WHERE sl.ref_type = 'sale' AND sl.ref_id = s.id AND sl.product_id = si.product_id
  );

COMMIT;

-- ===========================================================================
-- Post-seed sanity checks (read-only; run manually if desired)
-- ===========================================================================
-- Cached stock must equal the ledger sum for every product:
--   SELECT p.sku, p.stock_qty,
--          COALESCE(SUM(sl.qty_in - sl.qty_out), 0) AS ledger_balance
--   FROM products p LEFT JOIN stock_ledger sl ON sl.product_id = p.id
--   GROUP BY p.id, p.sku, p.stock_qty
--   HAVING p.stock_qty <> COALESCE(SUM(sl.qty_in - sl.qty_out), 0);
--   -- expected: 0 rows
--
-- Sales totals must equal the sum of their items:
--   SELECT s.invoice_no, s.total_amount, SUM(si.quantity * si.unit_price) AS items_total
--   FROM sales s JOIN sale_items si ON si.sale_id = s.id
--   GROUP BY s.id, s.invoice_no, s.total_amount
--   HAVING s.total_amount <> SUM(si.quantity * si.unit_price);
--   -- expected: 0 rows
-- ===========================================================================
