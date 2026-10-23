# Aksjeliga

En app der venner konkurrerer i ligaer ved å handle ekte aksjer med **fiktive penger**.
Arbeidsnavnet «Aksjeliga» ligger i `apps/web/src/i18n/nb.ts` og kan byttes der.

- Oppdraget: [`docs/oppdrag.md`](docs/oppdrag.md)
- Design: [`docs/design.md`](docs/design.md)
- Arkitekturvalg: [`docs/decisions.md`](docs/decisions.md)

## Krav

| Verktøy        | Versjon | Merknad                           |
| -------------- | ------- | --------------------------------- |
| Node.js        | 24      | Se `.nvmrc`                       |
| pnpm           | 12      | Aktiveres med corepack (se under) |
| Docker Desktop | nyeste  | Må kjøre for lokal Supabase       |

## Kom i gang

```bash
# 1. Aktiver pnpm (én gang per maskin).
#    Gir «EPERM» på Windows? Legg til: --install-directory "%APPDATA%\npm"
corepack enable pnpm

# 2. Installer avhengigheter
pnpm install

# 3. Lag miljøfil (verdiene er standardverdiene for lokal Supabase)
cp .env.example .env

# 4. Start lokal Supabase (Docker Desktop må kjøre). Første gang tar det noen minutter.
pnpm db:start

# 5. Lag tabellene og fyll inn testdata (børser, aksjer, testbrukere og en testliga)
pnpm db:reset

# 6. Start appen
pnpm dev
```

Åpne deretter:

| Hva                                           | Adresse                |
| --------------------------------------------- | ---------------------- |
| Appen                                         | http://localhost:3000  |
| Supabase Studio (database-GUI)                | http://localhost:54323 |
| Mailpit (innloggingslenker havner her lokalt) | http://localhost:54324 |

Stopp Supabase med `pnpm db:stop` når du er ferdig.

## Testdata

`pnpm db:reset` sletter den lokale databasen, kjører alle migrasjoner og fyller inn:

- **5 børser** med åpningstider, helligdager og halve dager for 2026–2027
- **33 aksjer**: Oslo (10), Stockholm (6), København (5), Nasdaq (7) og NYSE (5)
- **3 testbrukere**: `ola@test.no`, `kari@test.no` og `per@test.no`. Logg inn med magic link; e-posten havner i Mailpit (http://localhost:54324).
- **«Testligaen»** (NOK, startet for en uke siden, slutter om en måned). Ola eier den, Kari er med, og begge har handlet. Per er ikke med: bruk invitasjonskoden **`TESTLIGA`** for å teste sen innmelding med godkjenning.

⚠️ Helligdager, halve dager og ISIN-koder er lagt inn manuelt og må kontrolleres mot offisielle kilder før appen tas i bruk på ordentlig.

## Skript

Kjøres fra rotmappen. Turborepo kjører dem i alle pakker.

| Skript                                    | Hva det gjør                                           |
| ----------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                | Starter web-appen i utviklingsmodus                    |
| `pnpm build`                              | Bygger alt for produksjon                              |
| `pnpm test`                               | Enhetstester (Vitest), uten database                   |
| `pnpm test:db`                            | Tester mot lokal database (krever `pnpm db:start`)     |
| `pnpm typecheck`                          | Sjekker typer (TypeScript strict)                      |
| `pnpm lint`                               | ESLint                                                 |
| `pnpm format` / `pnpm format:check`       | Prettier: formater / sjekk                             |
| `pnpm db:start` / `db:stop` / `db:status` | Lokal Supabase                                         |
| `pnpm db:reset`                           | Tom database, alle migrasjoner og testdata             |
| `pnpm db:seed`                            | Fyller inn testdata (trygt å kjøre flere ganger)       |
| `pnpm db:generate`                        | Lager en ny migrasjon etter endring i Drizzle-skjemaet |

## Struktur

```
apps/
  web/          Next.js (App Router), Tailwind, shadcn/ui
packages/
  core/         All forretningslogikk. Ren TypeScript, ingen I/O.
  db/           Drizzle-skjema, migrasjoner, seed
  config/       Delt tsconfig, ESLint, Prettier og Vitest
supabase/       Lokal Supabase-konfig og migrasjoner (SQL)
docs/           Oppdrag, design og beslutninger
```

## Feilsøking

- **`pnpm db:start` feiler med «Cannot connect to the Docker daemon»:** start Docker Desktop og vent på «Engine running».
- **`pnpm test:db` feiler med «connect ECONNREFUSED»:** Supabase kjører ikke. Kjør `pnpm db:start`.
- **Port opptatt:** en annen Supabase-instans kjører kanskje. Kjør `pnpm db:stop`, eller `pnpm exec supabase stop --all`.
