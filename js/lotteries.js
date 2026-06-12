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
    sources: [
      {
        label: "Norsk Tipping – Lotto results",
        url: "https://www.norsk-tipping.no/lotterier/lotto/resultater",
        note: "Official results page. Direct fetch is usually blocked by CORS; open the page, copy the draws and paste them below, or download/export and import the file."
      }
    ]
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
    sources: [
      {
        label: "Norsk Tipping – Eurojackpot results",
        url: "https://www.norsk-tipping.no/lotterier/eurojackpot/resultater",
        note: "Official results page. Direct fetch is usually blocked by CORS; copy the draws and paste them below, or import a downloaded file."
      },
      {
        label: "eurojackpot.org – results archive",
        url: "https://www.euro-jackpot.net/results-archive",
        note: "Results archive with yearly pages. If fetching fails due to CORS, copy/paste or import a CSV download."
      }
    ]
  }
};

/** Number of zones for the zone-spread criterion (e.g. 1-10, 11-20, ...). */
function lotteryZoneCount(cfg) {
  return Math.ceil(cfg.mainMax / cfg.zoneSize);
}

function zoneOfNumber(cfg, n) {
  return Math.floor((n - 1) / cfg.zoneSize);
}
