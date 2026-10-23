"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page from the server every `seconds` while it is visible, so prices,
 * values and countdowns stay fresh while markets are open.
 */
export function AutoRefresh({
  seconds = 60,
  enabled = true,
}: {
  seconds?: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [router, seconds, enabled]);
  return null;
}
