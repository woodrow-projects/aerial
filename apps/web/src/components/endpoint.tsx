import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A labelled, click-to-copy endpoint row (the old `.endpoint`). Clicking the
 * value copies it to the clipboard — the operator's fastest path to paste an
 * HLS/Icecast/ingest URL into their own frontend or source software.
 */
export function Endpoint({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={copy}
        title="click to copy"
        className={cn(
          "group flex min-w-0 items-center gap-2 overflow-x-auto rounded-md border border-border bg-input-surface px-2 py-1 text-left font-mono text-xs text-foreground",
        )}
      >
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-live" />
        ) : (
          <Copy className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
    </div>
  );
}
