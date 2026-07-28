import * as React from "react";
import { cn } from "@/lib/utils";

/** The old `.error` banner: destructive-tinted panel for surfaced API errors. */
export function ErrorNote({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive-foreground",
        className,
      )}
      {...props}
    />
  );
}
