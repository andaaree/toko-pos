# Project State Machine

## 1. Architecture & Requirements
- [x] `[DONE]` Finalize technical specification with user (General Chat Agent) — user typed "Approved" 2026-08-28
- [x] `[DONE]` Output finalized spec to `docs/spec.md`

## 2. Database & System Design (Supabase)
- [x] `[DONE]` Write SQL schema and RLS policies (DB Agent)
- [x] `[DONE]` Review schema against `docs/spec.md` for security/logic (DB Reviewer) — reviewed by Database Team + Executor + Backend Team; quantity_change and policy-syntax defects fixed
- [x] `[DONE]` Apply migrations locally and test DB creation (DB Tester) — applied by user to real Supabase; RLS + trigger tests via Data API: GET/POST/users-deny PASS, triggers PASS (PATCH/DELETE return 204 no-op = correct RLS behavior, rows invisible to anon). Seeder: supabase/seeder.sql run by user.

## 3. Backend Implementation (NextJS)
- [x] `[DONE]` Implement NextJS API routes and middleware (Backend Agent) — spec §5: service_role client, /api/sales via create_sale() RPC (migration 0002), stock mutation, master-data CRUD, role checks
- [x] `[DONE]` Code review for NextJS best practices and DB connections (Backend Reviewer) — 4 defects found+fixed: TOCTOU stock race (advisory lock), get_weighted_hpp grants, error-branch ordering, 404/DELETE-count handling
- [ ] `[PENDING]` Run local backend tests / Jest (Backend Tester) — blocked: user must fill SUPABASE_SERVICE_ROLE_KEY + apply migration 0002; smoke tests then cover concurrent last-unit sale, PATCH/DELETE missing id, anon hpp GET

## 4. Frontend Implementation (React + Vite)
- [x] `[DONE]` Implement UI components and Vite config (Frontend Agent) — 6 existing Next.js pages wired (reads anon direct, writes via /api); AppShell extracted; middleware.ts server-side gate; login + dashboard bugs fixed. Missing pages (sales POS, master-data, users, settings) = pending user ruling
- [x] `[DONE]` Code review for React hooks, state, and UI/UX logic (Frontend Reviewer) — 7 defects found+fixed incl. 3 HIGH (route gate, login impossible, chart SQL interpolation)
- [ ] `[PENDING]` Run component/integration tests (Frontend Tester) — blocked: user must fill SUPABASE_SERVICE_ROLE_KEY + apply migration 0002

## 5. Deployment & Summary
- [ ] `[PENDING]` Commit changes to private git repository (Summarizer Agent)
- [ ] `[PENDING]` Generate project summary and update `README.md` (Summarizer Agent)

## Team Mapping (actual agents, updated 2026-08-28)
Actual team = 5 agents. Each teammate runs Agent → Reviewer → Tester sequentially in one session:
- DB Agent / DB Reviewer / DB Tester → Database Team
- Backend Agent / Backend Reviewer / Backend Tester → Backend Team
- Frontend Agent / Frontend Reviewer / Frontend Tester → Frontend Team
- Summarizer Agent → Summarizer Agent
- Coordination / spec → The Architect (lead)

Finalized spec: `docs/spec.md` (supersedes DESIGN.md v1.1 where they conflict).
Automation trigger: manual only — `./run-automation.sh` after script run. No schedule.