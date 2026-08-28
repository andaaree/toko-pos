# POS & Margin Management — Admin Dashboard Design & User Guide

Tech stack: **Supabase (PostgreSQL)** · **Next.js** · **Vite + React**

---

## 0. Tech Stack & Architecture

### 0.1 Frontend
- **Next.js (App Router)** — SSR admin shell, auth session, secure API routes.
- **Vite + React** — SPA dashboard pages, fast interactive state (simulasi, pos cashier, stock matrix).
- **next-auth (JWT strategy)** — internal Next.js JWT session auth, NO Supabase Auth.
- **iron-session / jose** — encrypted httpOnly cookie session for API security.

### 0.2 Database Backend
- **Supabase PostgreSQL** — tables, generated columns, triggers, stored functions, views.
- **Direct Supabase Client** — `@supabase/supabase-js` SDK. **NO ORM** (no Prisma), NO raw REST — direct SDK queries only.
- **Cursor Pagination** — use `.gt('id', cursor).order('id').limit(pageSize)` for free-tier efficiency.
  ```js
  // Example: cursor pagination
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .gt('id', lastId)       // cursor: last ID from previous page
    .order('id')
    .limit(50);
  ```
  Avoid `OFFSET` on large tables in free Supabase tier.

### 0.3 Auth Architecture (IMPORTANT)
- **NO Supabase Auth** — `auth.users` table NOT used.
- **NO FK to `auth.users`** in local `users` table.
- Next.js manages auth via `next-auth`, **JWT sessions only** (no DB session table).
- Session stored in **httpOnly cookie** encrypted via `NEXTAUTH_SECRET`.
- Local `users` table: plain PostgreSQL (id BIGSERIAL, email, name, password_hash TEXT, role).

### 0.4 Environment Variables
```env
DATABASE_URL=postgresql://user:pass@host:5432/toko_db
NEXTAUTH_SECRET=<32+ byte random hex>
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

### 0.5 Data Flow
```
[ Next.js App / API Router ]  [ Vite SPA / React Client ]
         │                          │
   next-auth JWT cookie       supabase-js REST client
         └───────────┬──────────────┘
                     ▼
          [ Supabase PostgreSQL ]
  ├── public.users (plain table, NO auth.users FK)
  ├── Generated columns (effective_cost, profit)
  └── Views / RPC (profit analytics, hpp calc)
```

---

## 1. Database Schema

### 1.1 Tables & Relations

```sql
-- categories
CREATE TABLE categories (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- products
CREATE TABLE products (
  id            BIGSERIAL PRIMARY KEY,
  sku           VARCHAR(64) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  category_id   BIGINT REFERENCES categories(id),
  unit          VARCHAR(32) DEFAULT 'pcs',
  min_stock     INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku      ON products(sku);

-- suppliers
CREATE TABLE suppliers (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  contact     VARCHAR(255),
  phone       VARCHAR(32),
  email       VARCHAR(255),
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- users (plain PostgreSQL, Next.js internal JWT auth — NO Supabase auth.users)
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(255) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,        -- bcrypt / argon2
  role          VARCHAR(32) DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- purchases (pembelian masuk)
CREATE TABLE purchases (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   BIGINT REFERENCES suppliers(id),
  invoice_no    VARCHAR(128),
  purchase_date DATE DEFAULT CURRENT_DATE,
  total_amount  NUMERIC(14,2) NOT NULL,
  status        VARCHAR(32) DEFAULT 'received' CHECK (status IN ('draft', 'received', 'cancelled')),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- product_costs (HPP per batch pembelian)
CREATE TABLE product_costs (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id     BIGINT REFERENCES purchases(id),
  quantity        INT NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  additional_cost NUMERIC(12,2) DEFAULT 0 CHECK (additional_cost >= 0),
  effective_cost  NUMERIC(12,2) GENERATED ALWAYS AS (
    unit_cost + (additional_cost / NULLIF(quantity, 0))
  ) STORED,
  received_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_product_costs_prod ON product_costs(product_id);

-- margins (aturan harga jual per produk)
CREATE TABLE margins (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pricing_type    VARCHAR(32) DEFAULT 'percentage' CHECK (pricing_type IN ('percentage', 'fixed')),
  margin_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price      NUMERIC(12,2),
  min_discount    NUMERIC(5,2) DEFAULT 0,
  auto_update     BOOLEAN DEFAULT TRUE,
  effective_from  DATE DEFAULT CURRENT_DATE,
  effective_to    DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, effective_from)
);
CREATE INDEX idx_margins_prod ON margins(product_id);

-- stock_ledger (audit pergerakan stok, append-only)
CREATE TABLE stock_ledger (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT NOT NULL REFERENCES products(id),
  ref_type      VARCHAR(32) NOT NULL CHECK (ref_type IN ('purchase', 'sale', 'adjustment', 'transfer')),
  ref_id        BIGINT,
  qty_in        INT DEFAULT 0 CHECK (qty_in >= 0),
  qty_out       INT DEFAULT 0 CHECK (qty_out >= 0),
  balance_after INT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stock_ledger_prod ON stock_ledger(product_id, created_at DESC);

-- customers
CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(32),
  email       VARCHAR(255),
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- sales (transaksi POS)
CREATE TABLE sales (
  id              BIGSERIAL PRIMARY KEY,
  invoice_no      VARCHAR(128) UNIQUE NOT NULL,
  customer_id     BIGINT REFERENCES customers(id),
  total_amount    NUMERIC(14,2) NOT NULL,
  total_cost      NUMERIC(14,2) NOT NULL,
  payment_method  VARCHAR(32) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'transfer', 'qris')),
  status          VARCHAR(32) DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'cancelled')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sales_created ON sales(created_at DESC);

-- sale_items (detail item POS + auto profit)
CREATE TABLE sale_items (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  quantity    INT NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost   NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  subtotal    NUMERIC(14,2) NOT NULL,
  profit      NUMERIC(12,2) GENERATED ALWAYS AS (
    (unit_price - unit_cost) * quantity
  ) STORED
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_prod ON sale_items(product_id);
```

### 1.2 RLS (Row Level Security) — Supabase
```sql
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE margins       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases     ENABLE ROW LEVEL SECURITY;

-- Helper: cek admin via app-level JWT claim (bukan auth.users)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = (auth.uid()::bigint) AND role = 'admin' AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Products: read authenticated, write admin only
CREATE POLICY products_read ON products FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY products_admin_write ON products FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Margins & Costs: admin only
CREATE POLICY margins_admin ON margins FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY costs_admin ON product_costs FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Sales & Sale Items: authenticated can read/create
CREATE POLICY sales_read ON sales FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY sales_insert ON sales FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY sale_items_read ON sale_items FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY sale_items_insert ON sale_items FOR INSERT TO authenticated WITH CHECK (TRUE);

-- Stock Ledger: read authenticated, write system/admin
CREATE POLICY stock_read ON stock_ledger FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY stock_insert ON stock_ledger FOR INSERT TO authenticated WITH CHECK (TRUE);
```

---

## 2. Use Cases

```
                    ┌─────────────────────────┐
                    │      Admin / Kasir      │
                    └────────────┬────────────┘
                                 │
     ┌───────────────────┬───────┴───────────┬─────────────────────┐
     ▼                   ▼                   ▼                     ▼
┌──────────────┐  ┌──────────────┐   ┌──────────────┐    ┌─────────────────────┐
│ 1. HPP &     │  │ 2. Simulasi  │   │ 3. Stock     │    │ 4. Dashboard Profit │
│    Pricing   │  │    Profit    │   │    Mgt       │    │    (Day/Week/Month) │
└──────────────┘  └──────────────┘   └──────────────┘    └─────────────────────┘
```

### 2.1 Halaman 1: HPP & Penentuan Harga Jual
| ID | Aktor | Aksi | Input | Output / Dampak |
|---|---|---|---|---|
| UC-P01 | Admin | Lihat daftar HPP | Filter kategori, search nama/SKU | Tabel produk, weighted HPP, harga jual aktif, margin % |
| UC-P02 | Admin | Atur margin persentase | `product_id`, `margin_value` (%) | Harga jual auto kalkulasi: `HPP * 1.30` |
| UC-P03 | Admin | Atur harga fixed / override | `product_id`, `sell_price` (Rp) | Matikan `auto_update`, set fix sell price |
| UC-P04 | Admin | Atur batas diskon | `min_discount` (%) | Kasir dilarang diskon di atas batas |
| UC-P05 | Admin | Simpan perubahan harga | Form submit | Data masuk `margins`, harga POS update real-time |

### 2.2 Halaman 2: Simulasi Penghitungan Profit
| ID | Aktor | Aksi | Input | Output / Dampak |
|---|---|---|---|---|
| UC-S01 | Admin | Simulasi skenario margin | Target margin %, estimasi qty jual | Taksiran harga jual, profit/unit, total revenue, total profit |
| UC-S02 | Admin | Simulasi target profit | Target total profit (Rp), estimasi qty | Rekomendasi harga jual minimal & margin % minimal |
| UC-S03 | Admin | Analisis break-even (BEP) | Biaya operasional tambahan, HPP | Titik impas harga minimum & minimum qty jual |
| UC-S04 | Admin | Apply hasil simulasi | Klik "Terapkan ke Produk" | Data langsung tersimpan ke tabel `margins` |

### 2.3 Halaman 3: Stock Management
| ID | Aktor | Aksi | Input | Output / Dampak |
|---|---|---|---|---|
| UC-K01 | Admin | Monitor stok terkini | Search/filter status | Tabel SKU, current stock, min stock, status OK/LOW/EMPTY |
| UC-K02 | Admin | Catat barang masuk (purchase)| Supplier, invoice, items, qty, unit_cost, ongkir | Stok bertambah, `product_costs` terisi, recalculate HPP |
| UC-K03 | Admin | Stock opname / adjustment | `product_id`, `qty_actual`, `note` | Koreksi selisih, catat log ke `stock_ledger` |
| UC-K04 | Admin | Audit histori kartu stok | `product_id`, rentang tanggal | Ledger kronologis: tanggal, ref, qty in/out, balance after |
| UC-K05 | Admin/Kasir | Alert stok menipis | Realtime listener | Badge notifikasi saat stock <= min_stock |

### 2.4 Halaman 4: Dashboard Admin — Laporan Profit (Dropdown: Harian, Mingguan, Bulanan)
| ID | Aktor | Aksi | Input | Output / Dampak |
|---|---|---|---|---|
| UC-D01 | Admin | Pilih periode profit | Dropdown: `daily` / `weekly` / `monthly` | Chart tren revenue vs profit + KPI summary cards |
| UC-D02 | Admin | Filter rentang tanggal kustom | `start_date`, `end_date` | Laporan laba kotor & margin agregat |
| UC-D03 | Admin | Lihat top profit products | Periode aktif | List 5-10 produk penghasil laba terbesar |
| UC-D04 | Admin | Breakdown laba per kategori | Periode aktif | Pie/bar chart margin kontribusi per kategori |

---

## 3. API / SQL Queries

### 3.1 Direct Supabase Client Queries (NO Prisma / ORM)

**HPP & Pricing**

```js
// A. Ambil daftar produk + HPP weighted + harga jual
const { data, error } = await supabase
  .from('products')
  .select(`
    id, sku, name, unit, min_stock, is_active,
    category:category_id ( name ),
    product_costs ( effective_cost, quantity ),
    margins ( pricing_type, margin_value, sell_price, auto_update, min_discount )
  `)
  .eq('is_active', true)
  .order('id')
  .limit(50);
```

```sql
-- B. Weighted HPP per produk (query via RPC atau direct SQL)
SELECT
  product_id,
  SUM(effective_cost * quantity) / NULLIF(SUM(quantity), 0) AS weighted_hpp,
  SUM(quantity) AS total_batch_qty
FROM product_costs
GROUP BY product_id;
```

```sql
-- C. Upsert margin & harga jual
INSERT INTO margins (product_id, pricing_type, margin_value, sell_price, min_discount, auto_update)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (product_id, effective_from) DO UPDATE
SET pricing_type = EXCLUDED.pricing_type,
    margin_value = EXCLUDED.margin_value,
    sell_price   = EXCLUDED.sell_price,
    min_discount = EXCLUDED.min_discount,
    auto_update  = EXCLUDED.auto_update,
    updated_at   = NOW();
```

**Stock Management**

```js
// D. Stok terkini via cursor pagination (free-tier friendly)
const { data, error } = await supabase
  .from('stock_ledger')
  .select('product_id, qty_in, qty_out, balance_after')
  .gt('id', lastId)      // cursor: ID dari record terakhir halaman sebelumnya
  .order('id')
  .limit(100);
```

```sql
-- E. Tabel stok terkini + status LOW/EMPTY
SELECT
  p.id, p.sku, p.name, p.unit, p.min_stock,
  COALESCE(SUM(sl.qty_in), 0) - COALESCE(SUM(sl.qty_out), 0) AS current_stock,
  CASE
    WHEN (COALESCE(SUM(sl.qty_in), 0) - COALESCE(SUM(sl.qty_out), 0)) <= 0 THEN 'EMPTY'
    WHEN (COALESCE(SUM(sl.qty_in), 0) - COALESCE(SUM(sl.qty_out), 0)) <= p.min_stock THEN 'LOW'
    ELSE 'OK'
  END AS stock_status
FROM products p
LEFT JOIN stock_ledger sl ON sl.product_id = p.id
WHERE p.is_active = TRUE
GROUP BY p.id, p.sku, p.name, p.unit, p.min_stock
ORDER BY current_stock ASC;
```

**Sales & Profit Report**

```sql
-- F. Laporan penjualan + profit per periode
SELECT
  s.id AS sale_id,
  s.invoice_no,
  s.created_at,
  SUM(si.quantity) AS total_qty,
  SUM(si.subtotal) AS total_penjualan,
  SUM(si.profit) AS total_profit,
  ROUND(SUM(si.profit) / NULLIF(SUM(si.subtotal), 0) * 100, 2) AS margin_persen
FROM sales s
JOIN sale_items si ON si.sale_id = s.id
WHERE s.created_at BETWEEN $1 AND $2
  AND s.status = 'completed'
GROUP BY s.id, s.invoice_no, s.created_at
ORDER BY s.created_at DESC;
```

**Dashboard Profit Summary (Dropdown: daily / weekly / monthly)**

```sql
-- G. Dashboard profit agregat per bucket waktu
WITH raw AS (
  SELECT
    s.id,
    s.total_amount AS revenue,
    s.total_cost AS cogs,
    (s.total_amount - s.total_cost) AS profit,
    CASE
      WHEN $1 = 'weekly'  THEN to_char(date_trunc('week', s.created_at), 'YYYY-"W"IW')
      WHEN $1 = 'monthly' THEN to_char(date_trunc('month', s.created_at), 'YYYY-MM')
      ELSE to_char(s.created_at, 'YYYY-MM-DD')
    END AS bucket_label,
    date_trunc(
      CASE
        WHEN $1 = 'weekly' THEN 'week'
        WHEN $1 = 'monthly' THEN 'month'
        ELSE 'day'
      END,
      s.created_at
    )::DATE AS bucket_date
  FROM sales s
  WHERE s.status = 'completed'
    AND s.created_at::DATE BETWEEN $2 AND $3
)
SELECT
  r.bucket_label AS period_bucket,
  r.bucket_date  AS period_date,
  COUNT(r.id) AS total_orders,
  COALESCE(SUM(r.revenue), 0) AS total_revenue,
  COALESCE(SUM(r.cogs), 0) AS total_cogs,
  COALESCE(SUM(r.profit), 0) AS gross_profit,
  ROUND((COALESCE(SUM(r.profit), 0) / NULLIF(SUM(r.revenue), 0)) * 100, 2) AS margin_pct
FROM raw r
GROUP BY r.bucket_label, r.bucket_date
ORDER BY r.bucket_date ASC;
```

**Simulasi Profit Function**

```sql
-- H. RPC: simulasi profit berdasarkan harga jual baru
CREATE OR REPLACE FUNCTION simulate_profit(
  p_product_id  BIGINT,
  p_sim_price   NUMERIC DEFAULT NULL,
  p_sim_margin  NUMERIC DEFAULT NULL,
  p_est_qty     INT DEFAULT 1
)
RETURNS TABLE (
  product_id      BIGINT,
  product_name    VARCHAR,
  hpp             NUMERIC,
  sim_sell_price  NUMERIC,
  profit_per_unit NUMERIC,
  total_revenue   NUMERIC,
  total_cogs      NUMERIC,
  total_profit    NUMERIC,
  margin_pct      NUMERIC
) AS $$
DECLARE
  v_hpp NUMERIC;
  v_name VARCHAR;
  v_final_price NUMERIC;
BEGIN
  SELECT p.name,
    COALESCE(SUM(pc.effective_cost * pc.quantity) / NULLIF(SUM(pc.quantity), 0), 0)
  INTO v_name, v_hpp
  FROM products p
  LEFT JOIN product_costs pc ON pc.product_id = p.id
  WHERE p.id = p_product_id
  GROUP BY p.id, p.name;

  IF p_sim_price IS NOT NULL THEN
    v_final_price := p_sim_price;
  ELSIF p_sim_margin IS NOT NULL THEN
    v_final_price := ROUND(v_hpp * (1 + p_sim_margin / 100), 2);
  ELSE
    v_final_price := v_hpp;
  END IF;

  RETURN QUERY SELECT
    p_product_id,
    v_name,
    ROUND(v_hpp, 2),
    ROUND(v_final_price, 2),
    ROUND(v_final_price - v_hpp, 2),
    ROUND(v_final_price * p_est_qty, 2),
    ROUND(v_hpp * p_est_qty, 2),
    ROUND((v_final_price - v_hpp) * p_est_qty, 2),
    ROUND(((v_final_price - v_hpp) / NULLIF(v_final_price, 0)) * 100, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 4. User Guide (Panduan Pengguna)

### 4.1 Halaman 1: HPP & Penentuan Harga Jual
1. Buka menu **"HPP & Harga Jual"** pada sidebar dashboard.
2. **Cari Produk:** Ketik nama produk atau scan barcode/SKU.
3. **Lihat HPP Terkini:** Kolom `HPP Rata-rata` menampilkan modal tertimbang dari histori pembelian.
4. **Pilih Metode Pricing:**
   - **Persentase:** Pilih `Percentage`, masukkan nilai (contoh `25`%). Harga jual otomatis: `HPP + 25%`.
   - **Fixed / Manual:** Matikan toggle `Auto Update`, ketik nominal harga jual langsung.
5. **Set Batas Diskon Kasir (Opsional):** Masukkan persentase diskon maksimal (contoh `10`%).
6. **Klik "Simpan":** Harga baru langsung aktif pada modul kasir POS.

---

### 4.2 Halaman 2: Simulasi Penghitungan Profit
1. Buka menu **"Simulasi Profit"**.
2. **Pilih Produk:** Pilih satu produk atau buat simulasi produk kustom.
3. **Pilih Parameter Simulasi:**
   - Masukkan **Target Margin (%)** ATAU **Rencana Harga Jual (Rp)**.
   - Masukkan **Estimasi Qty Terjual** (contoh: target 500 pcs/bulan).
4. **Baca Output Simulasi:**
   - **Profit per Unit:** Keuntungan bersih per item.
   - **Total Estimasi Omset:** Qty × Harga Jual.
   - **Total Estimasi HPP:** Qty × HPP.
   - **Total Estimasi Profit:** Omset − HPP.
   - **Margin %:** Rasio laba kotor terhadap omset.
5. **Terapkan (Jika Cocok):** Klik tombol **"Jadikan Harga Aktif"** untuk langsung memperbarui setting harga produk.

---

### 4.3 Halaman 3: Stock Management
1. **Melihat Status Stok:**
   - **Hijau (OK):** Stok di atas batas aman.
   - **Kuning (LOW):** Stok mendekati / di bawah `Min Stock`.
   - **Merah (EMPTY):** Stok habis (0).
2. **Mencatat Barang Masuk (Restock / Purchase):**
   - Klik **"Tambah Pembelian / Barang Masuk"**.
   - Pilih Supplier, nomor faktur, dan daftar barang beserta quantity + harga beli per unit + ongkos kirim.
   - Klik **"Simpan & Masukkan Stok"**. Sistem otomatis menambah saldo stok dan memperbarui weighted HPP.
3. **Koreksi Stok (Stock Opname / Adjustment):**
   - Klik aksi **"Penyesuaian Stok"** pada baris produk.
   - Masukkan jumlah fisik aktual.
   - Pilih alasan (*Barang Rusak*, *Expired*, *Selisih Fisik*).
   - Klik **"Update Stok"**. Sistem mencatat selisih ke `stock_ledger`.
4. **Melihat Kartu Stok (Audit Trail):**
   - Klik tombol **"Histori Stok"** untuk melihat rekam jejak keluar masuk barang lengkap.

---

### 4.4 Halaman 4: Dashboard Admin & Filter Profit
1. Buka menu **"Dashboard"**.
2. **Gunakan Dropdown Periode:**
   - **Harian:** Grafik dan tabel laba per hari (cocok untuk evaluasi harian / closing kasir).
   - **Mingguan:** Tren performa per minggu.
   - **Bulanan:** Pertumbuhan laba bulanan untuk laporan keuangan.
3. **Baca Indikator Kunci (KPI Cards):**
   - **Total Omset (Revenue):** Total uang masuk dari transaksi selesai.
   - **Total Modal (COGS / HPP):** Total biaya pokok barang yang terjual.
   - **Laba Kotor (Gross Profit):** Total keuntungan bersih.
   - **Rata-rata Margin (%):** Efisiensi keuntungan toko.
4. **Analisis Grafik & Top Products:**
   - Bar Chart: Membandingkan Omset vs Laba per bucket tanggal.
   - Tabel Top Margin: Produk paling banyak menyumbang laba.

---

## 5. Notes
- Semua harga pakai `NUMERIC(12,2)`, tidak pakai `FLOAT`.
- `effective_cost` generated column dari `unit_cost + additional_cost/quantity`.
- `stock_ledger` audit-only: never delete, hanya insert.
- API layer: semua `INSERT/UPDATE` bungkus dalam transaction.
- Soft delete pakai `is_active = FALSE` untuk products/suppliers/customers.
- Timestamp pakai `TIMESTAMPTZ` (UTC); konversi di aplikasi.
- **NO Prisma / ORM** — akses database via `@supabase/supabase-js` langsung.
- **Cursor pagination** untuk semua list API (pakai `.gt('id', cursor)`) untuk performa free-tier.
