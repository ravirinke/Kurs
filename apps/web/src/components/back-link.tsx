import { ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

/** "‹ Parent" link at the top of a sub-page, so the way back never depends on the logo. */
export function BackLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground group flex w-fit items-center gap-1 text-sm transition-colors"
    >
      <ChevronLeft
        aria-hidden
        className="size-4 transition-transform group-hover:-translate-x-0.5"
      />{" "}
      {children}
    </Link>
  );
}
