/**
 * BRAND COPY & IDENTITY — text half of the swappable brand layer.
 *
 * All product-name / voice strings live here. Features import these constants;
 * they never hard-code the product name. A rebrand edits this file (plus
 * `tokens.css` for colour and `Logo.tsx` for the mark) and nothing else.
 * See docs/plans/spa-branding.md ("How to rebrand").
 */

/** Product name. The only place the wordmark string is defined. */
export const APP_NAME = "Aerial";

/** One-line descriptor shown under the wordmark / on the sign-in screen. */
export const TAGLINE = "Operator control plane";

/** Short pitch shown on the dashboard header. */
export const DASHBOARD_SUBTITLE = "Self-hosted radio. Self-host the brain, rent the edge.";

/** Document/browser-tab title. */
export const APP_TITLE = APP_NAME;
