import { SeededRandom } from "./random.js";
import { emptyStats, selectLineup } from "./team.js";
import { pitchChangeTotal, secondStraight } from "./pitching.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function makeGameStats(players) {
  return Object.fromEntries(players.map((player) => [player.id, emptyStats()]));
}

function pushPlay(game, inning, half, text) {
  game.plays.push({ inning, half, text });
}

function scoreRunner(game, runner, batterStats, earned = true) {
  game.score[game.battingSide] += 1;
  const stats = game.playerStats[game.battingSide][runner.id];
  stats.runs += 1;
  if (batterStats) batterStats.runsBattedIn += 1;
  const pitcherStats = game.playerStats[game.fieldingSide][game.pitcher.id];
  pitcherStats.runsAllowed += 1;
  if (earned) pitcherStats.earnedRuns += 1;
}

function advanceWalk(game, batter, batterStats) {
  const bases = game.bases;
  if (bases[0]) {
    if (bases[1]) {
      if (bases[2]) {
        scoreRunner(game, bases[2], batterStats);
        bases[2] = null;
      }
      bases[2] = bases[1];
    }
    bases[1] = bases[0];
  }
  bases[0] = batter;
}

function advanceHit(game, batter, batterStats, hitBases, rng) {
  const oldBases = game.bases.slice();
  game.bases = [null, null, null];
  for (let base = 2; base >= 0; base -= 1) {
    const runner = oldBases[base];
    if (!runner) continue;
    let advance = hitBases;
    if (hitBases === 1 && base === 0 && runner.abilities.speed >= 70 && rng.next() < 0.22) advance = 2;
    if (hitBases === 1 && base === 1 && rng.next() < 0.3) advance = 2;
    const destination = base + advance;
    if (destination >= 3) scoreRunner(game, runner, batterStats);
    else game.bases[destination] = runner;
  }
  if (hitBases === 4) scoreRunner(game, batter, batterStats);
  else game.bases[hitBases - 1] = batter;
}

function attemptSteal(game, rng, pitcherStats) {
  const firstRunner = game.bases[0];
  const secondRunner = game.bases[1];
  const runner = secondRunner && !game.bases[2] ? secondRunner : firstRunner && !secondRunner ? firstRunner : null;
  if (!runner) return false;
  const attemptChance = clamp(0.015 + runner.abilities.speed * 0.0012, 0.025, 0.13);
  if (rng.next() >= attemptChance) return false;
  const catcher = game.lineups[game.fieldingSide].find((player) => player.position === "捕手");
  const catcherArm = catcher?.abilities.arm ?? 50;
  const catcherSkill = catcher?.abilities.catching ?? 50;
  const safeChance = clamp(0.68 + (runner.abilities.speed - 55) * 0.006 - (catcherArm - 55) * 0.004 - (catcherSkill - 55) * 0.003, 0.35, 0.93);
  const from = secondRunner === runner ? 1 : 0;
  const destination = from + 1;
  const runnerStats = game.playerStats[game.battingSide][runner.id];
  if (rng.next() < safeChance) {
    game.bases[from] = null;
    game.bases[destination] = runner;
    runnerStats.stolenBases += 1;
    pushPlay(game.result, game.inning, game.half, `${runner.name} 盗塁成功`);
  } else {
    game.bases[from] = null;
    runnerStats.caughtStealing += 1;
    game.outs += 1;
    pitcherStats.outsPitched += 1;
    pushPlay(game.result, game.inning, game.half, `${runner.name} 盗塁失敗`);
  }
  return game.outs >= 3;
}

function recordOut(game, batterStats, pitcherStats, batter, message, count = 1) {
  batterStats.atBats += 1;
  game.outs += count;
  pitcherStats.outsPitched += count;
  pushPlay(game.result, game.inning, game.half, message);
}

function simulatePlateAppearance(game, rng) {
  const { battingSide, fieldingSide } = game;
  const lineup = game.lineups[battingSide];
  const batter = lineup[game.lineupIndex[battingSide]];
  const pitcher = game.pitchers[fieldingSide];
  const batterStats = game.playerStats[battingSide][batter.id];
  const pitcherStats = game.playerStats[fieldingSide][pitcher.id];
  batterStats.games = 1;
  pitcherStats.games = 1;
  if (attemptSteal(game, rng, pitcherStats)) return;
  batterStats.plateAppearances += 1;
  let balls = 0;
  let strikes = 0;

  for (let pitch = 0; pitch < 20; pitch += 1) {
    game.pitcherStamina[game.fieldingSide] = Math.max(0, game.pitcherStamina[game.fieldingSide] - 0.035);
    const control = pitcher.pitching?.control ?? 45;
    const staminaPenalty = Math.max(0, 50 - game.pitcherStamina[game.fieldingSide]) / 200;
    pitcherStats.pitchCount += 1;
    const ballChance = clamp(0.3 - (control - 50) * 0.0014 + staminaPenalty, 0.19, 0.43);
    const calledStrikeChance = clamp(0.27 + (control - 50) * 0.0008, 0.21, 0.34);
    const hitByPitchChance = clamp(0.004 + (50 - control) * 0.00008, 0.001, 0.009);
    if (rng.next() < hitByPitchChance) {
      batterStats.hitByPitch += 1;
      pitcherStats.hitByPitchAllowed += 1;
      advanceWalk(game, batter, batterStats);
      pushPlay(game.result, game.inning, game.half, `${batter.name} 死球`);
      game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
      return;
    }
    const roll = rng.next();
    if (roll < ballChance) {
      balls += 1;
      if (balls === 4) {
        batterStats.walks += 1;
        pitcherStats.walksAllowed += 1;
        advanceWalk(game, batter, batterStats);
        pushPlay(game.result, game.inning, game.half, `${batter.name} 四球`);
        game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
        return;
      }
      continue;
    }
    if (roll < ballChance + calledStrikeChance) {
      strikes += 1;
      if (strikes === 3) {
        batterStats.strikeouts += 1;
        pitcherStats.strikeoutsPitched += 1;
        recordOut(game, batterStats, pitcherStats, batter, `${batter.name} 見逃し三振`);
        game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
        return;
      }
      continue;
    }

    const pitcherRating = (control + (pitcher.pitching?.velocity ?? 130) - 100) / 2
      + pitchChangeTotal(pitcher.pitching?.pitches) * 0.08
      + (secondStraight(pitcher.pitching?.pitches) ? 1.2 : 0)
      - pitcher.condition * 0.5;
    const contactChance = clamp(
      0.67 + (batter.abilities.contact - 50) * 0.004 + batter.condition * 0.008 - (pitcherRating - 50) * 0.002 - staminaPenalty,
      0.42,
      0.84
    );
    if (rng.next() > contactChance) {
      strikes += 1;
      if (strikes === 3) {
        batterStats.strikeouts += 1;
        pitcherStats.strikeoutsPitched += 1;
        recordOut(game, batterStats, pitcherStats, batter, `${batter.name} 空振り三振`);
        game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
        return;
      }
      continue;
    }

    if (rng.next() < 0.08 && strikes < 2) {
      strikes += 1;
      continue;
    }
    const battingAverage = clamp(
      0.2 + (batter.abilities.contact - 50) * 0.0025 + batter.condition * 0.004 - (pitcherRating - 50) * 0.001,
      0.1,
      0.36
    );
    if (rng.next() < battingAverage) {
      batterStats.atBats += 1;
      const power = batter.abilities.power;
      const hitRoll = rng.next();
      const trajectory = clamp(batter.trajectory ?? 1, 1, 4);
      const homeRunChance = clamp(0.02 + (power - 50) * 0.0012 + (trajectory - 1) * 0.018, 0.012, 0.14);
      const tripleChance = clamp(0.018 + (batter.abilities.speed - 50) * 0.00045, 0.006, 0.04);
      const doubleChance = clamp(0.17 + (power - 50) * 0.0011, 0.1, 0.29);
      const hitBases = hitRoll < homeRunChance
        ? 4
        : hitRoll < homeRunChance + tripleChance
          ? 3
          : hitRoll < homeRunChance + tripleChance + doubleChance
            ? 2
            : 1;
      advanceHit(game, batter, batterStats, hitBases, rng);
      batterStats.hits += 1;
      if (hitBases === 2) batterStats.doubles += 1;
      if (hitBases === 3) batterStats.triples += 1;
      if (hitBases === 4) {
        batterStats.homeRuns += 1;
        pitcherStats.homeRunsAllowed += 1;
      }
      pitcherStats.hitsAllowed += 1;
      const hitNames = { 1: "単打", 2: "二塁打", 3: "三塁打", 4: "本塁打" };
      pushPlay(game.result, game.inning, game.half, `${batter.name} ${hitNames[hitBases]}`);
      game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
      return;
    }

    batterStats.atBats += 1;
    const fielders = game.lineups[fieldingSide];
    const fieldingAverage = fielders.reduce((sum, player) => sum + player.abilities.fielding * 0.8 + player.abilities.catching * 0.2 + player.condition * 0.3, 0) / fielders.length;
    const errorChance = clamp(0.055 + (55 - fieldingAverage) * 0.0014, 0.018, 0.11);
    if (rng.next() < errorChance) {
      const fielder = fielders[rng.int(0, fielders.length - 1)];
      game.playerStats[fieldingSide][fielder.id].errors += 1;
      if (game.bases[2]) {
        scoreRunner(game, game.bases[2], null, false);
        game.bases[2] = null;
      }
      if (game.bases[1]) {
        game.bases[2] = game.bases[1];
        game.bases[1] = null;
      }
      if (game.bases[0]) {
        game.bases[1] = game.bases[0];
        game.bases[0] = null;
      }
      game.bases[0] = batter;
      pushPlay(game.result, game.inning, game.half, `${fielder.name} 失策、${batter.name}出塁`);
      game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
      return;
    }

    if (game.bases[0] && game.outs <= 1 && rng.next() < 0.11) {
      game.bases[0] = null;
      recordOut(game, batterStats, pitcherStats, batter, `${batter.name} 併殺打`, 2);
    } else if (game.bases[2] && game.outs <= 1 && rng.next() < 0.46) {
      const runner = game.bases[2];
      game.bases[2] = null;
      scoreRunner(game, runner, batterStats);
      batterStats.sacrificeFlies += 1;
      game.outs += 1;
      pitcherStats.outsPitched += 1;
      pushPlay(game.result, game.inning, game.half, `${batter.name} 犠牲フライ`);
    } else {
      recordOut(game, batterStats, pitcherStats, batter, `${batter.name} 打ち取られた`);
    }
    game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
    return;
  }

  batterStats.atBats += 1;
  game.outs += 1;
  pitcherStats.outsPitched += 1;
  pushPlay(game.result, game.inning, game.half, `${batter.name} 打席上限によりアウト`);
  game.lineupIndex[battingSide] = (game.lineupIndex[battingSide] + 1) % lineup.length;
}

function battingSideFor(half) {
  return half === "top" ? "away" : "home";
}

function playHalfInning(game, rng, inning, half) {
  game.inning = inning;
  game.half = half;
  game.battingSide = battingSideFor(half);
  game.fieldingSide = game.battingSide === "home" ? "away" : "home";
  game.pitcher = game.pitchers[game.fieldingSide];
  game.outs = 0;
  game.bases = [null, null, null];
  const startingScore = game.score[game.battingSide];
  while (game.outs < 3) {
    simulatePlateAppearance(game, rng);
    if (half === "bottom" && inning >= 9 && game.score.home > game.score.away) {
      pushPlay(game.result, inning, half, "サヨナラで試合終了");
      break;
    }
  }
  game.result.innings[game.battingSide].push(game.score[game.battingSide] - startingScore);
  game.result.halfInnings.push({
    inning,
    half,
    outs: game.outs,
    runs: game.score[game.battingSide] - startingScore
  });
}

export function simulateGame({ homeTeam, awayTeam, date, competition, seed, maxInnings = 12, homeLineupIds, awayLineupIds }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("試合シードが不正です。");
  if (!Number.isInteger(maxInnings) || maxInnings < 9) throw new RangeError("試合は9イニング以上に設定してください。");
  const rng = new SeededRandom(seed);
  const lineups = {
    home: selectLineup(homeTeam.players, homeLineupIds),
    away: selectLineup(awayTeam.players, awayLineupIds)
  };
  const game = {
    lineups,
    pitchers: {
      home: lineups.home.find((player) => player.position === "投手" && player.pitching),
      away: lineups.away.find((player) => player.position === "投手" && player.pitching)
    },
    pitcherStamina: {
      home: lineups.home.find((player) => player.position === "投手" && player.pitching)?.pitching.stamina ?? 50,
      away: lineups.away.find((player) => player.position === "投手" && player.pitching)?.pitching.stamina ?? 50
    },
    playerStats: { home: makeGameStats(homeTeam.players), away: makeGameStats(awayTeam.players) },
    lineupIndex: { home: 0, away: 0 },
    score: { home: 0, away: 0 },
    inning: 1,
    half: "top",
    battingSide: "away",
    fieldingSide: "home",
    bases: [null, null, null],
    outs: 0
  };
  if (!game.pitchers.home || !game.pitchers.away) throw new Error("両チームに投手が必要です。");
  for (const side of ["home", "away"]) {
    for (const player of lineups[side]) game.playerStats[side][player.id].games = 1;
  }
  const result = {
    id: `game-${date}-${seed.toString(16)}`,
    seed,
    date,
    competition,
    home: { id: homeTeam.id ?? "school", name: homeTeam.name },
    away: { id: awayTeam.id ?? `opponent-${seed}`, name: awayTeam.name },
    innings: { home: [], away: [] },
    halfInnings: [],
    score: null,
    winner: null,
    plays: [],
    participants: {
      home: lineups.home.map(({ id, name, position }) => ({ id, name, position })),
      away: lineups.away.map(({ id, name, position }) => ({ id, name, position }))
    },
    playerStats: null,
    ruleNote: "独自推定モデル：9回制、同点時は最大12回まで延長。サヨナラを適用。",
    randomStateAfterGame: null
  };
  game.result = result;
  let completedInnings = 0;
  for (let inning = 1; inning <= maxInnings; inning += 1) {
    playHalfInning(game, rng, inning, "top");
    if (inning >= 9 && game.score.home > game.score.away) {
      completedInnings = inning;
      break;
    }
    playHalfInning(game, rng, inning, "bottom");
    completedInnings = inning;
    if (inning >= 9 && game.score.home !== game.score.away) break;
  }
  result.innings = {
    away: result.innings.away,
    home: result.innings.home,
    completed: completedInnings || 9
  };
  result.score = { home: game.score.home, away: game.score.away };
  result.winner = game.score.home === game.score.away
    ? "tie"
    : game.score.home > game.score.away ? "home" : "away";
  result.playerStats = game.playerStats;
  result.randomStateAfterGame = rng.state;
  result.summary = `${result.away.name} ${result.score.away} - ${result.score.home} ${result.home.name}`;
  return result;
}

export function applyGameStats(team, gameResult, side, year) {
  const resultStats = gameResult.playerStats[side];
  for (const player of team.players) {
    const gameStats = resultStats[player.id];
    if (!gameStats) continue;
    for (const [key, amount] of Object.entries(gameStats)) {
      player.careerStats[key] = (player.careerStats[key] ?? 0) + amount;
      player.yearlyStats[year] ??= emptyStats();
      player.yearlyStats[year][key] = (player.yearlyStats[year][key] ?? 0) + amount;
    }
  }
}

export function formatAverage(stats) {
  return formatRate(stats.hits, stats.atBats);
}

export function formatOnBasePercentage(stats) {
  const appearances = stats.atBats + stats.walks + stats.hitByPitch + stats.sacrificeFlies;
  return formatRate(stats.hits + stats.walks + stats.hitByPitch, appearances);
}

export function formatSluggingPercentage(stats) {
  const totalBases = stats.hits + stats.doubles + stats.triples * 2 + stats.homeRuns * 3;
  return formatRate(totalBases, stats.atBats);
}

export function formatEra(stats) {
  return stats.outsPitched ? ((stats.earnedRuns * 27) / stats.outsPitched).toFixed(2) : "—";
}

function formatRate(numerator, denominator) {
  return denominator ? (numerator / denominator).toFixed(3).replace(/^0/, "") : ".000";
}
