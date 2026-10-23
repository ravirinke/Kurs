/**
 * All user-facing text (Norwegian Bokmål). The app name lives here too, so renaming the
 * product is a one-line change. Add new languages as sibling files with the same shape.
 */
export const nb = {
  app: {
    name: "Aksjeliga",
    tagline: "Konkurrer med vennene dine på ekte aksjer – med fiktive penger.",
    fakeMoney: "Fiktive penger",
    fakeMoneyExplainer: "Alle beløp i appen er fiktive. Ingen ekte penger handles.",
  },
  home: {
    comingSoon: "Vi bygger fortsatt. Ligaer, handel og ledertabell kommer snart.",
  },
} as const;

export type Messages = typeof nb;
