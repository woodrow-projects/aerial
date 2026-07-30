import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { ChannelsScreen } from "@/features/channels/ChannelsScreen";
import { CdnScreen } from "@/features/cdn/CdnScreen";
import { MediaScreen } from "@/features/media";
import { ProgrammingScreen } from "@/features/programming";
import { ScheduleScreen } from "@/features/schedule";
import { UsersScreen } from "@/features/users";

/**
 * Code-based TanStack Router tree (no file-based route generation / vite plugin).
 *
 *   /login            public sign-in (redirects to / when already authed)
 *   shell (pathless)  auth-guarded app layout: header + sidebar + outlet
 *     ├─ /            Channels
 *     ├─ /media        Media library (Auto-DJ tracks)
 *     ├─ /programming  Playlists & clockwheels
 *     ├─ /schedule     Weekly show calendar
 *     ├─ /users        Users, roles & streamer keys
 *     └─ /cdn          Delivery / CDN settings
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

const mediaRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/media",
  component: MediaScreen,
});

const programmingRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/programming",
  component: ProgrammingScreen,
});

const scheduleRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/schedule",
  component: ScheduleScreen,
});

const usersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/users",
  component: UsersScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    channelsRoute,
    mediaRoute,
    programmingRoute,
    scheduleRoute,
    usersRoute,
    cdnRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
