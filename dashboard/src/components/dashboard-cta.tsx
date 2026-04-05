"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DashboardCta() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href="https://ui.shadcn.com"
        className={cn(buttonVariants())}
        target="_blank"
        rel="noreferrer"
      >
        shadcn docs
      </a>
      <a
        href="https://nextjs.org/docs"
        className={cn(buttonVariants({ variant: "outline" }))}
        target="_blank"
        rel="noreferrer"
      >
        Next.js docs
      </a>
    </div>
  );
}
