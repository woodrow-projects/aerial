# Plan: SPA UI foundation — shadcn/ui, TanStack Router & Query, app shell

> **Status: implemented (2026-07).** Realizes the SPA stack `docs/ARCHITECTURE.md` names (shadcn/Radix +
> Tailwind). `apps/web` is now Tailwind v4 + vendored shadcn primitives (`src/components/ui/`), TanStack Router
> (code-based: `/login` + auth-guarded shell over `/` Channels and `/cdn` Delivery) and TanStack Query
> (the old `setInterval` polling is gone — channels poll at 5s, CDN at 3s while provisioning). The inline
> `App.tsx`/`Login.tsx` components and the 251-line `styles.css` are retired; screens live under
> `src/features/*` and all brand identity is isolated behind `src/brand/` (see
> [`spa-branding.md`](./spa-branding.md)). A Vitest + Testing Library harness was stood up (D14).
> The sections below are retained as the original planning record.

## Why

- **Consistency + accessibility.** shadcn/ui (Radix primitives + Tailwind + `class-variance-authority`) gives
  an accessible, composable baseline instead of bespoke CSS per component.
- **Velocity.** New feature screens (user management, schedule calendar) drop onto a shared component kit and
  layout instead of growing `styles.css`.
- **Opinionated UX (D12).** A clean, modern panel is part of the product wedge, not incidental.

## Scope

- **Bootstrap** Tailwind + shadcn/ui in `apps/web`: `tailwind.config`, `postcss.config`, `components.json`,
  the `@/` path alias (add `resolve.alias` in `vite.config.ts` + `paths` in `tsconfig.json` — neither exists
  today), and base deps (`tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
  Radix packages vendored per-component by the shadcn CLI).
- **Routing: TanStack Router** (decided). No router today; the app switches views by in-memory state
  (`session ? <Dashboard/> : <Login/>`). Introduce route-based navigation so features are addressable.
- **Server state: TanStack Query.** Adopt to replace the manual `fetch` + `setInterval(refresh, 5000)`
  polling hand-rolled in `App.tsx` over the 12-endpoint `api.ts` client — Query gives caching, background
  refetch, and the live-state polling the dashboard already needs. (Adopt when the screen count justifies it;
  the existing `api.ts` functions become query/mutation fns.)
- **App shell + sidebar.** A persistent layout (header + left sidebar nav) above a route outlet, so features
  (Channels, CDN, Users, Schedule, …) are navigable as they grow.
- **Refactor existing UI.** Extract the inline components in `apps/web/src/App.tsx` (`Dashboard`,
  `CreateChannel`, `CdnSettings`, `ChannelCard`, `Endpoint`) and `Login.tsx` into screens/components under
  `src/features/*` (+ `src/components/ui/*` for shadcn primitives), rebuilt on shadcn.

## Current state / anchors

- `apps/web/src/App.tsx` — all UI inline; `Dashboard` polls channels every 5s via `setInterval`.
- `apps/web/src/styles.css` — 251 lines, dark-theme CSS vars (`--bg`, `--panel`, `--accent`, …) → map onto
  shadcn theme tokens during the refactor (keeps the current look as the starting palette; see branding plan).
- `apps/web/src/api.ts` — 12 typed endpoints (channels CRUD, stream keys, CDN) → wrap as Query hooks.
- `apps/web/package.json` — only React + better-auth today; no Tailwind/shadcn/router/query.

## Open decisions

- Adopt TanStack Query immediately vs after the first multi-screen lands (the polling dashboard wants it
  first).
- Component inventory to vendor first: Button, Card, Input, Dialog, Select, Table, Badge, Sidebar/
  NavigationMenu, Calendar (for the schedule view).

Cross-ref: ADR **D15** (shadcn), **D12** (opinionated defaults), [`spa-branding.md`](./spa-branding.md)
(theming/identity).
