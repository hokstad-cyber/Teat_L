# Innhenting av historiske lottotall — kildevurdering og anbefalt løsning

**Omfang:** Norsk Tipping **Lotto** (7 av 34 + tilleggstall) og **Eurojackpot** (5 av 50 + 2 stjernetall), slik appen LykkeTall bruker dem.
**Utarbeidet:** 2026-11-05. Alle «sist kontrollert»-datoer er 2026-11-05 om ikke annet er oppgitt.
**Rolle:** senior dataingeniør / OSINT-analytiker / integrasjonsspesialist.

### Hvordan lese dette dokumentet

Hvert utsagn er merket:

- **[F] Bekreftet faktum** — sett direkte i kilden eller i kildekode jeg har lest i dag.
- **[O] Teknisk observasjon** — rapportert av andre (kildekode, README, søketreff) som jeg ikke har kunnet reprodusere selv.
- **[A] Egen anbefaling/vurdering.**
- **[U] Uverifisert** — måtte kontrolleres, men var ikke tilgjengelig fra dette miljøet.

**Viktig begrensning i undersøkelsen:** Miljøet jeg arbeider i har en nettverkspolicy som nekter tilkobling til `norsk-tipping.no`, `api.norsk-tipping.no`, `api-portal.norsk-tipping.no`, `web.archive.org`, `no.wikipedia.org` og de fleste tredjepartsnettsteder (HTTP CONNECT ble besvart med 403 av utgangsproxyen). Jeg har derfor **ikke** kunnet lese Norsk Tippings robots.txt eller vilkår, ikke sendt et eneste kall til API-et, og ikke sett resultatsidens HTML. Det jeg *har* kunnet gjøre, er å lese kildekoden til flere åpne prosjekter som bruker Norsk Tippings API (via GitHub), lese CSV-filer og README-er på GitHub, og bruke websøk. Punktene som må verifiseres først, står i del I.

---

## A. Kort konklusjon med anbefalt metode

**Hva som er galt i dag [F]:** Appens «Crawl»-funksjon (`js/crawler.js`) bruker endepunktet `www.norsk-tipping.no/api-{spill}/getResultInfo.json?drawID=N`, som stammer fra npm-pakker publisert rundt 2015–2016 (`norsk-tipping`, `norsk-tipping-results`; siste innholdsendring før ompublisering 2022-06-22). Hvis det feiler, forsøker den å tolke resultatsidenes HTML gjennom tredjeparts CORS-speil. Resultatsidene er en JavaScript-applikasjon, og de viser uansett bare de siste 15 ukene [O]. Begge strategiene er skjøre, belaster tredjeparter og gir ikke historikk.

**Anbefaling [A]:**

1. **Primærkilde:** Norsk Tippings eget resultat-API, det som resultatsidene selv henter data fra:
   `GET https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/{lotto|eurojackpot}?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` — uten innlogging eller nøkkel [O], i vinduer på maks ~15 uker per kall [O], hentet **én gang** av et lite Python-verktøy (`tools/hent_lottotall.py`) som kjører lavfrekvent, mellomlagrer alt og validerer hver trekning. Resultatet lagres som versjonert CSV i repoet og **appen leser CSV-en** — nettleseren skal aldri selv kalle Norsk Tipping eller speil.
2. **Uavhengig kontrollkilde:** for Eurojackpot en offentlig CSV på GitHub (`eonurk/EuroJackpot`, 2012-03-23 → 2025-02-25) og/eller Svenska Spel-baserte Lottohistorik; for Lotto en av de etablerte resultatarkivene (multilotto 2011–, lotterytexts/lotteryguru) brukt til stikkprøver, ikke som primærdata.
3. **Reserve:** manuell klipp-og-lim fra Norsk Tippings resultatside (`import`-kommandoen), og — for komplett historikk før API-ets dekning — en **skriftlig forespørsel til Norsk Tipping** om datauttrekk.
4. **Før første produksjonskjøring må to ting bekreftes** (del I): at `robots.txt`/vilkårene ikke forbyr bruken, og at API-et faktisk leverer eldre år (observert én gang: hele perioden fra 2000 ble hentet i desember 2022, før 15-ukersgrensen kom [O]).

Hvorfor dette og ikke scraping: API-et gir strukturert JSON med dato, trekningsnummer, tall i trukket rekkefølge, premienivåer og omsetning — bedre datakvalitet enn noen HTML-side, med én forespørsel per 15 uker i stedet for én per trekning. Scraping av HTML er unødvendig når datakilden bak siden er åpen, og ville dessuten kreve en hodeløs nettleser fordi siden er JavaScript-rendret.

---

## B. Rangert sammenligning av alle aktuelle metoder

| # | Metode | Dekning | Format | Tilgang | Teknisk | Juridisk/vilkår | Kvalitet | Innsats | Automatiserbar | Vedlikehold | Vurdering |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Norsk Tippings resultat-API (`LotteryGameInfo/v2`)** — kildene bak nettsiden | Nåtid og trolig mange år tilbake; eksakt start ukjent [U]. Des. 2022 ble 2000→nå hentet i ett kall [O] | JSON, strukturert | Ingen nøkkel [O] | 15-ukers vindu per kall [O]; rate limit ukjent [U]; CORS åpen (kalles fra nettlesere i åpne prosjekter) [O] | Udokumentert for lotteri (Oddsen-API er dokumentert på api-portal) [O]; vilkår/robots **ikke lest** [U] | Høy: offisielle data, trekkrekkefølge, premier | Lav | Ja | Ja: ukentlig `update` | **Anbefalt primær** |
| 2 | **Forespørsel om datauttrekk fra Norsk Tipping** | Potensielt komplett (1986→) | Det de gir (CSV/Excel) | Avhenger av svar | Ingen | Ryddigst; NT er unntatt offentleglova, men gir innsyn frivillig via presse@ [O] | Høyest | Lav innsats, ukjent ventetid | Nei (engangs) | Manuelt | **Anbefalt for historikk før API-dekning** |
| 3 | **Manuell klipp-og-lim fra resultatsiden** | 15 uker [O] | Tekst → CSV | Ingen | Trivielt | Uproblematisk | Høy, men menneskelig feilrisiko | Lav per uke | Nei | Ukentlig | Reserve/kontroll |
| 4 | **Uavhengige CSV-datasett på GitHub** (Eurojackpot: `eonurk/EuroJackpot`) | 2012-03-23 → 2025-02-25, 829 trekninger [F] | CSV | Åpen | Ingen | Lisens ikke oppgitt [U]; data er fakta (ikke verkshøyde), men sjekk repo-lisens | Ukjent — må krysskontrolleres | Lav | Ja (last ned) | Avhenger av vedlikeholder (stoppet feb. 2025) | Kontrollkilde EJ |
| 5 | **Lottohistorik (frekelof)** — SQLite med Eurojackpot 2012→ og Vikinglotto | EJ fra 2012-03-23 [F] | SQLite/ODS | Åpen | Ingen | Lisens ikke oppgitt [F] | God, svensk kilde | Lav | Delvis (manuelle releaser) | Manuell | Kontrollkilde EJ |
| 6 | **Andre operatørers API-er for Eurojackpot** (Svenska Spel `api.www.svenskaspel.se/external/…`, Veikkaus `veikkaus.fi/api/draw-results/v1/…`) | EJ 2012→ | JSON | Delvis nøkkel (Svenska Spel) [O] | Udokumentert/ustabil [O] | Egne vilkår [U] | Høy for EJ | Middels | Ja | Skjør | Kontrollkilde EJ, ikke Lotto |
| 7 | **Seriøse tredjeparts resultatarkiver** (multilotto: Lotto juni 2011→, 804 trekninger [O]; lotterypros: 2019→ [O]; lotterytexts/lotteryguru: per år [O]) | 2011/2019→ | HTML-sider | Åpen | Paginering per år; JS-grad ukjent [U] | Egne vilkår/robots [U]; innbyrdes uenige om «siste trekning» [O] | Middels | Middels | Ja, med forsiktighet | Skjør | Stikkprøver |
| 8 | **Internet Archive (Wayback)** | Sporadiske øyeblikksbilder | HTML (JS-rendret → ofte tomt) | Åpen, CDX-API | JS-innhold mangler trolig [A] | Tillatt | Lav/ukjent | Høy | Delvis | Nei | Siste utvei for enkelttrekninger |
| 9 | **Scraping av resultatsiden** (dagens løsning) | 15 uker [O] | JS-rendret HTML | Åpen | Krever hodeløs nettleser; CORS-speil | Mulig i strid med vilkår [U]; belaster tredjeparts speil | Lav | Middels | Ja, men skjør | Brekker ved redesign | **Avvikles** |
| 10 | **Gamle `api-{spill}/getResultInfo.json`** (dagens løsning) | — | — | — | Fra 2015-era wrappere; ingen nyere kode bruker det [O] | — | — | — | — | — | **Avvikles** |
| 11 | Åpne data / data.norge.no | Ingen treff [O] | — | — | — | — | — | — | — | — | Ikke relevant |

---

## C. Kilderegister med lenker og dokumentert dekning

| Kilde | URL | Hva | Dekning | Status | Sist kontrollert |
|---|---|---|---|---|---|
| Norsk Tipping — resultat-API | `https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/lotto?fromDate=…&toDate=…` (også `eurojackpot`, `vikinglotto`) | JSON-liste med trekninger | Ukjent start [U]; ≥2000 observert des. 2022 [O] | Brukes av [X104n/lotto](https://github.com/X104n/lotto) (`src/getAPIData.ts`, deler i 15-ukers vinduer) og [Badeklubben](https://github.com/Badeklubben/Badeklubben) (`…/stian/lotteri/lotto/page.tsx`, kommentar: «URL som brukes av Norsk Tipping for å hente ut data om tidligere trekninger»); gist [toremann](https://gist.github.com/toremann/f3c724d658799d43033cef25509abcc3) | 2026-11-05 (kildekode lest; API ikke kalt) |
| Norsk Tipping — resultatsider | `https://www.norsk-tipping.no/lotteri/lotto/resultater`, `…/eurojackpot/resultater` | JS-rendret side | «15 uker tilbake i tid» ifølge NTs kundeservice-side [O] | Ikke nåbar fra dette miljøet | 2026-11-05 (søketreff) |
| Norsk Tipping — API-portal | `https://api-portal.norsk-tipping.no` (dok. for `oddsen-shared-api-1`) | Dokumentasjon | Oddsen-API dokumentert [O]; lotteri-API **ikke bekreftet** dokumentert [U] | Referert i [kristofferblucher/bettingApp](https://github.com/kristofferblucher/bettingApp) og [steingrd/betbot](https://github.com/steingrd/betbot) | 2026-11-05 |
| Norsk Tipping — innsyn | `presse@norsk-tipping.no` | Frivillig innsynsordning | — | Unntatt offentleglova (offentlegforskrifta § 1) [O] | 2026-11-05 (søketreff: presse.no, redaktor.no) |
| Norsk Tipping — regelhistorikk Lotto | artikkel «Disse Lotto-tallene trekkes oftest ut» | 2 tilleggstall 1986–aug. 1997, 3 fra aug. 1997, 1 fra mars 2015 [O]; lansert 19.04.1986 [O] | — | — | 2026-11-05 (søketreff) |
| eonurk/EuroJackpot | `https://raw.githubusercontent.com/eonurk/EuroJackpot/main/eurojackpot_results.csv` | CSV `draw_date,main_numbers,euro_numbers` | 2012-03-23 → 2025-02-25, 829 rader [F] | Lest i dag | 2026-11-05 |
| frekelof/Lottohistorik | `https://github.com/frekelof/Lottohistorik` | SQLite (`lottohistorik_raw.db`) | Eurojackpot 2012-03-23→, Vikinglotto 1993→ (svensk) [F] | README lest | 2026-11-05 |
| Nilzone-/Norsk-Tipping, zrrrzzt/norsk-tipping-results | GitHub/npm | Gamle wrappere mot `api-{spill}/getResultInfo.json` | — | Utdatert (kode fra 2015–16) [F] | 2026-11-05 |
| multilotto, lotterypros, lotterytexts, lotteryguru | se søk | Tredjeparts arkiver for Norge-Lotto | 2011→ / 2019→ / per år [O] | Ikke nåbare herfra | 2026-11-05 (søketreff) |
| beatlottery.co.uk | `/eurojackpot/draw-history` | CSV-eksport krever gratis konto [O] | EJ 2012→ | Ikke nåbar herfra | 2026-11-05 (søketreff) |
| Eurojackpot regelendring | Wikipedia m.fl. | Stjernetall 1–10 → 1–12 og tirsdagstrekning fra mars 2022; første nye trekning fre. 25.03.2022, første tirsdag 29.03.2022 [O]; Norge med fra 01.02.2013 [O] | — | — | 2026-11-05 |

---

## D. Anbefalt teknisk arkitektur

```
┌────────────────────┐   ukentlig (GitHub Actions, søndag natt)      ┌──────────────────────┐
│ Norsk Tipping      │ ───── GET /results/{game}?from&to ──────────► │ tools/hent_lottotall │
│ LotteryGameInfo v2 │   ≤1 kall / 2 s, 15-ukers vinduer, cache      │  .py  (Python 3.11)  │
└────────────────────┘                                               └──────────┬───────────┘
                                                                                │ validér (skjema, epoker,
┌────────────────────┐   stikkprøver / sammenligning                             │ duplikater, hull)
│ Uavhengig kilde    │ ◄──────────────────────────────────────────────────────── │
│ (CSV/SQLite/arkiv) │                                                           ▼
└────────────────────┘                                               ┌──────────────────────┐
                                                                     │ data/lotto.csv       │  versjonert i git
                                                                     │ data/eurojackpot.csv │  (+ .cache/ lokalt)
                                                                     └──────────┬───────────┘
                                                                                │ statisk fil, samme origin
                                                                                ▼
                                                                     ┌──────────────────────┐
                                                                     │ LykkeTall (nettleser)│  ingen nettkall til NT
                                                                     └──────────────────────┘
```

**Prinsipper [A]:**

1. **Innhenting skjer ett sted, sjelden.** Ett verktøy, én planlagt kjøring i uken etter lørdagstrekningen (Lotto) og tirsdag/fredag (Eurojackpot). Sluttbrukeres nettlesere kaller aldri Norsk Tipping — det fjerner CORS-speil, fjerner belastning på NT, og gjør appen offline-tolerant.
2. **Idempotent og mellomlagret.** Hvert API-svar lagres lokalt (SHA-nøkkel per URL). Gjentatte kjøringer koster null kall. `update` henter bare fra siste kjente dato minus 14 dagers overlapp (fanger rettelser).
3. **Validering før lagring.** Hver trekning sjekkes mot spillets regler *i den perioden* (del H). Rader får `validation_status` og `validation_notes`; konflikter mellom ny og eksisterende rad logges og **overskriver aldri** automatisk.
4. **To uavhengige kilder.** Primærdata fra NT; periodisk `compare` mot en uavhengig CSV. Avvik logges til `data/avvik.log` og stopper publisering til de er forklart.
5. **Proveniens i hver rad.** `source`, `source_url`, `fetched_at`, `row_hash` følger med helt inn i appen, som viser det (allerede implementert i appens proveniens-chip).
6. **Høflighet.** Beskrivende `User-Agent` med kontaktpunkt, `Accept: application/json`, maks ett kall per 2 s, eksponentiell tilbaketrekking ved 429/5xx, og **stopp** (ikke omgå) ved 401/403.

**Endring i appen [A]:** `js/crawler.js` erstattes av en enkel lasting av `data/*.csv` (samme origin) med fallback til eksisterende «lim inn / importer». Krawl-knappen kan beholdes som «Oppdater fra datasett».

---

## E. Trinnvis gjennomføringsplan

| Trinn | Handling | Ansvar | Kriterium for ferdig |
|---|---|---|---|
| 0 | **Les `https://www.norsk-tipping.no/robots.txt` og «Kundevilkår og spilleregler»/nettstedsvilkår.** Noter om `api.norsk-tipping.no` eller automatisert bruk omtales. Se også om `api-portal.norsk-tipping.no` lister et lotteri-API med egne vilkår. | Utvikler | Skriftlig notat i `docs/`, dato, sitat |
| 1 | **Send forespørsel til Norsk Tipping** (presse@ eller kundeservice): «Vi lager et åpent, ikke-kommersielt verktøy; finnes det et dokumentert resultat-API eller et datauttrekk med alle Lotto- og Eurojackpot-trekninger? Er bruk av `LotteryGameInfo/v2` tillatt for lavfrekvent, mellomlagret henting?» | Eier | Svar arkivert; ev. uttrekk mottatt |
| 2 | **Prøvekjøring i liten skala:** `fetch --game lotto --from <i fjor>` (≈4 kall). Bekreft svarformat mot `parse_nt_draw`, logg HTTP-headere (rate-limit-headere, `Retry-After`, cache-headere). | Utvikler | 100 % rader `ok` i `validate` |
| 3 | **Finn dekningsstart:** kjør bakover år for år (≈3–4 kall/år) til API-et returnerer tomt. Noter første dato. Stopp ved 4xx. | Utvikler | Dokumentert startdato per spill |
| 4 | **Full innhenting** med `fetch --from <startdato>`; forvent ~3,5 kall/år Lotto (≈130 kall for 2000–2026, ca. 5 min ved 2 s/kall). | Utvikler | CSV lagret, `validate` uten `errors` |
| 5 | **Krysskontroll:** `compare data/eurojackpot.csv eonurk.csv` (etter konvertering) og 20 tilfeldige stikkprøver per spill mot norsk-tipping.no manuelt (siste 15 uker) og mot ett tredjepartsarkiv (eldre). | Utvikler | Avviksrapport; 0 uforklarte avvik |
| 6 | **Fyll hull:** uker uten trekning sjekkes mot kalender (jul/nyttår, flyttede trekninger). Ekte mangler fylles med `import` fra uttrekk (trinn 1) eller manuelt, merket `source=manuell`. | Utvikler | `gaps` tom eller forklart |
| 7 | **Koble appen** til CSV; fjern crawler/speil; behold import/lim inn. | Utvikler | E2E-test grønn |
| 8 | **Automatiser:** GitHub Actions-jobb `update` søndag 03:00 (Lotto) og onsdag/lørdag 03:00 (EJ), som åpner PR ved endringer; feiler ved konflikter eller `errors`. | Utvikler | Første automatiske PR slått sammen |
| 9 | **Overvåk:** hvis svarformatet endres (0 trekninger i et vindu som burde ha data), åpne et issue automatisk; appen viser alder på data. | Drift | Alarm testet |

---

## F. Fungerende Python-eksempel for den beste tillatte metoden

Hele verktøyet ligger i **`tools/hent_lottotall.py`** (kun standardbiblioteket, Python ≥ 3.9). Det er testet offline i dag (`selftest`, `import`, `validate`, `compare`); det live API-kallet kunne ikke kjøres herfra fordi verten er blokkert — det feiler da med en tydelig melding, ikke en omgåelse.

Kjernen — chunking, høflig klient og parsing — i kortform:

```python
API_BASE = "https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/"
CHUNK_DAYS = 15 * 7 - 1            # observert maksvindu per kall
MIN_SECONDS_BETWEEN_CALLS = 2.0

def chunk_ranges(start, end, days=CHUNK_DAYS):
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=days), end)
        yield cur, stop
        cur = stop + timedelta(days=1)

class PoliteClient:                 # mellomlager per URL, ≤1 kall/2 s, backoff på 429/5xx, stopp på 401/403
    def get_json(self, url, use_cache=True): ...

def parse_nt_draw(game, item, source_url):
    # item: {"drawDate": "...", "drawId": 1900, "turnover": "...", "prize": [...],
    #        "winnerNumber": [{"number": "19", "type": 1, "drawOrder": 1}, ...]}  type 1 = hovedtall, 2 = tilleggs-/stjernetall
    ...

def fetch_range(client, game, start, end):
    for a, b in chunk_ranges(start, end):
        url = f"{API_BASE}{game}?fromDate={a}&toDate={b}"
        for item in _extract_draw_list(client.get_json(url)):
            yield parse_nt_draw(game, item, url)
```

Bruk:

```bash
python3 tools/hent_lottotall.py selftest                                   # ingen nett
python3 tools/hent_lottotall.py fetch  --game lotto       --from 2020-01-01 --out data/lotto.csv
python3 tools/hent_lottotall.py fetch  --game eurojackpot --from 2013-02-01 --out data/eurojackpot.csv
python3 tools/hent_lottotall.py update --game lotto --out data/lotto.csv    # ukentlig, bare nye uker
python3 tools/hent_lottotall.py validate data/lotto.csv
python3 tools/hent_lottotall.py compare data/eurojackpot.csv annen_kilde.csv
python3 tools/hent_lottotall.py import --game lotto klipp.txt --out data/lotto.csv   # manuell reserve
```

Verktøyet kjører feltnavnene fra `X104n/lotto/src/types/lotto.ts` (`drawDate`, `drawId`, `gameNo`, `turnover`, `prize[]`, `winnerNumber[{number,type,name,drawOrder}]`) [F], men leter også rekursivt etter trekningslisten i svaret slik at en ny innpakning (`gameResult`, `results`, ren liste) ikke knekker det.

---

## G. Reserveplan dersom hovedkilden endres eller forsvinner

| Scenario | Oppdages ved | Tiltak |
|---|---|---|
| **15-ukersvinduet strammes inn** (f.eks. til 4 uker) | Tomme/avkortede svar i `validate` → `gaps` | Sett `CHUNK_DAYS` ned; verktøyet er allerede vindusbasert |
| **Svarformat endres** (nye feltnavn) | 0 trekninger tolkes; `_extract_draw_list` finner ingen `winnerNumber` | Rekursivt søk tar høyde for ny innpakning; feltnavn justeres ett sted (`parse_nt_draw`). Cache gjør at ingen data går tapt |
| **API krever nøkkel / går bak portal** | 401/403 | Verktøyet stopper. Registrer deg på `api-portal.norsk-tipping.no` hvis lotteri-API tilbys; ellers be om uttrekk (trinn 1). Ikke omgå |
| **Rate limiting (429)** | `Retry-After` | Innebygd backoff; sett frekvens til 1 kall/10 s og kjør om natten |
| **API-et forsvinner helt** | DNS/404 | Ukentlig manuell `import` fra resultatsiden (15 uker buffer gir god tid) + uavhengig CSV for EJ (eonurk/Lottohistorik/Svenska Spel) + forespørsel om uttrekk |
| **Historikk-start viser seg å være sen** (f.eks. bare 5 år) | Trinn 3 | Resten dekkes av uttrekk fra NT (trinn 1) eller, som nest beste, tredjepartsarkiv med dobbel kildekontroll og `source`-merking |
| **Vilkår forbyr bruk** | Trinn 0 | Bruk kun uttrekk/manuell import. Appen fungerer fortsatt (import/lim inn er allerede på plass) |

Datasettet i git er selv en reserve: selv om alle kilder forsvinner, beholder appen alt som er hentet.

---

## H. Testplan og valideringsregler

### Dataskjema (`data/*.csv`)

| Felt | Type | Regel |
|---|---|---|
| `game` | `lotto` \| `eurojackpot` | påkrevd |
| `draw_date` | ISO-dato | påkrevd, ≥ spillets start, ≤ i dag |
| `iso_year`, `iso_week` | int | avledet av `draw_date` (ISO 8601) |
| `draw_id` | int | NTs trekningsnummer (tom for manuelle rader) |
| `main_numbers` | «1 5 12 19 23 28 31» | **sortert stigende**, antall og område per epoke |
| `main_numbers_draw_order` | «19 5 31 …» | trukket rekkefølge (fra `drawOrder`), tom hvis ukjent |
| `bonus_numbers` | «9» / «3 9» | tilleggstall (Lotto) / stjernetall (EJ), sortert |
| `prize_tiers_json` | JSON | premienivåer `[{id,name,value,winners,jackpotAmount}]` |
| `turnover_nok` | string | omsetning som oppgitt |
| `source` | string | `norsk-tipping-api-v2`, `manuell`, `uttrekk-nt`, `tredjepart:<navn>` |
| `source_url` | URL | eksakt forespørsel |
| `fetched_at` | ISO-tid UTC | innhentingstidspunkt |
| `validation_status` | `ok` \| `warning` \| `error` \| `unchecked` | settes av `validate` |
| `validation_notes` | tekst | alle regelbrudd, `;`-separert |
| `row_hash` | hex | sha256 over spill+dato+tall (16 tegn), for diff/duplikatsjekk |

### Epokeregler (innebygd i `GAMES`)

| Spill | Fra | Hovedtall | Tilleggs-/stjernetall | Trekningsdag |
|---|---|---|---|---|
| Lotto | 1986-04-19 | 7 av 1–34 | 2 | lørdag |
| Lotto | 1997-08 (eksakt dato **[U]**) | 7 av 1–34 | 3 | lørdag |
| Lotto | 2015-03 (eksakt dato **[U]**) | 7 av 1–34 | 1 | lørdag |
| Eurojackpot | 2012-03-23 (Norge fra 2013-02-01) | 5 av 1–50 | 2 av 1–10 | fredag |
| Eurojackpot | 2022-03-25 | 5 av 1–50 | 2 av 1–12 | tirsdag + fredag |

### Valideringsregler (implementert i `validate_draw` / `validate_dataset`)

1. **Antall:** eksakt `main_count` hovedtall og `bonus_count` tilleggs-/stjernetall for epoken.
2. **Intervall:** alle tall innenfor `1–main_max` / `1–bonus_max`; ingen duplikater i hovedtall; Lotto-tilleggstall ikke blant hovedtallene.
3. **Rekkefølge:** sortert `main_numbers` må være lik sortert `main_numbers_draw_order` når sistnevnte finnes.
4. **Dato:** ikke før spillstart, ikke i fremtiden; trekningsdag utenfor epokens dager gir `warning` (flyttede trekninger finnes).
5. **Duplikater:** samme `(game, draw_date)` to ganger → feil; identisk tallsett på to datoer → feil (praktisk umulig ved ekte trekninger).
6. **Manglende uker:** hver ISO-uke mellom første og siste dato skal ha minst én trekning; avvik listes som `gaps` og må forklares (helligdager) eller fylles.
7. **To uavhengige kilder:** `compare` rapporterer `only_in_a`, `only_in_b`, `mismatch`, `agree`. Krav før publisering: 0 `mismatch` uten forklaring, og ≥ 95 % av radene bekreftet av en annen kilde for perioder der en annen kilde finnes.
8. **Stikkprøver:** 20 tilfeldige trekninger per spill kontrolleres manuelt mot norsk-tipping.no (siste 15 uker) etter hver fullinnhenting; dokumenteres i `docs/stikkprover.md`.
9. **Loggføring:** alle konflikter (`merge`) og avvik (`compare`) logges med tidsstempel, kilde og begge verdier; automatisk kjøring feiler (exit ≠ 0) ved `errors`, konflikter eller `mismatch`.

### Testplan

| Test | Hvordan | Forventet |
|---|---|---|
| Enhetstester, offline | `python3 tools/hent_lottotall.py selftest` | OK (kjørt i dag) |
| Parsing av ekte svar | lagre ett ekte API-svar som fixture i `tools/fixtures/` etter trinn 2 | 100 % `ok` |
| Vindusgrense | be om 16 uker i ett kall og se om svaret avkortes | dokumentert atferd |
| Rate limit | 10 kall på rad med 2 s mellomrom; logg headere | ingen 429, eller dokumentert grense |
| Idempotens | kjør `update` to ganger | 0 nye rader, 0 kall andre gang (cache) |
| Konflikt | endre ett tall i CSV og kjør `update` | konflikt logget, gammel rad beholdt, exit 1 |
| Hull | fjern én uke fra CSV | `gaps` inneholder uken |
| Epokeskifte | rader 2022-03-18 (stjerne ≤10) og 2022-03-25 (≤12) | begge `ok`; 11/12 før 2022-03-25 → `error` |
| App-integrasjon | appen laster `data/lotto.csv`; proveniens viser kilde/dato | E2E grønn |

---

## I. Ubesvarte spørsmål og forhold som må verifiseres

Alle punktene under kunne ikke avklares fra dette miljøet (vertene er blokkert). De er sortert etter hvor mye de påvirker anbefalingen.

1. **robots.txt og vilkår for `norsk-tipping.no` / `api.norsk-tipping.no`** — forbyr de automatisert henting? Finnes et avsnitt om API-bruk? *(Avgjør om metode 1 kan brukes i det hele tatt.)*
2. **Innholdet på `api-portal.norsk-tipping.no`** — er `LotteryGameInfo` dokumentert der, med egne vilkår, nøkkel eller rate limits? Søk fant kun Oddsen-dokumentasjon (`oddsen-shared-api-1`).
3. **Hvor langt tilbake API-et leverer data** per spill (trinn 3). Én observasjon fra des. 2022 tyder på minst 2000→; dette må måles på nytt.
4. **Faktisk vindusgrense og rate limit** (15 uker er rapportert av én utvikler i 2023; kan ha endret seg).
5. **Eksakt svarformat i dag** — feltnavn er fra kildekode oppdatert i 2025/2026, ikke fra et levende kall.
6. **Eksakte datoer for regelendringene i Lotto** (aug. 1997: 3 tilleggstall; mars 2015: 1 tilleggstall) og om tilleggstallenes rekkefølge/rolle har endret betydning. Påvirker epoke-validering.
7. **Om Lotto alltid har vært trukket på lørdag** og om det har vært ekstra/flyttede trekninger (jul, Supertrekning 19.04.2025 ble nevnt i tilsynssaker) — påvirker «manglende uker»-regelen.
8. **Norges første Eurojackpot-trekning** (01.02.2013 iflg. Wikipedia-kopi) — bestemmer hvilken startdato appen skal bruke for EJ i Norge, selv om trekningene er felles fra 2012.
9. **Lisens for `eonurk/EuroJackpot`** og Lottohistorik — ikke oppgitt. Rene trekningsresultater er fakta uten verkshøyde, men respekter repo-lisens og angi kilde.
10. **Vilkår hos tredjepartsarkiver** (multilotto m.fl.) før de brukes selv til stikkprøver med script.
11. **Wayback-dekning** av resultatsidene — om øyeblikksbildene inneholder tallene (JS-rendret innhold mangler ofte).
12. **Svar fra Norsk Tipping** på forespørselen om uttrekk/tillatelse — det eneste som gir en formelt trygg, komplett historikk fra 1986.

Når punkt 1–3 er avklart, kan trinn 2–4 i planen gjennomføres på under en time.
