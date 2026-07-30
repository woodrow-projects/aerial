import { useState } from "react";
import { cn } from "@/lib/utils";
import { PlaylistsPanel } from "./PlaylistsPanel";
import { ClocksPanel } from "./ClocksPanel";

/**
 * Programming admin screen (plan Phase E) — the Auto-DJ building blocks. Two
 * sections: Playlists (the track pools) and Clockwheels (the ordered, repeating
 * rotations that arrange them). Reads are open; all mutations are admin-only
 * server-side (403 for streamers), surfaced inline by each panel. Polls nothing —
 * mutations invalidate the affected queries.
 */

type Tab = "playlists" | "clocks";

const TABS: { id: Tab; label: string }[] = [
  { id: "playlists", label: "Playlists" },
  { id: "clocks", label: "Clocks" },
];

export function ProgrammingScreen() {
  const [tab, setTab] = useState<Tab>("playlists");

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Programming</h1>
        <p className="text-sm text-muted-foreground">
          Build the Auto-DJ: pools of tracks and the clockwheels that rotate them.
        </p>
      </div>

      <div role="tablist" aria-label="Programming sections" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "playlists" ? <PlaylistsPanel /> : <ClocksPanel />}
    </div>
  );
}
