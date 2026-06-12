/* Lottery system definitions. Pure data + helpers, no DOM access. */
"use strict";

const LOTTERIES = {
  lotto: {
    id: "lotto",
    name: "Norsk Lotto",
    shortName: "Lotto",
    mainPick: 7,
    mainMax: 34,
    starPick: 0,
    starMax: 0,
    starLabel: "",
    drawDay: "Saturday",
    accent: "lotto",
    // Typical sum band (~middle 80% of random 7-of-34 rows)
    defaultSumMin: 90,
    defaultSumMax: 155,
    zoneSize: 10,
    crawl: {
      api: "https://www.norsk-tipping.no/api-lotto/getResultInfo.json",
      pages: [
        "https://www.norsk-tipping.no/lotteri/lotto/resultater",
        "https://www.norsk-tipping.no/lotterier/lotto/resultater"
      ],
      csvName: "lotto-results-2020-2026.csv"
    }
  },
  eurojackpot: {
    id: "eurojackpot",
    name: "Eurojackpot",
    shortName: "Eurojackpot",
    mainPick: 5,
    mainMax: 50,
    starPick: 2,
    starMax: 12,
    starLabel: "Star numbers",
    drawDay: "Tuesday & Friday",
    accent: "euro",
    defaultSumMin: 95,
    defaultSumMax: 160,
    zoneSize: 10,
    crawl: {
      api: "https://www.norsk-tipping.no/api-eurojackpot/getResultInfo.json",
      pages: [
        "https://www.norsk-tipping.no/lotteri/eurojackpot/resultater",
        "https://www.norsk-tipping.no/lotterier/eurojackpot/resultater"
      ],
      csvName: "eurojackpot-results-2020-2026.csv"
    }
  }
};

/** Number of zones for the zone-spread criterion (e.g. 1-10, 11-20, ...). */
function lotteryZoneCount(cfg) {
  return Math.ceil(cfg.mainMax / cfg.zoneSize);
}

function zoneOfNumber(cfg, n) {
  return Math.floor((n - 1) / cfg.zoneSize);
}
