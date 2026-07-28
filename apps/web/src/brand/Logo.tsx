import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "./brand";

/**
 * BRAND MARK — the visual half of the swappable brand layer.
 *
 * Today: an icon + text wordmark styled with theme tokens. A rebrand replaces
 * the mark here (swap the icon for an <svg>/<img> data-URI, restyle the
 * wordmark) without touching any feature code. The rendered text is always
 * {APP_NAME} from `brand.ts` so the name never gets duplicated as a literal.
 */
export function Logo({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <Radio className="size-5 text-primary" aria-hidden />
      {showName && <span className="text-lg text-foreground">{APP_NAME}</span>}
    </span>
  );
}
