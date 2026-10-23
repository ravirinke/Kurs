"use client";

import { Copy, Share2 } from "lucide-react";
import { toast } from "sonner";

import { t } from "@/i18n";

import { Button } from "./ui/button";

/** Shows the invite code big, and shares the invite link (native share sheet on mobile). */
export function ShareInvite({ code, leagueName }: { code: string; leagueName: string }) {
  const link = () => `${window.location.origin}/bli-med/${code}`;

  async function share() {
    const url = link();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: leagueName,
          text: t.league.about.shareText(leagueName),
          url,
        });
        return;
      } catch {
        // Cancelled or not allowed: fall back to copying.
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success(t.league.about.copied);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t.league.about.code}</span>
          <span className="font-mono text-3xl font-bold tracking-[0.2em]" data-testid="invite-code">
            {code}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t.league.about.copy}
            onClick={() =>
              void navigator.clipboard
                .writeText(link())
                .then(() => toast.success(t.league.about.copied))
            }
          >
            <Copy aria-hidden />
          </Button>
          <Button type="button" onClick={() => void share()}>
            <Share2 aria-hidden /> {t.league.about.share}
          </Button>
        </div>
      </div>
    </div>
  );
}
