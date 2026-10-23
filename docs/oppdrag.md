# Oppdrag: Fundamentet til en aksjeliga-app med fiktive penger

> Dette er den opprinnelige oppdragsbeskrivelsen, lagret ordrett. Den er kilden til sannhet for hva vi bygger.
> Avklaringer og avvik som kommer underveis, noteres i `docs/decisions.md`.

Du skal sette opp fundamentet til en app der venner konkurrerer i ligaer ved å handle ekte aksjer med fiktive penger. Dette er et langsiktig prosjekt som først blir en web-app og senere en mobilapp. Kvalitet og riktig arkitektur er viktigere enn fart.

**Arbeidsmåte:** Jobb i faser (se nederst). Start med å lese hele denne prompten, se på skjermbildene i `docs/inspirasjon/` og legge frem en plan. Ikke skriv kode før jeg har godkjent planen. Stopp etter hver fase og oppsummer hva som er gjort, hvilke valg du tok og hva jeg bør teste. Er noe uklart eller i konflikt, spør meg i stedet for å gjette.

**Språk:** Kode, variabelnavn, kommentarer og commits skrives på engelsk. All tekst i brukergrensesnittet skrives på norsk (bokmål), samlet i én fil eller modul slik at vi kan legge til flere språk senere.

---

## 1. Produktet

- Brukere oppretter **ligaer** og inviterer venner med en lenke eller kode.
- Den som oppretter ligaen bestemmer **valuta**, **startsum**, **starttidspunkt** og **sluttidspunkt**, pluss reglene i avsnitt 4.
- Alle medlemmer starter med samme startsum i ligaens valuta og handler aksjer på flere børser.
- **Ledertabellen** rangeres på avkastning i prosent.
- Ved sluttidspunktet fryses resultatet og en **vinner kåres**.
- Kursene hentes fra et ekte API senere. Nå brukes en **mock-provider** bak et grensesnitt.

## 2. Tech stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Språk:** TypeScript i strict mode overalt
- **Web:** Next.js (App Router), Tailwind CSS, shadcn/ui
- **Database:** PostgreSQL via Supabase (lokalt med Supabase CLI), Drizzle ORM med migrasjoner
- **Innlogging:** Supabase Auth (e-post med magic link til å begynne med)
- **Tester:** Vitest
- **Penger:** et desimalbibliotek (decimal.js eller big.js) i TypeScript og `numeric` i Postgres. **Aldri JavaScript-`number` til beløp, kurser eller antall.**
- **Tid:** et bibliotek med full støtte for IANA-tidssoner (for eksempel Luxon). All tid lagres i UTC i databasen. Åpningstider defineres i børsens lokale tid.

Struktur:

```
apps/
  web/            Next.js
  (mobile/)       Expo kommer senere – ikke lag den nå, men ikke lås oss ute
packages/
  core/           all forretningslogikk, ren TypeScript uten avhengighet til Next.js eller databasen
  db/             Drizzle-skjema, migrasjoner, seed-data
  config/         delt tsconfig, eslint, prettier
docs/
  inspirasjon/    skjermbilder (fra meg)
  design.md       designprinsipper (lages av deg i fase 0)
  decisions.md    korte notater om arkitekturvalg
```

All logikk som mobilappen også trenger, skal ligge i `packages/core`: handel, valuta, børstider, verdsettelse, ledertabell og synlighet. Den skal være ren og testbar, uten I/O.

## 3. Kjerneprinsipper som ikke kan fravikes

1. **Transaksjoner er sannheten.** Hver handel, hvert gebyr, hvert utbytte og hver aksjesplitt lagres som en uforanderlig hendelse. Beholdning og kontantsaldo kan alltid regnes ut på nytt fra hendelsene. En materialisert `holdings`-tabell er greit for ytelse, men den skal kunne gjenoppbygges.
2. **Serveren bestemmer prisen.** Klienten sender aldri inn kurs eller beløp, bare instrument, kjøp/salg og antall.
3. **Hver handel er atomisk.** Den kjøres i én databasetransaksjon med radlås på medlemmets saldo (`SELECT … FOR UPDATE`) og en idempotensnøkkel, slik at dobbeltklikk eller samtidige forespørsler aldri kan bruke de samme pengene to ganger.
4. **Kursdata ligger bak et grensesnitt.** Lag `PriceProvider` med for eksempel `getQuote(instrumentId)`, `getFxRate(from, to)`, `getLastClose(instrumentId)` og `getMarketStatus(exchangeId)`, og en `MockPriceProvider` som gir realistiske, deterministiske kurser som beveger seg litt over tid. Resten av appen skal ikke vite hvilken provider som brukes.
5. **Avrunding skjer på definerte steder** med en dokumentert regel (banker's rounding eller half-up, velg og dokumenter), og bare når beløp vises eller bokføres.

## 4. Forretningsregler

### Liga
- Støttede ligavalutaer: NOK, SEK, DKK, EUR, USD.
- Status: `upcoming`, `active` eller `finished`, utledet fra tidspunktene og lagret ved avslutning.
- **Låst etter start:** valuta, startsum, gebyrregler og tillatte børser. Navn, beskrivelse og sluttdato kan endres (sluttdato bare til et tidspunkt i fremtiden).
- **Tillatte børser** velges ved opprettelse. Alle er valgt som standard.
- **Sluttidspunkt** valideres ved opprettelse. Det må ligge etter at alle tillatte børser har stengt den dagen. UI-et foreslår et gyldig tidspunkt.
- **Sen innmelding:** en innstilling som er på som standard. Den som melder seg inn sent, får full startsum. Ingen kan melde seg inn etter at ligaen er avsluttet.
- **Maks antall medlemmer:** standard 50, kan settes av den som oppretter ligaen.
- **Maks andel i én aksje:** valgfri innstilling, av som standard (for eksempel 25 % av porteføljeverdien på kjøpstidspunktet).
- **Shortsalg og belåning:** finnes ikke. Kontantsaldo kan aldri bli negativ.

### Synlighet (velges per liga)
- `open`: alle ser alle beholdninger og handler i sanntid.
- `delayed` (**standard**): andre ser beholdninger og handler med 24 timers forsinkelse.
- `hidden`: andre ser bare avkastning i prosent til ligaen er ferdig.
- Når ligaen er avsluttet, er alt synlig for alle medlemmer.
- Regelen implementeres i `core` som én funksjon, og håndheves på serveren (og med RLS i Supabase), ikke bare i UI-et.

### Børser og åpningstider
- Børser i starten: **Oslo Børs, Nasdaq Stockholm, Nasdaq Copenhagen, Nasdaq (USA), NYSE**. Datamodellen skal gjøre det enkelt å legge til flere.
- Hver børs har tidssone (IANA), handelsvaluta, ordinære åpningstider i lokal tid, en helligdagstabell og halve dager med tidligere stengetid.
- Handel er **kun tillatt i ordinær åpningstid**. Ingen pre-market eller after-hours.
- Seed helligdager og halve dager for 2026 og 2027. **Merk tydelig i koden og i `decisions.md` at datoene må kontrolleres mot børsenes offisielle kalendere**, siden de er satt inn manuelt.
- Ulik sommertid i Europa og USA skal håndteres riktig. Skriv tester for uka der Europa har gått over til vintertid og USA ikke har det ennå. Da åpner Nasdaq 14:30 norsk tid.
- Når børsen er stengt, kan brukeren se aksjer, porteføljen og tabellen. UI-et viser status ("Åpen" eller "Stengt – åpner om 3 t 12 min"). Ordrer legges ikke i kø i denne versjonen, men skjemaet skal ikke hindre det senere.

### Handel: tilbud og bekreftelse
1. Brukeren velger instrument, kjøp eller salg og antall. Serveren lager et **tilbud** med aksjekurs i handelsvaluta, valutakurs til ligavaluta, kurtasje og **totalbeløp i ligavaluta**. Tilbudet lagres med utløp etter **15 sekunder**.
2. Brukeren ser et tydelig prisestimat, for eksempel "10 × 182,40 USD × 10,8421 = 19 776,00 NOK + kurtasje 29,00 NOK = **19 805,00 NOK**", og bekrefter.
3. Serveren utfører handelen til **nøyaktig den låste prisen** hvis tilbudet ikke har utløpt, børsen fortsatt er åpen, ligaen er aktiv, saldoen eller beholdningen holder og alle ligaregler er oppfylt. Ellers avvises handelen med en tydelig årsak, og UI-et tilbyr et nytt tilbud.
4. Både aksjekurs og valutakurs lagres på transaksjonen, slik at vi senere kan skille avkastning fra aksjen og fra valuta.
- **Kurtasje** er en ligainnstilling med prosent og minstebeløp i ligavaluta. Standard er 0,05 % med minimum NOK 29 / SEK 29 / DKK 19 / EUR 3 / USD 3.
- **Brøkdelsaksjer** er en ligainnstilling som er av som standard (bare hele aksjer).
- Bare markedsordrer i denne versjonen. Strukturer koden slik at limit-ordrer kan legges til senere.

### Verdsettelse og ledertabell
- Porteføljeverdi = kontanter + Σ (antall × kurs × valutakurs til ligavaluta).
- Er børsen stengt, brukes **siste sluttkurs**, og **valutakursen fryses på tidspunktet børsen stengte**, slik at tabellen står stille i helger og når børsen er stengt.
- Rangering etter avkastning i prosent: (verdi − startsum) / startsum.
- **Uavgjort:** den som har eldst siste handel rangeres høyest (den som "låste" resultatet først). Dokumenter regelen og vis den i UI-et.
- **Daglige snapshots** av porteføljeverdi per medlem, for grafer og "dagens endring".

### Avslutning av liga
- En jobb (cron-endepunkt, som kan kjøres manuelt lokalt) kjører etter sluttidspunktet: den fryser alle porteføljer på sluttkurs og fryste valutakurser, lagrer endelig plassering per medlem, kårer vinneren og setter status til `finished`.
- Resultatet lagres og **regnes aldri ut på nytt**.
- Jobben skal være idempotent, slik at den kan kjøres flere ganger uten å endre noe.

### Selskapshendelser
- **Aksjesplitt (må være med):** justerer antall og snittkost slik at porteføljeverdien er uendret. Ellers ser en 10:1-splitt ut som et tap på 90 %.
- **Utbytte:** godskrives som kontanter, omregnet til ligavaluta på betalingsdagen, til alle som eide aksjen på eks-dato.
- Begge lagres som hendelser. Mock-provideren skal kunne simulere dem, slik at de kan testes.

## 5. Datamodell (forslag, forbedre gjerne)

`profiles`, `leagues` (valuta, startsum, start/slutt, status, synlighet, kurtasjeregler, brøkdelsaksjer, sen innmelding, maks medlemmer, maks andel, invitasjonskode, eier), `league_allowed_exchanges`, `league_members` (kontantsaldo, innmeldt tidspunkt, endelig plassering og verdi), `exchanges`, `exchange_trading_hours`, `exchange_holidays`, `instruments` (ticker, ISIN, navn, børs, valuta), `quotes` (låste tilbud med utløp), `transactions` (type: buy/sell/fee/dividend/split, antall, kurs, valutakurs, beløp i ligavaluta, idempotensnøkkel), `holdings` (materialisert), `prices`, `fx_rates`, `corporate_actions`, `portfolio_snapshots`.

Lag RLS-policyer i Supabase slik at brukere bare ser ligaer de er medlem av, og bare ser andres beholdninger i tråd med synlighetsregelen.

## 6. Design: inspirert av Nordnet, men ikke en kopi

I `docs/inspirasjon/` ligger skjermbilder fra Nordnet-appen. **Start fase 0 med å se på dem** og skriv `docs/design.md` med:
- hvilke **mønstre** som gjør Nordnet oversiktlig, for eksempel informasjonshierarki, hvordan porteføljeverdi og dagens endring fremheves, hvordan beholdninger listes, aksjesiden med graf og periodevalg, og kjøpsflyten med tydelig estimat
- hva vi tar med oss og hva vi bevisst gjør annerledes
- **vår egen visuelle identitet:** fargepalett, typografi, avstander, komponenter, mørk og lys modus

Regler:
- Ta inspirasjon fra **struktur, flyt og informasjonsdesign**, ikke fra utseendet. **Ikke kopier** Nordnets logo, navn, merkefarger, ikoner, illustrasjoner, tekster eller nøyaktige layout.
- Appen skal føles som et eget produkt. Den har også noe Nordnet ikke har: **ligaer og konkurranse**. Ligaen er sentrum i appen, med tabell, plassering, nedtelling til slutt og hvem som stiger og faller.
- **Mobil først**, men god på desktop.
- Grønt og rødt for opp og ned, men aldri bare farge alene. Bruk også fortegn og pil (tilgjengelighet).
- Tall formateres norsk: `19 805,00 kr`, `+2,34 %`.
- Det skal være tydelig i appen at det er fiktive penger.

Bruk et midlertidig app-navn (for eksempel "Aksjeliga") samlet på ett sted, så det er lett å bytte.

## 7. Faser

**Fase 0 – Analyse og plan:** se på skjermbildene, skriv `docs/design.md` og legg frem en plan med eventuelle spørsmål. **Vent på godkjenning.**

**Fase 1 – Monorepo og verktøy:** pnpm, Turborepo, delt TS-, eslint- og prettier-konfig, Vitest, lokal Supabase, `.env.example`, README med oppstartsinstruksjoner og en `CLAUDE.md` med konvensjonene fra denne prompten.

**Fase 2 – `packages/core` med tester:** pengetyper og avrunding, børstider og markedsstatus, valutaomregning, tilbudsberegning med kurtasje, validering av handel mot ligaregler, verdsettelse med frysing ved stengt børs, ledertabell med uavgjortregel, synlighetsregel, ligastatus og -livssyklus, splitt og utbytte, og `PriceProvider` med mock. **Dette er den viktigste fasen. Testene skal dekke minst:**
- sommertid-uka der Europa og USA har ulik tid, helligdag, halv dag, og helg
- et tilbud som utløper eller der børsen stenger mellom tilbud og bekreftelse
- for lite saldo, salg av mer enn man eier, brøkdel når det ikke er tillatt, og maks andel overskredet
- avrunding og kurtasje (prosent mot minstebeløp)
- splitt som gir uendret verdi, og utbytte i en annen valuta enn ligaens
- uavgjort i ledertabellen
- synlighet for hvert nivå før og etter slutt

**Fase 3 – `packages/db`:** skjema, migrasjoner, RLS, seed (børser, åpningstider, helligdager, cirka 30 kjente aksjer fordelt på børsene, et par testbrukere og en testliga). Skriv en test for samtidighet som viser at to samtidige kjøp ikke kan bruke de samme pengene.

**Fase 4 – `apps/web`:** innlogging, mine ligaer, opprett liga (med alle innstillinger og gode standardverdier), bli med via lenke eller kode, ligaside (tabell, nedtelling, medlemmer), søk og aksjeside (mock-graf, markedsstatus), kjøp/salg med tilbud og bekreftelse, portefølje per liga, og innstillinger for ligaeieren. Handel kjøres som server actions eller route handlers som kaller `core`.

**Fase 5 – Jobber:** cron-endepunkter for daglige snapshots, avslutning av liga og behandling av selskapshendelser. Alle skal være idempotente og kunne kjøres manuelt lokalt.

## 8. Utenfor omfang nå
Ekte kurs-API, Expo-app, limit-ordrer og ordrekø, push-varsler, chat og sosiale funksjoner utover ligaen, betaling, og flere språk enn norsk.

## 9. Ferdig betyr
`pnpm install && pnpm dev` starter alt lokalt etter README-en. `pnpm test`, `pnpm typecheck` og `pnpm lint` går grønt. Jeg kan logge inn, opprette en liga, invitere en testbruker, handle norske og amerikanske aksjer med riktig valutaomregning, bli avvist når børsen er stengt, se tabellen og kjøre avslutningsjobben og se en vinner.
