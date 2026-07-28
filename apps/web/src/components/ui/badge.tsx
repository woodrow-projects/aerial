import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        // Neutral outline (matches the old `.badge`).
        default: "border-border bg-transparent text-muted-foreground",
        // Accent/on (old `.badge.on`).
        on: "border-primary bg-transparent text-primary",
        // Danger/off (old `.badge.off`).
        off: "border-destructive bg-transparent text-destructive",
        // Live/success (old `.badge.live`).
        live: "border-live bg-transparent text-live",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
