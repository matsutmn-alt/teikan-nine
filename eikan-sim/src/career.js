import { SeededRandom, hashSeed } from "./random.js";
import { applyGameStats, simulateGame } from "./baseball.js";
import { addScoutItems, createOpponent, createScheduleForYear, createScoutCandidates, recruitClass, selectLineup } from "./team.js";
import { applyTrainingDay } from "./training.js";

function nextDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function opponentFor(state, fixture, seed) {
  const rng = new SeededRandom(hashSeed(`${state.seed}:${fixture.id}:${seed}:roster`));
  return createOpponent({ rng, gameId: fixture.id });
}

function saveYearAndAdvance(state, date) {
  state.seasons.unshift({
    year: state.schoolYear,
    completedOn: date,
    record: { ...state.school.yearlyRecord },
    gamesPlayed: state.games.filter((game) => game.date >= `${state.schoolYear}-04-01` && game.date <= `${state.schoolYear + 1}-03-31`).length,
    graduates: state.school.players.filter((player) => player.grade === 3).map((player) => player.id)
  });
  const graduates = state.school.players.filter((player) => player.grade === 3);
  for (const graduate of graduates) {
    graduate.history.push({ date, event: "卒業" });
    state.alumni.unshift({
      id: graduate.id,
      name: graduate.name,
      entryYear: graduate.entryYear,
      graduationYear: state.schoolYear,
      finalGrade: graduate.grade,
      position: graduate.position,
      bats: graduate.bats,
      throws: graduate.throws,
      personality: graduate.personality,
      growthStyle: graduate.growthStyle,
      genius: graduate.genius,
      trajectory: graduate.trajectory,
      pitching: structuredClone(graduate.pitching),
      abilities: structuredClone(graduate.abilities),
      abilitiesAtGraduation: structuredClone(graduate.abilities),
      careerStats: { ...graduate.careerStats },
      yearlyStats: structuredClone(graduate.yearlyStats),
      abilityHistory: structuredClone(graduate.abilityHistory),
      history: structuredClone(graduate.history)
    });
  }
  state.school.players = state.school.players.filter((player) => player.grade < 3);
  for (const player of state.school.players) player.grade += 1;
  state.schoolYear += 1;
  const incoming = state.scouting.incomingIds.map((id) => {
    const prospect = state.scouting.candidates.flatMap((region) => region.prospects).find((candidate) => candidate.id === id);
    if (!prospect) throw new Error(`スカウト入学予定の選手が見つかりません: ${id}`);
    prospect.enrolled = true;
    prospect.scouted = false;
    prospect.enrollmentYear = state.schoolYear;
    const student = structuredClone(prospect);
    student.entryYear = state.schoolYear;
    student.graduationYear = state.schoolYear + 3;
    student.grade = 1;
    delete student.fatigue;
    student.history = [{ date: `${state.schoolYear}-04-01`, event: `${prospect.prefecture}からスカウト入学` }];
    return student;
  });
  const randomFreshmen = recruitClass(state, state.schoolYear, 10 - incoming.length);
  const classMembers = [...incoming, ...randomFreshmen];
  state.scouting.incomingIds = [];
  state.school.players.push(...classMembers);
  state.scouting.candidates = createScoutCandidates(state.seed, state.schoolYear);
  state.scouting.activeVisit = null;
  state.school.startingLineup = selectLineup(state.school.players).map((player) => player.id);
  state.school.yearlyRecord = { wins: 0, losses: 0, ties: 0 };
  state.schedule = createScheduleForYear(state.schoolYear);
  state.notices.unshift({
    date: nextDate(date),
    text: `新年度。${graduates.length}名が卒業し、新入生${classMembers.length}名を迎えました。`
  });
}

function playScheduledGame(state, fixture) {
  const gameSeedRandom = new SeededRandom(state.randomStates.games);
  const gameSeed = gameSeedRandom.nextUint32();
  state.randomStates.games = gameSeedRandom.state;
  const opponent = opponentFor(state, fixture, gameSeed);
  const game = simulateGame({
    homeTeam: { id: "school", name: state.school.name, players: state.school.players },
    awayTeam: opponent,
    date: fixture.date,
    competition: fixture.competition,
    seed: gameSeed,
    homeLineupIds: state.school.startingLineup
  });
  applyGameStats(state.school, game, "home", state.schoolYear);

  const resultKey = game.winner === "home" ? "wins" : game.winner === "away" ? "losses" : "ties";
  state.school.record[resultKey] += 1;
  state.school.yearlyRecord[resultKey] += 1;
  const itemReward = game.winner === "home" ? 2 : 1;
  addScoutItems(state, itemReward);
  state.games.unshift(game);
  state.notices.unshift({ date: fixture.date, text: `${fixture.competition}: ${game.summary}（スカウトアイテム+${itemReward}）` });
  fixture.played = true;
}

export function advanceDay(state) {
  const date = state.date;
  applyTrainingDay(state, date);
  for (const fixture of state.schedule.filter((item) => item.date === date && !item.played)) {
    playScheduledGame(state, fixture);
  }
  if (date.endsWith("-03-31")) saveYearAndAdvance(state, date);
  state.date = nextDate(date);
  return { date, gamesPlayed: state.schedule.filter((fixture) => fixture.date === date && fixture.played).length };
}

export function advanceDays(state, days) {
  if (!Number.isInteger(days) || days < 1 || days > 3660) throw new RangeError("進行日数は1から3660までの整数にしてください。");
  for (let day = 0; day < days; day += 1) advanceDay(state);
  return state;
}
