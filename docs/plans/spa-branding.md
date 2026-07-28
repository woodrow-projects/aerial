# Plan: SPA branding & visual identity

> **Status: deferred.** The operator has a visual-identity concept to detail later; captured here so it isn't
> lost. No work until the concept lands.

When picked up, this covers the brand layer for the operator SPA (and any future public surfaces): name and
voice, logo/mark, colour palette, typography, iconography, and empty/loading states. It rides on the
[`spa-ui-foundation.md`](./spa-ui-foundation.md) stack — brand tokens map onto the shadcn/Tailwind theme
variables (the dark-theme CSS vars formerly in the retired `apps/web/src/styles.css`, now carried verbatim
into `apps/web/src/brand/tokens.css`, are the current, unbranded starting palette).

Cross-ref: [`spa-ui-foundation.md`](./spa-ui-foundation.md), ADR D15, SPEC §7 (opinionated-UX differentiator).

## How to rebrand (the containment contract)

The SPA foundation (D15) isolates **all** brand identity behind `apps/web/src/brand/`. A full rebrand — e.g.
the owner's future "backspin" identity — edits only the files below and touches **no feature/component code**.
A CI-enforced scan (`apps/web/src/brand/brand-leak.spec.ts`) fails the build if the product name, a raw hex,
or an `oklch()` colour appears in any source file **outside** `src/brand/`, so the boundary can't silently rot.

**Touchpoints (the complete list):**

1. **`apps/web/src/brand/tokens.css`** — the entire colour palette. The only file allowed to contain raw
   colour values. `:root` holds the semantic tokens (`--background`, `--primary`, `--live`, `--destructive`,
   `--border`, `--radius`, …); everything else consumes them as Tailwind/shadcn utilities (`bg-background`,
   `text-muted-foreground`, `border-border`). `src/index.css` only aliases these via `@theme inline` — it
   holds no raw colour. Add a light theme here (a second block + a `.dark`/toggle) if desired.
2. **`apps/web/src/brand/brand.ts`** — copy identity: `APP_NAME`, `TAGLINE`, `DASHBOARD_SUBTITLE`,
   `APP_TITLE`. Features import these constants; the name is never hard-coded elsewhere.
3. **`apps/web/src/brand/Logo.tsx`** — the mark/wordmark component. Today an icon + `{APP_NAME}` text; swap the
   icon for an inline `<svg>` or a data-URI `<img>` and restyle here. Renders `APP_NAME` so the name isn't
   duplicated as a literal.
4. **`apps/web/index.html` `<title>`** — a static file, so it can't read `brand.ts` at build time; it is set
   literally to `Aerial` and must be updated **by hand** on rebrand (keep it in sync with `APP_TITLE`). This
   is the one deliberate, documented exception to "brand lives only in `src/brand/`".
5. **Favicon** — none is set today (no `<link rel="icon">` in `index.html`). When a mark exists, add the
   favicon link in `index.html` (a static-file touchpoint, like the title) pointing at an asset under
   `apps/web/public/`.

Everything else — the shadcn primitives in `src/components/ui/`, the app shell, and every feature screen —
is brand-agnostic and needs no edits.
