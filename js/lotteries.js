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
    /* Unofficial JSON API (the endpoint used by the open-source wrappers
       github.com/Nilzone-/Norsk-Tipping and github.com/zrrrzzt/norsk-tipping-results).
       No drawID parameter -> latest draw; ?drawID=N -> a specific draw. */
    api: {
      latest: "https://www.norsk-tipping.no/api-lotto/getResultInfo.json",
      drawsPerYear: 52,
      fallbacks: []
    },
    sources: [
      {
        label: "Norsk Tipping – unofficial Lotto API (latest draw)",
        url: "https://www.norsk-tipping.no/api-lotto/getResultInfo.json",
        note: "JSON endpoint used by the unofficial norsk-tipping npm wrappers. Add ?drawID=N for a specific draw."
      },
      {
        label: "Norsk Tipping – Lotto results page",
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
    api: {
      latest: "https://www.norsk-tipping.no/api-eurojackpot/getResultInfo.json",
      drawsPerYear: 104,
      fallbacks: [
        {
          label: "Lottoland unofficial API (latest draw only)",
          url: "https://media.lottoland.com/api/drawings/euroJackpot"
        }
      ]
    },
    sources: [
      {
        label: "Norsk Tipping – unofficial Eurojackpot API (latest draw)",
        url: "https://www.norsk-tipping.no/api-eurojackpot/getResultInfo.json",
        note: "JSON endpoint used by the unofficial norsk-tipping npm wrappers. Add ?drawID=N for a specific draw."
      },
      {
        label: "Norsk Tipping – Eurojackpot results page",
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
