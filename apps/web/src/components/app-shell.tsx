import type { ComponentType } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { Cloud, LogOut, Radio } from "lucide-react";
import { Logo, TAGLINE } from "@/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOut } from "@/auth-client";

/** Persistent header: brand mark + sign-out. Router-free so it renders anywhere. */
export function Header() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <Logo />
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => signOut({ fetchOptions: { onSuccess: () => location.assign("/") } })}
      >
        <LogOut className="size-4" />
        Sign out
      </Button>
    </header>
  );
}

type NavEntry = { to: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean };

const NAV: NavEntry[] = [
  { to: "/", label: "Channels", icon: Radio, exact: true },
  { to: "/cdn", label: "Delivery", icon: Cloud },
];

function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border p-3 sm:block">
      <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {TAGLINE}
      </p>
      <nav className="grid gap-1">
        {NAV.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
            activeProps={{
              className: cn("bg-secondary text-secondary-foreground"),
            }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/** App layout: header on top, sidebar nav on the left, routed screen in the outlet. */
export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto w-full max-w-4xl flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
