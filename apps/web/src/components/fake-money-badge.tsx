import { Coins } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** Always visible reminder that nothing here is real money. */
export function FakeMoneyBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        className,
      )}
      title={t.app.fakeMoneyExplainer}
    >
      <Coins aria-hidden className="size-3.5" />
      {t.app.fakeMoney}
    </span>
  );
}
