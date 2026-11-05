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
    drawsPerWeek: 1,
    // Default price per row in NOK; user-editable because prices change.
    defaultRowPrice: 6,
    /* Data sources, tried in order (see js/crawler.js and
       docs/DATAINNHENTING-HISTORISKE-TALL.md). */
    launch: "1986-04-19",
    // Draws per week over time, used to judge whether a week is complete.
    // drawDays: 0 = Sunday … 6 = Saturday.
    schedule: [{ from: "1986-04-19", perWeek: 1, drawDays: [6] }],
    api: {
      // The results API behind norsk-tipping.no's own results page.
      v2: "https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/lotto",
      v2WindowDays: 15 * 7 - 1,
      // Endpoint used by 2015-era wrappers; kept as a last resort.
      legacy: "https://www.norsk-tipping.no/api-lotto/getResultInfo.json"
    },
    data: {
      bundled: "data/lotto.csv",
      thirdParty: null,
      csvName: "lotto-results.csv"
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
    drawsPerWeek: 2,
    defaultRowPrice: 25,
    launch: "2012-03-23",
    // One Friday draw until March 2022; Tuesday draws from 29 March 2022.
    schedule: [{ from: "2012-03-23", perWeek: 1, drawDays: [5] }, { from: "2022-03-29", perWeek: 2, drawDays: [2, 5] }],
    api: {
      // The open-source client github.com/X104n/lotto requests Eurojackpot as the game
      // "eurojackpot all"; plain "eurojackpot" is kept as a fallback variant.
      v2: "https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/eurojackpot%20all",
      v2Alt: ["https://api.norsk-tipping.no/LotteryGameInfo/v2/api/results/eurojackpot"],
      v2WindowDays: 15 * 7 - 1,
      legacy: "https://www.norsk-tipping.no/api-eurojackpot/getResultInfo.json"
    },
    data: {
      bundled: "data/eurojackpot.csv",
      // Independent, openly published dataset used as a fallback and for cross-checks.
      thirdParty: {
        label: "GitHub dataset eonurk/EuroJackpot",
        url: "https://raw.githubusercontent.com/eonurk/EuroJackpot/main/eurojackpot_results.csv"
      },
      csvName: "eurojackpot-results.csv"
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

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Number of equally likely rows — the jackpot odds are 1 in this. */
function jackpotCombinations(cfg) {
  return binomial(cfg.mainMax, cfg.mainPick) * (cfg.starPick ? binomial(cfg.starMax, cfg.starPick) : 1);
}
