# Designprinsipper – Aksjeliga (arbeidsnavn)

Status: utkast fra fase 0. Oppdateres når vi bygger UI i fase 4.

## 1. Hva vi så i inspirasjonen

Grunnlag: tre skjermbilder fra Nordnet-appen i `docs/inspirasjon/` – aksjesiden (to nesten like bilder) og kjøpsarket. Vi har **ikke** skjermbilder av oversikt/portefølje, så mønstrene for porteføljeforsiden under bygger på generell kunnskap, ikke på bildene.

### Mønstre som gjør det oversiktlig

**Aksjesiden (IMG_9145/9146)**

- **Tydelig hierarki ovenfra og ned:** børs-merkelapp → navn → kurs (stort, med valuta i mindre skrift rett etter) → endring → graf → periodevalg → faner → handlingsknapper. Øyet trenger aldri å lete etter kursen.
- **Endring vises som både prosent og absolutt beløp** på én linje, med kontekst ("Ved stenging"). Konteksten forteller _hvilken_ kurs du ser på – viktig når børsen er stengt.
- **Børsen vises som en egen «pille» øverst.** Gir umiddelbart kontekst for valuta og åpningstid.
- **Grafen fyller hele bredden**, uten rutenett, med y-akse til høyre og få etiketter. Linjen bærer informasjonen; alt annet er dempet.
- **Periodevalg som også viser avkastning per periode** (1 d, 1 u, 1 m, 3 m, Maks – hver med %). Det er smart: du ser utviklingen i alle perioder uten å trykke.
- **Kjøp/Selg som to store, faste knapper nederst**, innenfor tommelrekkevidde, alltid synlige.
- **Bunnmeny med fem faner** for hovedområdene.

**Kjøpsarket (IMG_9147)**

- **Bunnark (bottom sheet)** over en kontekst-side, slik at du ser instrumentet mens du handler.
- **Kompakt topp** med navn, kurs og endring – du mister aldri hva du handler.
- **Antall med −/+ stepper**, store trykkflater.
- **Totalbeløp inkl. avgifter** står rett over bekreftknappen, med «?» for forklaring.
- Bekreftknappen bruker samme farge som handlingen (kjøp).

### Hva vi tar med oss

- Hierarkiet på aksjesiden: navn → stor kurs → endring med kontekst → graf → periodevalg.
- Periodevalg som viser avkastning i hver periode.
- Faste handlingsknapper nederst på mobil.
- Bunnark for handel med antall-stepper og totalbeløp rett over bekreftknappen.
- Kontekstmerking av kursen ("Ved stenging", "Sanntid (fiktiv)") – blir enda viktigere hos oss fordi verdien fryses når børsen er stengt.

### Hva vi bevisst gjør annerledes

| Nordnet                         | Oss                                                                                                    | Hvorfor                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Kontoen/porteføljen er sentrum  | **Ligaen er sentrum.** Forsiden er «mine ligaer», og inne i en liga er tabellen første fane            | Konkurransen er produktet                              |
| Ordredybde, limit, pris-stepper | Bare antall. Pris settes av serveren                                                                   | Kun markedsordrer; klienten sender aldri pris          |
| Totalsum som én linje           | **Fullt regnestykke** «10 × 182,40 USD × 10,8421 = 19 776,00 NOK + kurtasje 29,00 NOK = 19 805,00 NOK» | Lærerikt og etterprøvbart; valuta er en del av spillet |
| Ordren sendes direkte           | **To steg: tilbud → bekreft**, med synlig 15-sekunders nedtelling og «Hent ny pris» når den utløper    | Låst pris, ingen overraskelser                         |
| Turkis/rosa for opp/ned         | Grønn/rød **pluss fortegn og pil** (▲ +2,34 % / ▼ −1,10 %)                                             | Tilgjengelighet, og vi skal ikke ligne                 |
| Førhandel/etterhandel           | Kun ordinær åpningstid. Tydelig status «Åpen» / «Stengt – åpner om 3 t 12 min»                         | Forretningsregel                                       |
| Ekte penger                     | **Fiktive penger merkes tydelig** (se §4)                                                              | Ikke misvisende                                        |
| Nyheter, forum, analytikere     | Ikke med nå                                                                                            | Utenfor omfang                                         |

## 2. Informasjonsarkitektur

**Bunnmeny (mobil), sidemeny (desktop ≥ 1024 px):**

1. **Ligaer** – mine ligaer, opprett, bli med (forside)
2. **Søk** – finn aksjer (innenfor valgt liga)
3. **Portefølje** – min portefølje i valgt liga
4. **Profil** – navn, innstillinger, logg ut

Det finnes alltid en **aktiv liga** (velges øverst via en ligavelger). Søk og Portefølje gjelder den aktive ligaen, fordi kontantsaldo, valuta og tillatte børser er per liga.

**Ligasiden** (sentrum):

- Topp: liganavn, status-merke (Kommende / Aktiv / Avsluttet), **nedtelling til slutt** («3 d 4 t igjen»).
- «Min plassering»-kort: plass X av Y, avkastning, verdi, dagens endring, bevegelse siden i går (▲2 plasser).
- Faner: **Tabell** · **Aktivitet** (handler, i tråd med synlighet) · **Om ligaen** (regler, uavgjortregel, invitasjonslenke).
- Tabellrad: plassering, navn/avatar, avkastning i % (hovedtall), dagens bevegelse i plasser (▲/▼/–). Egen rad markeres og festes nederst hvis den er utenfor skjermen.
- Avsluttet liga: pall for topp 3 og «Vinner»-merke; resultatet merkes som endelig.

**Porteføljesiden:**

- Hero: **total verdi** (største tall på siden), avkastning siden start (% og kr), dagens endring.
- Kontantsaldo som egen linje («Kontanter: 41 200,00 kr»).
- Beholdninger som liste: navn + ticker/børs til venstre; verdi i ligavaluta og avkastning til høyre. Kompakte rader, ingen kort-i-kort.

**Aksjesiden:** som beskrevet i §1, pluss en rad med «Du eier: 12 stk · verdi 21 300 kr» når du har beholdning.

## 3. Visuell identitet

Retning: **«Klubbhus»** – varm, sporty og litt leken (det er en konkurranse mellom venner), men med presise, rolige tall (det er fortsatt penger, selv om de er fiktive). Merkefargen er **dyp fiolett/indigo** med **gull** som aksent for plassering og vinnere. Ingen turkis/magenta (Nordnets uttrykk).

### Farger (tokens)

Definert som CSS-variabler i shadcn-stil (`--background`, `--foreground`, `--primary` …) slik at mørk og lys modus bytter ved å bytte variabler. Verdiene under er utgangspunkt og justeres for kontrast (WCAG AA, 4.5:1 for tekst) når vi bygger.

| Token              | Lys                        | Mørk      | Bruk                                          |
| ------------------ | -------------------------- | --------- | --------------------------------------------- |
| `background`       | `#F7F6F2` (varm off-white) | `#0F1115` | Sidebakgrunn                                  |
| `surface`          | `#FFFFFF`                  | `#181B21` | Kort, ark, rader                              |
| `surface-muted`    | `#EEECE6`                  | `#22262E` | Inputfelt, piller, valgt periode              |
| `foreground`       | `#16181D`                  | `#F2F2F0` | Primærtekst                                   |
| `muted-foreground` | `#5E636E`                  | `#9AA0AB` | Sekundærtekst, akser                          |
| `border`           | `#E2DFD7`                  | `#2A2E37` | Skillelinjer                                  |
| `primary`          | `#4B3FD1` (indigo)         | `#8E86FF` | Merkefarge, primærknapper, lenker, valgt fane |
| `accent-gold`      | `#B7860B`                  | `#E8B931` | Plassering 1, vinner, pall                    |
| `positive`         | `#15803D`                  | `#3DD68C` | Opp, kjøp                                     |
| `negative`         | `#C62828`                  | `#FF6B6B` | Ned, selg                                     |
| `warning`          | `#B45309`                  | `#F5A524` | Tilbud snart utløpt, børs stengt              |

Regler for opp/ned:

- **Aldri bare farge:** alltid fortegn (`+` / `−`, ekte minustegn U+2212) og pil (▲ / ▼). Null vises nøytralt: `0,00 %` uten pil.
- Kjøp-knapp: fylt `positive`. Selg-knapp: fylt `negative`. Begge har tekst («Kjøp», «Selg»).

### Typografi

- **Brødtekst og tall:** Inter (variabel), via `next/font` (selvhostet).
- **Overskrifter og store tall:** Bricolage Grotesque – gir egen karakter uten å bli uleselig.
- **Alle tall bruker `font-variant-numeric: tabular-nums`** slik at kolonner står rett og tall ikke «hopper» ved oppdatering.
- Skala (rem): 0,75 · 0,875 · 1 (brødtekst) · 1,125 · 1,5 · 2 · 2,75 (hero-tall). Valuta vises i ca. 55 % av tallets størrelse rett etter tallet.

### Avstander, form og bevegelse

- 4 px-grid: 4, 8, 12, 16, 24, 32, 48. Sidemarg mobil 16 px.
- Radius: 12 px på kort og ark, 999 px på piller og knapper.
- Trykkflater minst 44 × 44 px.
- Lette overganger (150–200 ms). Respekter `prefers-reduced-motion`. Tallendring kan «tikke» kort, men aldri for beløp i bekreftelsen.

### Komponenter (shadcn/ui som grunnlag, stylet med våre tokens)

- `MoneyText`, `PercentChange` (fortegn + pil + farge), `MarketStatusBadge`, `CountdownBadge`
- `LeagueCard`, `LeaderboardRow`, `RankMovement`, `Podium`
- `HoldingRow`, `PortfolioHero`
- `PriceChart` (linje + svak flate, periodevalg med % per periode)
- `TradeSheet` (bunnark mobil, dialog desktop) med `QuoteBreakdown` og utløpsnedtelling
- `FakeMoneyBanner`

### Mobil først, god på desktop

- Mobil: én kolonne, bunnmeny, faste Kjøp/Selg-knapper nederst på aksjesiden.
- Desktop: sidemeny, innhold maks ~1200 px. Ligasiden får tabell og «min plassering» side om side; aksjesiden får graf til venstre og handelspanel til høyre i stedet for bunnark.

## 4. Fiktive penger – tydelig merket

- Fast, diskret merke i toppen: «Fiktive penger» (pille med spillbrikke-ikon).
- Handelsbekreftelsen sier «Kjøp for fiktive penger» i undertekst.
- Innloggingssiden og «opprett liga» forklarer det i én setning.

## 5. Tallformat

- `Intl.NumberFormat('nb-NO')`, men samlet i én formateringsmodul (ikke spredt i komponenter).
- Beløp: `19 805,00 kr` (NOK), andre valutaer med kode: `182,40 USD`.
- Prosent: `+2,34 %` (mellomrom før %, fortegn alltid).
- Valutakurs: 4 desimaler (`10,8421`).
- Tid: `23. okt. 14:30`, alltid i brukerens tidssone (standard Europe/Oslo), mens børsens lokale tid vises i parentes der det er relevant.

## 6. Navn og tekst

- Appnavnet («Aksjeliga») ligger kun i `apps/web/src/i18n/nb.ts` (eller tilsvarende) og leses derfra overalt.
- All UI-tekst ligger i samme modul, strukturert per område (`league.*`, `trade.*`, `market.*` …).
- Tone: vennlig og direkte, du-form. Avvisninger forklarer årsak og neste steg («Børsen stengte før du bekreftet. Hent ny pris når den åpner i morgen 09:00.»).
