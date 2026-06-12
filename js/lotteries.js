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
        label: "Unofficial Norsk Tipping Lotto API (latest draw)",
        url: "https://www.norsk-tipping.no/api-lotto/getResultInfo.json",
        note: "JSON endpoint used by the unofficial wrappers github.com/Nilzone-/Norsk-Tipping and github.com/zrrrzzt/norsk-tipping-results. Add ?drawID=N for a specific draw."
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
        label: "Unofficial Norsk Tipping Eurojackpot API (latest draw)",
        url: "https://www.norsk-tipping.no/api-eurojackpot/getResultInfo.json",
        note: "JSON endpoint used by the unofficial wrappers github.com/Nilzone-/Norsk-Tipping and github.com/zrrrzzt/norsk-tipping-results. Add ?drawID=N for a specific draw."
      },
      {
        label: "Lottoland unofficial API (latest draw only)",
        url: "https://media.lottoland.com/api/drawings/euroJackpot",
        note: "Open JSON endpoint with the latest Eurojackpot draw."
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
