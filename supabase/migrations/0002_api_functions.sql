-- ===========================================================================
-- Toko — 0002: API support functions
-- ===========================================================================
-- Requires 0001_init.sql.
--
-- WHY THIS FILE EXISTS
-- The Supabase JS client has no transaction API: every .from().insert() is its
-- own HTTP round trip and therefore its own implicit transaction. Spec §5.2
-- requires "sale = insert sales + sale_items (unit_cost from Query B snapshot)
-- in one tx". That is impossible from JS alone — a crash between the two
-- inserts would leave a sale with no items and, because trigger T2 only fires
-- on sale_items, totals stuck at 0.
--
-- The only way to honour the spec is to move the unit of work into the database
-- as a single SECURITY DEFINER function invoked over RPC. One RPC = one
-- statement = one transaction, and it either fully commits or fully rolls back.
--
-- SECURITY: create_sale is service_role-only (see GRANT block at end of file).
-- get_weighted_hpp is read-only and callable by anon, matching D2 where reads
-- use the anon key.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- get_weighted_hpp — Query B (weighted-average cost) for a set of products.
-- weighted HPP = SUM(effective_cost * quantity) / SUM(quantity)
-- Products with no purchase history return 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weighted_hpp(product_ids BIGINT[])
RETURNS TABLE (product_id BIGINT, weighted_hpp NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS product_id,
         COALESCE(
           SUM(pc.effective_cost * pc.quantity) / NULLIF(SUM(pc.quantity), 0),
           0
         )::NUMERIC(12,2) AS weighted_hpp
  FROM public.products p
  LEFT JOIN public.product_costs pc ON pc.product_id = p.id
  WHERE p.id = ANY(product_ids)
  GROUP BY p.id;
$$;

-- ---------------------------------------------------------------------------
-- create_sale — atomic sale creation (spec D5 + §5.2)
--
-- p_items: JSONB array of { product_id, quantity, unit_price }
--
-- In ONE transaction:
--   1. INSERT sales (totals 0 — trigger T2 owns them)
--   2. For each item: snapshot unit_cost = weighted-average cost AT THIS MOMENT
--      (Query B), then INSERT sale_items. T2 refreshes sales totals per row.
--   3. For each item: INSERT stock_ledger (qty_out) — T1 computes balance_after
--      and updates products.stock_qty. balance_after is never supplied.
--
-- Raises on insufficient stock, which rolls back the whole sale.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale(
  p_invoice_no     VARCHAR,
  p_customer_id    BIGINT,
  p_payment_method VARCHAR,
  p_created_by     BIGINT,
  p_items          JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id   BIGINT;
  v_item      JSONB;
  v_unit_cost NUMERIC(12,2);
  v_stock     BIGINT;
  v_qty       INT;
  v_pid       BIGINT;
  v_price     NUMERIC(12,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'sale must contain at least one item';
  END IF;

  INSERT INTO public.sales (
    invoice_no, customer_id, total_amount, total_cost,
    payment_method, status, created_by
  )
  VALUES (
    p_invoice_no, p_customer_id, 0, 0,
    COALESCE(p_payment_method, 'cash'), 'completed', p_created_by
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid   := (v_item->>'product_id')::BIGINT;
    v_qty   := (v_item->>'quantity')::INT;
    v_price := (v_item->>'unit_price')::NUMERIC(12,2);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'quantity must be positive for product %', v_pid;
    END IF;

    -- Query B snapshot: weighted-average cost at sale time (D5).
    SELECT COALESCE(
             SUM(pc.effective_cost * pc.quantity) / NULLIF(SUM(pc.quantity), 0),
             0
           )
      INTO v_unit_cost
      FROM public.product_costs pc
     WHERE pc.product_id = v_pid;

    v_unit_cost := COALESCE(v_unit_cost, 0);

    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, unit_cost, subtotal
    )
    VALUES (
      v_sale_id, v_pid, v_qty, v_price, v_unit_cost, v_qty * v_price
    );

    -- Take the SAME advisory lock key T1 uses, BEFORE reading stock_qty.
    -- Without this the read below is unprotected: T1's lock is only held during
    -- the INSERT, so two concurrent sales could both observe stock=5, both pass
    -- the check, and both insert — driving stock negative. Acquiring it here
    -- holds it for the remainder of this transaction.
    PERFORM pg_advisory_xact_lock(hashtext('stock:' || v_pid));

    SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_pid;
    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'product % does not exist', v_pid;
    END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'insufficient stock for product %: have %, need %',
        v_pid, v_stock, v_qty;
    END IF;

    INSERT INTO public.stock_ledger (
      product_id, ref_type, ref_id, qty_in, qty_out, note
    )
    VALUES (
      v_pid, 'sale', v_sale_id, 0, v_qty, 'Penjualan ' || p_invoice_no
    );
  END LOOP;

  RETURN v_sale_id;
END $$;

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- create_sale is a MUTATION and SECURITY DEFINER: it must never be callable by
-- anon or authenticated, or the browser could forge sales bypassing the role
-- check in the API route. service_role only.
--
-- get_weighted_hpp is read-only (STABLE) and derives from product_costs, which
-- anon can already SELECT under the 0001 anon_read policy. It is granted to
-- anon/authenticated because app/api/hpp-pricing GET calls it through the ANON
-- client per D2 (reads stay on the anon key). Without this grant that call is
-- denied and the route silently degrades to its JS fallback on every request.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_weighted_hpp(BIGINT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_sale(VARCHAR, BIGINT, VARCHAR, BIGINT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_weighted_hpp(BIGINT[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(VARCHAR, BIGINT, VARCHAR, BIGINT, JSONB) TO service_role;
