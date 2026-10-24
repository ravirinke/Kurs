# Arkitektur

Hvordan Kurs er bygget og fungerer **i dag** (etter fase 5). Dokumentet beskriver dagens tilstand, ikke historikken. Hvorfor ting er som de er, står i [`decisions.md`](decisions.md), og hva vi skal bygge, i [`oppdrag.md`](oppdrag.md).

Holdes oppdatert: endres noe her i en fase, oppdateres dette dokumentet i samme fase.

## Kort om appen

Venner lager **ligaer**, inviterer hverandre med en lenke eller kode og handler ekte aksjer med **fiktive penger**. Alle starter med samme sum i ligaens valuta. Ledertabellen rangerer på avkastning i prosent, og når ligaen er slutt, fryses resultatet og en vinner kåres.

Kursene kommer foreløpig fra en **mock-provider** som lager realistiske, men oppdiktede kurser. Ekte kurser kommer i fase 6, publisering i fase 7.

## Delene

```
                ┌──────────────────────────────────────────────┐
  Nettleser ───▶│ apps/web  (Next.js)                           │
                │  sider leser · server actions skriver · cron  │
                └───────────────┬──────────────────────────────┘
                                │ kaller
                ┌───────────────▼──────────────────────────────┐
                │ packages/db  (Drizzle)                        │
                │  tjenester · jobber · repositories · skjema   │
                └───────┬───────────────────────────┬──────────┘
                        │ bruker reglene i          │ SQL
                ┌───────▼──────────────┐    ┌───────▼──────────┐
                │ packages/core        │    │ PostgreSQL        │
                │  ren forretnings-    │    │ (Supabase: Auth,  │
                │  logikk, ingen I/O   │    │  RLS, migrasjoner)│
                └──────────────────────┘    └──────────────────┘
```

| Del                 | Ansvar                                                                                                                                                                                                                         | Hva den ikke gjør                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`packages/core`** | All forretningslogikk: penger og avrunding, valuta, børstider, pristilbud og kurtasje, regler for handel, verdsettelse, ledertabell, synlighet, ligaens livsløp, splitt og utbytte, og grensesnittet `PriceProvider` med mock. | Ingen database, nettverk, Next.js eller React (ESLint stopper det). Leser aldri klokka selv; «nå» sendes alltid inn. Skal brukes av mobilappen senere. |
| **`packages/db`**   | Databaseskjema, migrasjoner, tjenester som leser og skriver (`createQuote`, `executeTrade`, `createLeague`, `loadLeaderboard` …), jobbene og testdata.                                                                         | Ingen egne forretningsregler: den spør `core`.                                                                                                         |
| **`apps/web`**      | Sidene, server actions som kaller tjenestene, innlogging, cron-endepunktet og den ene stedet som bestemmer hvilken `PriceProvider` som brukes (`src/server/prices.ts`).                                                        | Ingen forretningslogikk og ingen direkte SQL.                                                                                                          |
| **`supabase/`**     | Lokal Supabase (Postgres, Auth, Mailpit) og alle SQL-migrasjoner.                                                                                                                                                              |                                                                                                                                                        |

All tekst brukeren ser, ligger i `apps/web/src/i18n/nb.ts`, og all formatering av tall og datoer i `apps/web/src/lib/format.ts`.

## Penger, kurser og valuta

- **Aldri flyttall.** Beløp, kurser, valutakurser og antall er `decimal.js` i TypeScript og `numeric` i Postgres, og går mellom dem som tekst.
- **Avrunding** er «halv opp», og bare når et beløp bokføres eller vises. Mellomregninger har full presisjon.
  - Bokførte beløp: 2 desimaler. Låste kurser: opptil 4. Låste valutakurser: 6.
  - Databasen har kontroller som avviser for mange desimaler i stedet for å runde av i stillhet.
- **Én kontantsaldo per medlem**, i ligaens valuta. Kjøp i en annen valuta regnes om med valutakursen i det øyeblikket handelen skjer.
- **Kurtasje** = størst av (beløp × sats) og minstebeløpet. Snittkost inkluderer kurtasje.
- **Hele aksjer.** Antall lagres likevel som `numeric`, så brøkdeler kan innføres senere.

## Et kjøp, fra knappetrykk til transaksjon

1. **Tilbud.** Brukeren velger aksje, kjøp eller salg og antall (eller et beløp, som serveren gjør om til flest mulig hele aksjer). Nettleseren sender **aldri** en pris. Serveren henter kurs og valutakurs fra `PriceProvider`, regner ut kurtasje og totalsum, sjekker reglene og lagrer tilbudet. Det er gyldig i 30 sekunder og kan bare brukes én gang.
2. **Bekreftelse.** Brukeren bekrefter prisen de ser. `executeTrade` gjør så alt i **én databasetransaksjon**:
   - låser medlemmets rad (`SELECT … FOR UPDATE`), så samme medlems handler skjer én om gangen og to samtidige kjøp ikke kan bruke de samme pengene
   - sjekker en **idempotensnøkkel**, så et dobbeltklikk eller et nytt forsøk gir det opprinnelige resultatet i stedet for en ny handel
   - låser tilbudet og sjekker at det ikke er brukt
   - bygger opp medlemmets beholdning fra transaksjonene og sjekker reglene på nytt, med fersk børsstatus
   - skriver transaksjonen, markerer tilbudet som brukt og oppdaterer hurtigbufferen for kontanter og beholdning
3. **Reglene** (i `core`):
   - ligaen må være aktiv og børsen tillatt i ligaen
   - børsen må være åpen
   - kjøperen må ha nok penger, og selgeren nok aksjer
   - grensen for hvor stor andel én aksje kan utgjøre, sjekkes bare ved kjøp
   - en aksje med en splitt som ikke er bokført ennå, kan ikke handles av den som eier den (`SPLIT_PENDING`)

   Brudd gir en kode, og webappen oversetter koden til norsk.

Låserekkefølgen er alltid **medlem, så tilbud**. Det hindrer vranglås (deadlock).

## Transaksjoner er sannheten

- Alt som påvirker en portefølje, er en hendelse i `transactions`: innskudd, kjøp, salg, gebyr, utbytte og splitt.
- Tabellen kan **bare få nye rader**. En trigger blokkerer endring og sletting, også for serveren. Feil rettes med en ny korrigerende hendelse.
- Kontanter og beholdning kan alltid bygges opp på nytt fra hendelsene (`replay` i `core`). Tabellen `holdings` og kontantsaldoen på medlemmet er bare hurtigbuffer.
- Følge av dette: en liga med transaksjoner kan ikke slettes.

## Verdsettelse og ledertabell

- **Porteføljeverdi** = kontanter + summen av (antall × kurs × valutakurs til ligavalutaen).
- **Når børsen er åpen**, brukes siste kurs. **Når den er stengt**, brukes sluttkursen, og valutakursen fryses på tidspunktet børsen stengte. Tabellen står derfor stille om natten og i helgene.
- **Rangering** etter avkastning i prosent: (verdi − startsum) / startsum.
- **Uavgjort:**
  - Den som har eldst siste handel, rangeres høyest.
  - Medlemmer med lik avkastning som aldri har handlet, deler plassen, og kommer etter dem som har handlet.
  - Delt førsteplass gir flere vinnere.
  - Plassene nummereres 1, 1, 3.
- **«I dag»** betyr siden midnatt norsk tid, og regnes ut fra hendelsene og historiske kurser.

## Ligaens livsløp

- **Status** lagres ikke, men regnes ut fra tidspunktene: kommende, aktiv, ferdig eller avlyst. Handelen stopper i det øyeblikket sluttidspunktet passeres.
- **Bli med:** før start går det direkte med lenke eller kode. Etter start må eieren godkjenne, og den som godkjennes, får full startsum.
- **Eieren:**
  - kan endre navn, beskrivelse og sluttidspunkt. Alt annet er låst når ligaen har startet.
  - kan fjerne medlemmer. De mister tilgang og kan aldri bli med igjen, men transaksjonene deres blir liggende.
  - kan avlyse ligaen før den har startet.
- **Avslutning:** når ligaen er slutt, lagres sluttresultatet (`finalized_at`, plassering, verdi, avkastning og vinner per medlem) én gang, og regnes aldri ut på nytt. Se «Jobber».

## Synlighet og sikkerhet

- **Synlighet velges per liga.** Den styrer om man ser hva andre eier og har handlet. Avkastning og plassering er alltid synlig for medlemmer.
  - **Åpen:** alt er synlig med en gang.
  - **Forsinket:** beholdning og handler vises slik de var for 24 timer siden.
  - **Skjult:** bare avkastning og plassering vises.
  - Man ser alltid alt om seg selv, og når ligaen er ferdig, ser alle alt.
- **Regelen finnes ett sted i `core`** (`resolvePortfolioAccess`), og er speilet i SQL (`portfolio_access_rule`) for databasens radsikkerhet (RLS). En test sjekker at de to alltid gir samme svar.
- **Nettleseren kan bare lese, og bare gjennom RLS.** Den ser bare ligaer den er medlem av, og andres porteføljer bare i tråd med synlighetsregelen. Kontantsaldo og tidspunkt for siste handel er skjult med kolonnerettigheter.
- **All skriving går gjennom serveren.** Den bruker en direkte databasetilkobling som går forbi RLS, så tjenestene håndhever reglene selv via `core`.
- **Innlogging:** magic link på e-post (Supabase Auth). Første gang velger man et visningsnavn.

## Kurser: `PriceProvider`

- Alle kurser, valutakurser, åpningsstatus, kurshistorikk og selskapshendelser hentes **bare gjennom grensesnittet `PriceProvider`**. Ingen annen kode vet hvilken kilde som brukes.
- **Hvilken provider** som brukes, bestemmes på ett sted: `apps/web/src/server/prices.ts`.
- **I dag** er det `MockPriceProvider`: deterministiske kurser som beveger seg realistisk innenfor åpningstidene, med splittjustert historikk.
- **Fra fase 6:** serveren henter ekte kurser og lagrer dem i databasen (tabellene `prices` og `fx_rates`, som er tomme i dag), og brukerne leser alltid derfra. Da holder vi oss innenfor gratisgrensene, og en kilde som er nede gir bare eldre kurser, ikke manglende.
- **Børsene** (Oslo, Stockholm, København, Nasdaq og NYSE) har åpningstider definert i børsens lokale tid. Helligdager og halve dager ligger i `core` og legges inn i databasen av seed-skriptet. Alt lagres i UTC.

## Jobber

Tre bakgrunnsjobber i `packages/db/src/jobs`. Alle **tåler å kjøres flere ganger** uten å endre noe.

| Jobb                  | Hva den gjør                                                                                                                                                                                                                                                                                                             | Hvorfor den er trygg å kjøre på nytt                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selskapshendelser** | Henter splitter og utbytte fra `PriceProvider` for aksjer som er kjøpt i aktive eller nylig avsluttede ligaer, og lagrer dem. Bokfører dem når de er forfalt: splitt fra starten av første dag med ny kurs, utbytte på betalingsdagen til dem som eide aksjen ved starten av eks-datoen, omregnet med dagens valutakurs. | Låser medlemmet som ved handel, og en unik indeks tillater bare én transaksjon per medlem per hendelse.                                         |
| **Avslutning**        | Verdsetter porteføljene på sluttidspunktet og lagrer plassering, verdi, avkastning og vinner(e). Bokfører først hendelser som forfalt før slutt. Utbytte som betales etter slutt, teller ikke.                                                                                                                           | Låser ligaen og gjør ingenting når resultatet finnes. Verdiene gjelder sluttidspunktet, så resultatet blir det samme uansett når jobben kjører. |
| **Snapshots**         | Lagrer verdi, kontanter og avkastning per medlem ved slutten av hver ferdige dag (norsk tid). Fyller inn opptil 31 dager som mangler.                                                                                                                                                                                    | Én rad per medlem per dag. Finnes raden, hoppes den over.                                                                                       |

- **Kjøring:** én gang i døgnet kl. 06:30 norsk tid, i rekkefølgen over, via `GET /api/cron/daily` med `Authorization: Bearer <CRON_SECRET>`. Hver jobb har også sitt eget endepunkt.
- **Avslutning ved behov:** en liga som er slutt, avsluttes også med en gang noen åpner den eller forsiden.
- **Lokalt:** `pnpm jobs` eller «Kjør jobber nå» på profilsiden (se README).

## Datamodell

| Tabell                                                                    | Innhold                                                                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                                                                | Visningsnavn per bruker (brukerne selv ligger i Supabase Auth).                                                                                 |
| `leagues`, `league_allowed_exchanges`                                     | Ligaens innstillinger, tidspunkter, invitasjonskode, eier, `finalized_at` og `cancelled_at`.                                                    |
| `league_members`                                                          | Medlemskap, innmeldingstidspunkt, hurtigbuffer for kontanter og siste handel, sluttresultat, `removed_at`. Raden er også låsen hver handel tar. |
| `league_join_requests`                                                    | Forespørsler om å bli med etter start.                                                                                                          |
| `exchanges`, `exchange_trading_hours`, `exchange_holidays`, `instruments` | Børser, åpningstider, helligdager og aksjer.                                                                                                    |
| `quotes`                                                                  | Låste pristilbud (30 sekunder, brukes én gang).                                                                                                 |
| `transactions`                                                            | **Sannheten.** Alle hendelser, kan bare få nye rader.                                                                                           |
| `holdings`                                                                | Hurtigbuffer for beholdning, bygges fra transaksjonene.                                                                                         |
| `corporate_actions`                                                       | Splitter og utbytte rapportert av `PriceProvider`.                                                                                              |
| `portfolio_snapshots`                                                     | Daglig verdi per medlem.                                                                                                                        |
| `prices`, `fx_rates`                                                      | Til lagrede ekte kurser (fase 6). Tomme i dag.                                                                                                  |
| `simulated_corporate_actions`                                             | Bare til utvikling: simulerte hendelser for mock-provideren.                                                                                    |

Skjemaet skrives i Drizzle (`packages/db/src/schema`), og tabellene genereres som migrasjoner. Sikkerhet (RLS, rettigheter, triggere og SQL-funksjoner) skrives for hånd i egne migrasjoner. En migrasjon som er kjørt, endres aldri; man lager en ny.

## Tid

- Alt lagres i UTC.
- Åpningstider defineres i børsens tidssone og regnes ut med Luxon.
- Maskinens tidssone brukes aldri i logikk.
- Webappen henter «nå» fra `serverNow()`. Med `ALLOW_TIME_TRAVEL=1` kan tidsmaskinen på profilsiden flytte klokka. Den er alltid av i produksjon.

## Tester

| Kommando        | Hva den tester                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`     | Enhetstester av `core` (regler, penger, børstider, ledertabell, synlighet, splitt og utbytte) og webappens formatering, tolking av tall og tekster. Uten database. |
| `pnpm test:db`  | Tjenester og jobber mot ekte lokal database: samtidige kjøp, idempotens, RLS, at synlighetsregelen er lik i TypeScript og SQL, og jobbene.                         |
| `pnpm test:e2e` | Hele flyten i en ekte nettleser: innlogging, liga, invitasjon, handel i NOK og USD, stengt børs, og avslutning med vinner.                                         |

Alle må være grønne før en fase er ferdig.
