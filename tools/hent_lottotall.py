#!/usr/bin/env python3
"""
hent_lottotall.py — hent, validér og vedlikehold historiske vinnertall for
Norsk Tipping Lotto og Eurojackpot.

Datakilde (primær): Norsk Tippings eget resultat-API, det samme som
resultatsidene på norsk-tipping.no bruker:

    GET https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/{game}
        ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD

Observert i åpne kildekoder (ikke offisielt dokumentert):
  * Ingen innlogging eller API-nøkkel.
  * Ett kall dekker maks ~15 uker (X104n/lotto README, sommeren 2023) —
    derfor deles perioden i 15-ukers vinduer.
  * Svar: JSON med en liste trekninger. Hver trekning har drawDate, drawId,
    gameNo, turnover, prize[], winnerNumber[{number, type, name, drawOrder}]
    der type 1 = hovedtall og type 2 = tilleggstall/stjernetall.

Dette er et uoffisielt grensesnitt: sjekk robots.txt og Norsk Tippings
vilkår før bruk, hold frekvensen lav, mellomlagre alt, og ha en manuell
reserveløsning (--import) klar. Se docs/DATAINNHENTING-HISTORISKE-TALL.md.

Bruk:
    python3 tools/hent_lottotall.py fetch --game lotto --from 2020-01-01 --out data/lotto.csv
    python3 tools/hent_lottotall.py fetch --game eurojackpot --from 2013-02-01 --out data/eurojackpot.csv
    python3 tools/hent_lottotall.py update --game lotto --out data/lotto.csv        # bare nye uker
    python3 tools/hent_lottotall.py validate data/lotto.csv
    python3 tools/hent_lottotall.py compare data/eurojackpot.csv annen_kilde.csv    # uavhengig kilde
    python3 tools/hent_lottotall.py import --game lotto klipp.txt --out data/lotto.csv  # manuell reserve
    python3 tools/hent_lottotall.py selftest

Kun standardbiblioteket; ingen avhengigheter.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

log = logging.getLogger("hent_lottotall")

API_BASE = "https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/"
USER_AGENT = "LykkeTall-datainnhenting/1.0 (+https://github.com/hokstad-cyber/Teat_L; kontakt via repo)"
CHUNK_DAYS = 15 * 7 - 1          # observert maksgrense per kall
MIN_SECONDS_BETWEEN_CALLS = 2.0  # høflig frekvens: maks ett kall per 2 s
MAX_RETRIES = 4
CACHE_DIR = Path(".cache/norsk-tipping")

# ---------------------------------------------------------------------------
# Spillregler per periode (brukes til validering). Kilder i dokumentet.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Era:
    start: date
    main_count: int
    main_max: int
    bonus_count: int
    bonus_max: int
    draw_weekdays: tuple  # 0 = mandag … 5 = lørdag


GAMES = {
    "lotto": {
        "api_game": "lotto",
        "eras": [
            # 19.04.1986: 7 hovedtall av 34, 2 tilleggstall
            Era(date(1986, 4, 19), 7, 34, 2, 34, (5,)),
            # august 1997: 3 tilleggstall (Norsk Tipping-artikkel). Eksakt dato: VERIFISER.
            Era(date(1997, 8, 1), 7, 34, 3, 34, (5,)),
            # mars 2015: 1 tilleggstall (Norsk Tipping-artikkel). Eksakt dato: VERIFISER.
            Era(date(2015, 3, 1), 7, 34, 1, 34, (5,)),
        ],
    },
    "eurojackpot": {
        # X104n/lotto henter Eurojackpot som spillet "eurojackpot all"; "eurojackpot" er reserve.
        "api_game": "eurojackpot all",
        "api_game_alt": ["eurojackpot"],
        "eras": [
            # 23.03.2012: 5 av 50 + 2 stjernetall av 10, fredag. Norge med fra feb. 2013.
            Era(date(2012, 3, 23), 5, 50, 2, 10, (4,)),
            # 25.03.2022: stjernetall 1–12; tirsdagstrekning fra 29.03.2022
            Era(date(2022, 3, 25), 5, 50, 2, 12, (1, 4)),
        ],
    },
}


def era_for(game: str, d: date) -> Era:
    eras = GAMES[game]["eras"]
    current = eras[0]
    for e in eras:
        if d >= e.start:
            current = e
    return current


# ---------------------------------------------------------------------------
# Datamodell
# ---------------------------------------------------------------------------

CSV_FIELDS = [
    "game", "draw_date", "iso_year", "iso_week", "draw_id",
    "main_numbers", "main_numbers_draw_order", "bonus_numbers",
    "prize_tiers_json", "turnover_nok",
    "source", "source_url", "fetched_at",
    "validation_status", "validation_notes", "row_hash",
]


@dataclass
class Draw:
    game: str
    draw_date: date
    main_numbers: list            # sortert stigende
    main_numbers_draw_order: list # i trukket rekkefølge (tom hvis ukjent)
    bonus_numbers: list           # sortert stigende
    draw_id: Optional[int] = None
    prize_tiers: list = field(default_factory=list)
    turnover_nok: Optional[str] = None
    source: str = ""
    source_url: str = ""
    fetched_at: str = ""
    validation_status: str = "unchecked"
    validation_notes: str = ""

    @property
    def iso_year_week(self) -> tuple:
        y, w, _ = self.draw_date.isocalendar()
        return y, w

    def key(self) -> tuple:
        return (self.game, self.draw_date.isoformat())

    def row_hash(self) -> str:
        payload = f"{self.game}|{self.draw_date}|{self.main_numbers}|{self.bonus_numbers}"
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def to_row(self) -> dict:
        y, w = self.iso_year_week
        return {
            "game": self.game,
            "draw_date": self.draw_date.isoformat(),
            "iso_year": y,
            "iso_week": w,
            "draw_id": self.draw_id if self.draw_id is not None else "",
            "main_numbers": " ".join(map(str, self.main_numbers)),
            "main_numbers_draw_order": " ".join(map(str, self.main_numbers_draw_order)),
            "bonus_numbers": " ".join(map(str, self.bonus_numbers)),
            "prize_tiers_json": json.dumps(self.prize_tiers, ensure_ascii=False) if self.prize_tiers else "",
            "turnover_nok": self.turnover_nok or "",
            "source": self.source,
            "source_url": self.source_url,
            "fetched_at": self.fetched_at,
            "validation_status": self.validation_status,
            "validation_notes": self.validation_notes,
            "row_hash": self.row_hash(),
        }

    @staticmethod
    def from_row(r: dict) -> "Draw":
        nums = lambda s: [int(x) for x in s.split()] if s else []
        return Draw(
            game=r["game"],
            draw_date=date.fromisoformat(r["draw_date"]),
            main_numbers=nums(r.get("main_numbers", "")),
            main_numbers_draw_order=nums(r.get("main_numbers_draw_order", "")),
            bonus_numbers=nums(r.get("bonus_numbers", "")),
            draw_id=int(r["draw_id"]) if r.get("draw_id") else None,
            prize_tiers=json.loads(r["prize_tiers_json"]) if r.get("prize_tiers_json") else [],
            turnover_nok=r.get("turnover_nok") or None,
            source=r.get("source", ""),
            source_url=r.get("source_url", ""),
            fetched_at=r.get("fetched_at", ""),
            validation_status=r.get("validation_status", "unchecked"),
            validation_notes=r.get("validation_notes", ""),
        )


# ---------------------------------------------------------------------------
# HTTP med høflighet, mellomlager og tilbakeholdenhet
# ---------------------------------------------------------------------------

class PoliteClient:
    def __init__(self, cache_dir: Path = CACHE_DIR, min_interval: float = MIN_SECONDS_BETWEEN_CALLS):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.min_interval = min_interval
        self._last = 0.0

    def get_json(self, url: str, use_cache: bool = True) -> object:
        key = hashlib.sha256(url.encode()).hexdigest()
        cache_file = self.cache_dir / f"{key}.json"
        if use_cache and cache_file.exists():
            log.debug("cache-treff %s", url)
            return json.loads(cache_file.read_text("utf-8"))

        for attempt in range(1, MAX_RETRIES + 1):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json;charset=utf-8",
            })
            self._last = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read().decode("utf-8")
                data = json.loads(body)
                cache_file.write_text(body, "utf-8")
                return data
            except urllib.error.HTTPError as e:
                # 429/503: respekter Retry-After og trekk oss tilbake eksponentielt.
                if e.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                    retry_after = e.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else 5 * 2 ** attempt
                    log.warning("HTTP %s fra %s — venter %.0f s (forsøk %d/%d)", e.code, url, delay, attempt, MAX_RETRIES)
                    time.sleep(delay)
                    continue
                if e.code in (401, 403):
                    raise RuntimeError(
                        f"HTTP {e.code}: tilgang nektet. Ikke forsøk å omgå dette — "
                        "sjekk vilkår/robots.txt eller be Norsk Tipping om datauttrekk."
                    ) from e
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < MAX_RETRIES:
                    delay = 5 * 2 ** attempt
                    log.warning("Nettverksfeil %s — venter %.0f s", e, delay)
                    time.sleep(delay)
                    continue
                raise
        raise RuntimeError("uventet: tom retry-løkke")


# ---------------------------------------------------------------------------
# Parsing av Norsk Tipping-svaret
# ---------------------------------------------------------------------------

def _extract_draw_list(data: object) -> list:
    """Svaret er observert som et objekt der én verdi er listen med trekninger.
    Vi godtar også en ren liste, og leter rekursivt etter objekter med winnerNumber."""
    found = []

    def walk(x):
        if isinstance(x, dict):
            if "winnerNumber" in x and "drawDate" in x:
                found.append(x)
                return
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(data)
    return found


def parse_nt_draw(game: str, item: dict, source_url: str) -> Draw:
    raw_date = str(item.get("drawDate", ""))
    # Observert ISO-ish ("2024-03-16" eller "2024-03-16T19:00:00…"); vær romslig.
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw_date) or re.match(r"(\d{4})(\d{2})(\d{2})", raw_date)
    if not m:
        raise ValueError(f"ukjent datoformat: {raw_date!r}")
    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    mains, bonus = [], []
    for wn in item.get("winnerNumber", []) or []:
        n = int(str(wn.get("number")).strip())
        order = wn.get("drawOrder")
        t = wn.get("type")
        if t == 1:
            mains.append((order if isinstance(order, int) else 10**6, n))
        elif t == 2:
            bonus.append((order if isinstance(order, int) else 10**6, n))
        else:
            log.warning("ukjent winnerNumber.type=%r på %s", t, d)
    mains.sort()
    bonus.sort()
    prize = []
    for p in item.get("prize", []) or []:
        prize.append({k: p.get(k) for k in ("id", "name", "value", "winners", "jackpotAmount") if k in p})

    return Draw(
        game=game,
        draw_date=d,
        main_numbers=sorted(n for _, n in mains),
        main_numbers_draw_order=[n for _, n in mains] if all(o != 10**6 for o, _ in mains) else [],
        bonus_numbers=sorted(n for _, n in bonus),
        draw_id=int(item["drawId"]) if str(item.get("drawId", "")).isdigit() else None,
        prize_tiers=prize,
        turnover_nok=str(item["turnover"]) if item.get("turnover") not in (None, "") else None,
        source="norsk-tipping-api-v2",
        source_url=source_url,
        fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )


def chunk_ranges(start: date, end: date, days: int = CHUNK_DAYS) -> Iterable[tuple]:
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=days), end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def fetch_range(client: PoliteClient, game: str, start: date, end: date, use_cache: bool = True) -> list:
    variants = [GAMES[game]["api_game"]] + GAMES[game].get("api_game_alt", [])
    chosen = None
    out = []
    for a, b in chunk_ranges(start, end):
        log.info("henter %s %s → %s", game, a, b)
        items = []
        url = ""
        for name in ([chosen] if chosen else variants):
            url = API_BASE + urllib.parse.quote(name) + f"?fromDate={a.isoformat()}&toDate={b.isoformat()}"
            try:
                data = client.get_json(url, use_cache=use_cache and b < date.today())
            except urllib.error.HTTPError as e:
                log.warning("variant %r svarte HTTP %s", name, e.code)
                continue
            items = _extract_draw_list(data)
            if items:
                chosen = name
                break
        if not items:
            log.warning("ingen trekninger i svaret for %s–%s (kan være før dekningsstart, eller endret svarformat)", a, b)
        for it in items:
            try:
                out.append(parse_nt_draw(game, it, url))
            except Exception as e:  # én dårlig trekning skal ikke stoppe alt
                log.error("klarte ikke tolke trekning %r: %s", it.get("drawDate"), e)
    return out


# ---------------------------------------------------------------------------
# Validering
# ---------------------------------------------------------------------------

def validate_draw(d: Draw) -> list:
    """Returnerer liste med feilmeldinger (tom = OK)."""
    errs = []
    era = era_for(d.game, d.draw_date)
    if d.draw_date < GAMES[d.game]["eras"][0].start:
        errs.append(f"dato før spillets start ({GAMES[d.game]['eras'][0].start})")
    if d.draw_date > date.today():
        errs.append("dato i fremtiden")
    if len(d.main_numbers) != era.main_count:
        errs.append(f"{len(d.main_numbers)} hovedtall, forventet {era.main_count}")
    if len(set(d.main_numbers)) != len(d.main_numbers):
        errs.append("dupliserte hovedtall")
    if any(not (1 <= n <= era.main_max) for n in d.main_numbers):
        errs.append(f"hovedtall utenfor 1–{era.main_max}")
    if len(d.bonus_numbers) != era.bonus_count:
        errs.append(f"{len(d.bonus_numbers)} tilleggs-/stjernetall, forventet {era.bonus_count}")
    if any(not (1 <= n <= era.bonus_max) for n in d.bonus_numbers):
        errs.append(f"tilleggs-/stjernetall utenfor 1–{era.bonus_max}")
    if d.game == "lotto" and set(d.main_numbers) & set(d.bonus_numbers):
        errs.append("tilleggstall overlapper hovedtall")
    if d.draw_date.weekday() not in era.draw_weekdays:
        errs.append(f"uvanlig trekningsdag ({d.draw_date.strftime('%A')}) — kan være flyttet trekning, kontroller")
    if d.main_numbers_draw_order and sorted(d.main_numbers_draw_order) != d.main_numbers:
        errs.append("trukket rekkefølge stemmer ikke med hovedtallene")
    return errs


def validate_dataset(draws: list) -> dict:
    """Validerer hver rad, finner duplikater og manglende uker. Setter status på radene."""
    report = {"rows": len(draws), "ok": 0, "errors": 0, "warnings": 0, "duplicates": [], "gaps": []}
    seen_keys, seen_sets = {}, {}
    for d in draws:
        errs = validate_draw(d)
        hard = [e for e in errs if "uvanlig trekningsdag" not in e]
        if hard:
            d.validation_status = "error"
            report["errors"] += 1
        elif errs:
            d.validation_status = "warning"
            report["warnings"] += 1
        else:
            d.validation_status = "ok"
            report["ok"] += 1
        d.validation_notes = "; ".join(errs)

        k = d.key()
        if k in seen_keys:
            report["duplicates"].append(f"{k}: samme dato to ganger")
        seen_keys[k] = d
        s = (d.game, tuple(d.main_numbers), tuple(d.bonus_numbers))
        if s in seen_sets and seen_sets[s] != d.draw_date:
            # Identisk tallsett på to datoer er astronomisk usannsynlig → nesten alltid datafeil.
            report["duplicates"].append(f"{d.game} {d.draw_date} har identiske tall som {seen_sets[s]}")
        seen_sets.setdefault(s, d.draw_date)

    # Manglende uker: per spill, mellom første og siste dato, forvent minst én trekning per ISO-uke.
    for game in sorted({d.game for d in draws}):
        dates = sorted(d.draw_date for d in draws if d.game == game)
        if len(dates) < 2:
            continue
        have = {d.isocalendar()[:2] for d in dates}
        cur = dates[0]
        while cur <= dates[-1]:
            yw = cur.isocalendar()[:2]
            if yw not in have:
                report["gaps"].append(f"{game}: ingen trekning i uke {yw[0]}-W{yw[1]:02d}")
            cur += timedelta(days=7)
    return report


def compare_sources(a: list, b: list) -> dict:
    """Sammenligner to uavhengige datasett på (game, dato)."""
    ia = {d.key(): d for d in a}
    ib = {d.key(): d for d in b}
    res = {"only_in_a": sorted(set(ia) - set(ib)), "only_in_b": sorted(set(ib) - set(ia)), "mismatch": [], "agree": 0}
    for k in sorted(set(ia) & set(ib)):
        x, y = ia[k], ib[k]
        if x.main_numbers != y.main_numbers or x.bonus_numbers != y.bonus_numbers:
            res["mismatch"].append({"key": k, "a": (x.main_numbers, x.bonus_numbers), "b": (y.main_numbers, y.bonus_numbers)})
        else:
            res["agree"] += 1
    return res


# ---------------------------------------------------------------------------
# Manuell reserve: tolk klipp-og-lim-tekst (én trekning per linje)
# ---------------------------------------------------------------------------

DATE_RX = re.compile(r"(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_pasted(game: str, text: str, source: str = "manuell") -> list:
    """Linjeformat: dato, deretter hovedtall, så tilleggstall/stjernetall (valgfritt etter '+').
    Eksempel: 16.03.2024 1 5 12 19 23 28 31 + 9"""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = DATE_RX.search(line)
        if not m:
            continue
        if m.group(1):
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        else:
            d = date(int(m.group(6)), int(m.group(5)), int(m.group(4)))
        rest = line[m.end():]
        main_part, _, bonus_part = rest.partition("+")
        era = era_for(game, d)
        mains = [int(x) for x in re.findall(r"\b\d{1,2}\b", main_part)]
        bonus = [int(x) for x in re.findall(r"\b\d{1,2}\b", bonus_part)]
        if not bonus and len(mains) > era.main_count:
            mains, bonus = mains[:era.main_count], mains[era.main_count:]
        out.append(Draw(game=game, draw_date=d, main_numbers=sorted(mains), main_numbers_draw_order=[],
                        bonus_numbers=sorted(bonus), source=source,
                        fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds")))
    return out


def parse_external_csv(game: str, text: str, source: str) -> list:
    """Tolker header-baserte CSV-er fra andre kilder, f.eks. eonurk/EuroJackpot
    (draw_date,main_numbers,euro_numbers) eller vårt eget format."""
    rows = list(csv.DictReader(text.splitlines()))
    out = []
    for r in rows:
        r = {k.strip().lower(): (v or "") for k, v in r.items() if k}
        if r.get("game") and r["game"] != game:
            continue
        m = DATE_RX.search(r.get("draw_date", ""))
        if not m:
            continue
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m.group(1) else date(int(m.group(6)), int(m.group(5)), int(m.group(4)))
        nums = lambda s: [int(x) for x in re.findall(r"\d+", s or "")]
        mains = nums(r.get("main_numbers"))
        bonus = nums(r.get("euro_numbers") or r.get("star_numbers") or r.get("bonus_numbers"))
        out.append(Draw(game=game, draw_date=d, main_numbers=sorted(mains), main_numbers_draw_order=[],
                        bonus_numbers=sorted(bonus), source=source,
                        fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds")))
    return out


# ---------------------------------------------------------------------------
# CSV-lagring (idempotent sammenslåing)
# ---------------------------------------------------------------------------

def read_csv(path: Path) -> list:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return [Draw.from_row(r) for r in csv.DictReader(f)]


def write_csv(path: Path, draws: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    draws = sorted(draws, key=lambda d: (d.game, d.draw_date))
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for d in draws:
            w.writerow(d.to_row())
    tmp.replace(path)


def merge(existing: list, new: list) -> tuple:
    """Nye rader erstatter gamle med samme nøkkel bare hvis tallene er like eller den gamle var
    manuell; ellers logges konflikt og den gamle beholdes."""
    by_key = {d.key(): d for d in existing}
    added = conflicts = 0
    for d in new:
        k = d.key()
        old = by_key.get(k)
        if old is None:
            by_key[k] = d
            added += 1
        elif (old.main_numbers, old.bonus_numbers) == (d.main_numbers, d.bonus_numbers):
            if old.source == "manuell" and d.source != "manuell":
                by_key[k] = d  # oppgrader manuell rad til API-rad
        else:
            conflicts += 1
            log.error("KONFLIKT %s: eksisterende %s/%s (%s) vs ny %s/%s (%s)", k,
                      old.main_numbers, old.bonus_numbers, old.source, d.main_numbers, d.bonus_numbers, d.source)
    return list(by_key.values()), added, conflicts


# ---------------------------------------------------------------------------
# Kommandoer
# ---------------------------------------------------------------------------

def cmd_fetch(args, update_only=False):
    out = Path(args.out)
    existing = read_csv(out)
    start = date.fromisoformat(args.from_date) if args.from_date else GAMES[args.game]["eras"][0].start
    if update_only:
        have = [d.draw_date for d in existing if d.game == args.game]
        if have:
            start = max(have) - timedelta(days=14)  # liten overlapp fanger rettelser
    end = date.fromisoformat(args.to_date) if args.to_date else date.today()
    client = PoliteClient()
    try:
        new = fetch_range(client, args.game, start, end, use_cache=not args.no_cache)
    except (urllib.error.URLError, RuntimeError) as e:
        log.error("Henting avbrutt: %s", e)
        log.error("Nettet/verten er utilgjengelig eller nektet. Data som allerede er mellomlagret er brukt. "
                  "Reserve: 'import' med klipp fra resultatsiden, eller en CSV fra en annen kilde (se dokumentet).")
        return 2
    merged, added, conflicts = merge(existing, new)
    report = validate_dataset(merged)
    write_csv(out, merged)
    log.info("lagret %s: %d rader (+%d nye, %d konflikter). Validering: %s", out, len(merged), added, conflicts, json.dumps(report, ensure_ascii=False)[:400])
    if report["gaps"]:
        log.warning("%d uker uten trekning — se 'validate' for liste", len(report["gaps"]))
    return 1 if conflicts or report["errors"] else 0


def cmd_validate(args):
    draws = read_csv(Path(args.csv))
    report = validate_dataset(draws)
    write_csv(Path(args.csv), draws)  # oppdaterer validation_status
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["errors"] or report["duplicates"] else 0


def cmd_compare(args):
    a, b = read_csv(Path(args.csv_a)), read_csv(Path(args.csv_b))
    res = compare_sources(a, b)
    print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
    return 1 if res["mismatch"] else 0


def cmd_import(args):
    text = Path(args.file).read_text("utf-8")
    first = text.splitlines()[0].lower() if text.strip() else ""
    if "draw_date" in first and "main_numbers" in first:
        new = parse_external_csv(args.game, text, source=args.source)
    else:
        new = parse_pasted(args.game, text, source=args.source)
    out = Path(args.out)
    merged, added, conflicts = merge(read_csv(out), new)
    validate_dataset(merged)
    write_csv(out, merged)
    log.info("importerte %d trekninger (+%d nye, %d konflikter) til %s", len(new), added, conflicts, out)
    return 1 if conflicts else 0


def cmd_selftest(_args):
    """Kjører uten nett: tolker et fixture-svar, validerer og sammenligner."""
    fixture = {
        "gameResult": [
            {"drawDate": "2024-03-16", "drawId": 1900, "gameNo": 1, "turnover": "123456789.00",
             "prize": [{"id": 1, "name": "7 rette", "value": "1000000", "winners": "0"}],
             "winnerNumber": [
                 {"number": "19", "type": 1, "name": "", "drawOrder": 1}, {"number": "5", "type": 1, "name": "", "drawOrder": 2},
                 {"number": "31", "type": 1, "name": "", "drawOrder": 3}, {"number": "12", "type": 1, "name": "", "drawOrder": 4},
                 {"number": "1", "type": 1, "name": "", "drawOrder": 5}, {"number": "28", "type": 1, "name": "", "drawOrder": 6},
                 {"number": "23", "type": 1, "name": "", "drawOrder": 7}, {"number": "9", "type": 2, "name": "Tilleggstall", "drawOrder": 8}]},
            {"drawDate": "2024-03-09", "drawId": 1899, "gameNo": 1, "turnover": "1",
             "prize": [], "winnerNumber": [{"number": str(n), "type": 1, "drawOrder": i + 1} for i, n in enumerate([2, 6, 11, 18, 22, 27, 30])]
                                   + [{"number": "7", "type": 2, "drawOrder": 8}]},
        ]
    }
    items = _extract_draw_list(fixture)
    assert len(items) == 2, "fant ikke trekningslisten"
    draws = [parse_nt_draw("lotto", it, "fixture") for it in items]
    assert draws[0].main_numbers == [1, 5, 12, 19, 23, 28, 31]
    assert draws[0].main_numbers_draw_order == [19, 5, 31, 12, 1, 28, 23]
    assert draws[0].bonus_numbers == [9]
    report = validate_dataset(draws)
    assert report["ok"] == 2 and not report["errors"], report
    # andre trekning mangler tilleggstall → feil (bare 7 hovedtall)
    bad = parse_pasted("lotto", "23.03.2024 3 7 13 20 24 29 33")
    assert validate_draw(bad[0]) and "tilleggs" in validate_draw(bad[0])[0]
    # Eurojackpot-epoker
    ej_old = parse_pasted("eurojackpot", "2022-03-18 1 2 3 4 5 + 1 10")
    ej_new = parse_pasted("eurojackpot", "2022-03-25 1 2 3 4 5 + 11 12")
    assert not validate_draw(ej_old[0]) and not validate_draw(ej_new[0])
    assert validate_draw(parse_pasted("eurojackpot", "2022-03-18 1 2 3 4 5 + 11 12")[0])
    # sammenligning
    other = parse_pasted("lotto", "16.03.2024 1 5 12 19 23 28 31 + 9\n09.03.2024 2 6 11 18 22 27 30 + 8")
    cmp = compare_sources(draws, other)
    assert cmp["agree"] == 1 and len(cmp["mismatch"]) == 1
    # manglende uke oppdages
    gap = parse_pasted("lotto", "02.03.2024 1 2 3 4 5 6 7 + 8\n16.03.2024 9 10 11 12 13 14 15 + 16")
    assert any("W10" in g for g in validate_dataset(gap)["gaps"])
    # chunking
    chunks = list(chunk_ranges(date(2024, 1, 1), date(2024, 12, 31)))
    assert chunks[0] == (date(2024, 1, 1), date(2024, 4, 14)) and chunks[-1][1] == date(2024, 12, 31)
    print("selftest OK: parsing, epoke-validering, duplikat/hull-deteksjon, sammenligning, chunking")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    for name in ("fetch", "update"):
        s = sub.add_parser(name)
        s.add_argument("--game", choices=GAMES.keys(), required=True)
        s.add_argument("--from", dest="from_date")
        s.add_argument("--to", dest="to_date")
        s.add_argument("--out", required=True)
        s.add_argument("--no-cache", action="store_true")
    s = sub.add_parser("validate"); s.add_argument("csv")
    s = sub.add_parser("compare"); s.add_argument("csv_a"); s.add_argument("csv_b")
    s = sub.add_parser("import"); s.add_argument("file"); s.add_argument("--game", choices=GAMES.keys(), required=True)
    s.add_argument("--out", required=True); s.add_argument("--source", default="manuell")
    sub.add_parser("selftest")

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    return {
        "fetch": lambda a: cmd_fetch(a, update_only=False),
        "update": lambda a: cmd_fetch(a, update_only=True),
        "validate": cmd_validate,
        "compare": cmd_compare,
        "import": cmd_import,
        "selftest": cmd_selftest,
    }[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
