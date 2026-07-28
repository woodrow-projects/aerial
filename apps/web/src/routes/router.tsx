import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { ChannelsScreen } from "@/features/channels/ChannelsScreen";
import { CdnScreen } from "@/features/cdn/CdnScreen";

/**
 * Code-based TanStack Router tree (no file-based route generation / vite plugin).
 *
 *   /login            public sign-in (redirects to / when already authed)
 *   shell (pathless)  auth-guarded app layout: header + sidebar + outlet
 *     ├─ /            Channels
 *     └─ /cdn         Delivery / CDN settings
 *
 * Both redirect directions are session-based; see features/auth/auth-redirect.ts.
 */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginScreen,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: () => (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  ),
});

const channelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: ChannelsScreen,
});

const cdnRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/cdn",
  component: CdnScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([channelsRoute, cdnRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
