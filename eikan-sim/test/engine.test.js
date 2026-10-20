import test from "node:test";
import assert from "node:assert/strict";
import { advanceDay, advanceDays } from "../src/career.js";
import { formatAverage, formatEra, formatOnBasePercentage, formatSluggingPercentage, simulateGame } from "../src/baseball.js";
import { SeededRandom } from "../src/random.js";
import {
  addScoutItems, beginScoutVisit, createInitialState, createOpponent, createScoutCandidates, freshGameRandom,
  PREFECTURES, SCOUT_REGION_TYPES, scoutProspect, selectLineup, skipScoutVisit
} from "../src/team.js";
import { applyTrainingDay, pitchTrainingTargetOptions, validateTrainingPlan } from "../src/training.js";
import { migrateState, validateState } from "../src/persistence.js";
import { allPitchTypes, pitchChangeTotal, pitchTypesForDirection, validateArsenal, SECOND_STRAIGHT_TYPES } from "../src/pitching.js";
import { SURNAMES } from "../src/surnames.js";

function playOneSeededGame(seed) {
  const state = createInitialState({ seed });
  const gameRandom = freshGameRandom(state);
  const opponentRandom = new SeededRandom(seed ^ 0xa1b2c3d4);
  const opponent = createOpponent({ rng: opponentRandom, gameId: "test-game" });
  return simulateGame({
    homeTeam: { id: "school", name: state.school.name, players: state.school.players },
    awayTeam: opponent,
    date: state.date,
    competition: "テスト練習試合",
    seed: gameRandom.nextUint32()
  });
}

  test("地域特色が能力分布に反映され、天才の噂と実際の天才が別確率で決まる", () => {
    const regions = createScoutCandidates(511, 2026);
    const fielder = regions.filter((region) => region.regionType === "fielder")
      .flatMap((region) => region.prospects).flatMap((prospect) => Object.values(prospect.abilities));
    const ordinary = regions.filter((region) => region.regionType === "ordinary")
      .flatMap((region) => region.prospects).flatMap((prospect) => Object.values(prospect.abilities));
    assert.ok(fielder.reduce((sum, value) => sum + value, 0) / fielder.length >
      ordinary.reduce((sum, value) => sum + value, 0) / ordinary.length + 4);
      const pitcherMean = (type, ability) => {
        const values = regions.filter((region) => region.regionType === type)
          .flatMap((region) => region.prospects.filter((prospect) => prospect.pitching).map((prospect) => prospect.pitching[ability]));
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      };
      assert.ok(pitcherMean("pitcher", "control") > pitcherMean("ordinary", "control") + 3);
      const balancedMean = regions.filter((region) => region.regionType === "balanced")
        .flatMap((region) => region.prospects).flatMap((prospect) => Object.values(prospect.abilities));
      assert.ok(balancedMean.reduce((sum, value) => sum + value, 0) / balancedMean.length >
        ordinary.reduce((sum, value) => sum + value, 0) / ordinary.length + 1);
      const specialtyValues = regions.filter((region) => region.regionType === "specialty")
        .flatMap((region) => region.prospects.map((prospect) => prospect.abilities[region.specialty]));
      assert.ok(specialtyValues.reduce((sum, value) => sum + value, 0) / specialtyValues.length >
        ordinary.reduce((sum, value) => sum + value, 0) / ordinary.length + 10);

    let rumors = 0;
    let talents = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const prospect of createScoutCandidates(seed, 2026).flatMap((region) => region.prospects)) {
        if (prospect.geniusRumor) {
          rumors += 1;
          if (prospect.genius) talents += 1;
        } else {
          assert.equal(prospect.genius, false);
        }
      }
    }
    const proportion = rumors / (12 * 47 * 8);
    assert.ok(proportion >= 0.03 && proportion <= 0.05);
    assert.ok(talents / rumors >= 0.65 && talents / rumors <= 0.95);
  });

  test("投手の利き腕で球種方向が反転し、変化球の候補は指定の種類に限られる", () => {
    assert.deepEqual(pitchTypesForDirection("right", "左"), pitchTypesForDirection("left", "右"));
    assert.deepEqual(pitchTypesForDirection("left", "左"), pitchTypesForDirection("right", "右"));
    assert.ok(pitchTypesForDirection("leftDown", "左").includes("スクリュー"));
    assert.ok(!pitchTypesForDirection("leftDown", "左").includes("シンカー"));
    assert.deepEqual(SECOND_STRAIGHT_TYPES, ["ツーシームファスト", "ムービングファスト", "イーファスピッチ", "チェンジオブペース"]);
    assert.ok(allPitchTypes("右").includes("スイーパー"));
  });

  test("変化球の10枠は各方向2球種・総量70が上限で、第二ストレートは総量外", () => {
    const directions = ["right", "rightDown", "down", "leftDown", "left"];
    const pitches = directions.flatMap((direction) =>
      pitchTypesForDirection(direction, "右").slice(0, 2).map((type, index) => ({
        id: `${direction}-${index}`,
        kind: "breaking",
        direction,
        type,
        level: 7,
        customName: null
      }))
    );
    assert.equal(pitches.length, 10);
    assert.equal(pitchChangeTotal(pitches), 70);
    pitches.push({ id: "second", kind: "second", direction: null, type: SECOND_STRAIGHT_TYPES[0], level: 1, customName: null });
    assert.equal(pitchChangeTotal(pitches), 70);
    assert.ok(validateArsenal(pitches, "右"));
    pitches[0].level = 8;
    assert.equal(validateArsenal(pitches, "右"), false);
  });

  test("変化球取得・強化・第二ストレート練習は対象球種と成長履歴を更新する", () => {
    const state = createInitialState({ seed: 998 });
    const pitcher = state.school.players.find((player) => player.position === "投手");
    state.trainingPlan = "rest";
    state.school.players.forEach((player) => { player.trainingPlan = "rest"; });

    pitcher.trainingPlan = "pitch-learn-right";
    const learnTarget = pitchTrainingTargetOptions(pitcher, pitcher.trainingPlan)[0];
    assert.ok(learnTarget);
    pitcher.pitchTrainingType = learnTarget.value;
    pitcher.practiceProgress[`pitch-learn-${learnTarget.value}`] = 0.99;
    const previousCount = pitcher.pitching.pitches.length;
    applyTrainingDay(state, "2026-04-02");
    assert.equal(pitcher.pitching.pitches.length, previousCount + 1);
    const learned = pitcher.pitching.pitches.at(-1);
    assert.equal(learned.type, learnTarget.value);
    assert.equal(pitcher.abilityHistory.at(-1).ability, "pitch");

    pitcher.trainingPlan = "pitch-up-right";
    pitcher.pitchTrainingType = learned.id;
    const level = learned.level;
    pitcher.practiceProgress[`pitch-improve-${learned.id}`] = 0.99;
    applyTrainingDay(state, "2026-04-03");
    assert.equal(learned.level, level + 1);

    pitcher.trainingPlan = "pitch-second";
    const secondTarget = pitchTrainingTargetOptions(pitcher, pitcher.trainingPlan)[0];
    assert.ok(secondTarget);
    pitcher.pitchTrainingType = secondTarget.value;
    pitcher.practiceProgress[`pitch-second-${secondTarget.value}`] = 0.99;
    applyTrainingDay(state, "2026-04-04");
    assert.ok(pitcher.pitching.pitches.some((pitch) => pitch.kind === "second" && pitch.type === secondTarget.value));
    assert.ok(validateArsenal(pitcher.pitching.pitches, pitcher.throws));
  });

  test("天才選手の育成進捗は同条件の通常選手の1.2倍", () => {
    const regular = createInitialState({ seed: 123 });
    const genius = createInitialState({ seed: 123 });
    regular.trainingPlan = "rest";
    genius.trainingPlan = "rest";
    regular.school.players.forEach((player) => { player.trainingPlan = "rest"; });
    genius.school.players.forEach((player) => { player.trainingPlan = "rest"; });
    const regularPlayer = regular.school.players[2];
    const geniusPlayer = genius.school.players[2];
    geniusPlayer.genius = true;
    regularPlayer.trainingPlan = "power";
    geniusPlayer.trainingPlan = "power";
    applyTrainingDay(regular, "2026-04-02");
    applyTrainingDay(genius, "2026-04-02");
    assert.ok(Math.abs(geniusPlayer.practiceProgress.power / regularPlayer.practiceProgress.power - 1.2) < 1e-10);
  });

  test("名字候補には各提供リストの名字が含まれ、重複しない", () => {
    assert.ok(SURNAMES.length >= 18_000);
    assert.equal(new Set(SURNAMES).size, SURNAMES.length);
    for (const surname of ["藍浦", "甲斐", "雑賀", "駄阿", "内記", "灰尾", "真有"]) {
      assert.ok(SURNAMES.includes(surname), `${surname} が名字候補に含まれる`);
    }
  });

test("同じ初期シードで選手と自動試合が再現する", () => {
  const first = playOneSeededGame(12345);
  const second = playOneSeededGame(12345);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, playOneSeededGame(12346));
});

test("試合結果のイニング得点は最終スコアと一致し、両軍の成績を記録する", () => {
  const game = playOneSeededGame(9142);
  assert.ok(game.innings.completed >= 9 && game.innings.completed <= 12);
  assert.equal(game.innings.away.reduce((sum, runs) => sum + runs, 0), game.score.away);
  assert.equal(game.innings.home.reduce((sum, runs) => sum + runs, 0), game.score.home);
  assert.equal(game.winner, game.score.home === game.score.away ? "tie" : game.score.home > game.score.away ? "home" : "away");
  assert.equal(Object.values(game.playerStats.home).filter((stats) => stats.games > 0).length, 9);
  assert.equal(Object.values(game.playerStats.away).filter((stats) => stats.games > 0).length, 9);
  assert.ok(game.halfInnings.every((half) => half.outs <= 3));
  assert.ok(game.halfInnings.slice(0, -1).every((half) => half.outs === 3));
  for (const side of ["home", "away"]) {
    const runs = Object.values(game.playerStats[side]).reduce((sum, stats) => sum + stats.runs, 0);
    assert.equal(runs, game.score[side]);
  }
});

test("同一シードと同一日程で練習の成長結果が再現する", () => {
  const first = createInitialState({ seed: 77 });
  const second = createInitialState({ seed: 77 });
  for (let day = 0; day < 40; day += 1) {
    applyTrainingDay(first, `2026-04-${String((day % 30) + 1).padStart(2, "0")}`);
    applyTrainingDay(second, `2026-04-${String((day % 30) + 1).padStart(2, "0")}`);
  }
  assert.deepEqual(first.school.players, second.school.players);
});

test("練習方針は有効な能力にだけ成長を与え、能力値は上限を超えない", () => {
  const state = createInitialState({ seed: 90210 });
  const player = state.school.players.find((item) => item.position === "投手");
  const initialPower = player.abilities.power;
  const initialContact = player.abilities.contact;
  state.trainingPlan = "power";
  for (let day = 1; day <= 120; day += 1) applyTrainingDay(state, `2026-04-${String(((day - 1) % 30) + 1).padStart(2, "0")}`);
  assert.ok(player.abilities.power >= initialPower);
  assert.equal(player.abilities.contact, initialContact);
  assert.ok(Object.values(player.abilities).every((value) => value <= 100));
  assert.equal(validateTrainingPlan("made-up"), false);
});

test("打撃練習で弾道が成長し、能力アップ履歴が残る", () => {
  const state = createInitialState({ seed: 67 });
  state.trainingPlan = "rest";
  state.school.players.forEach((player) => { player.trainingPlan = "rest"; });
  const player = state.school.players.find((item) => item.position === "一塁手");
  player.trainingPlan = "batting";
  player.trajectory = 1;
  player.practiceProgress.trajectory = 0.99;
  applyTrainingDay(state, "2026-04-02");
  assert.equal(player.trajectory, 2);
  assert.deepEqual(player.abilityHistory.at(-1), {
    date: "2026-04-02",
    ability: "trajectory",
    from: 1,
    to: 2,
    training: "batting"
  });
});

test("個別練習は指定選手だけに適用される", () => {
  const state = createInitialState({ seed: 841 });
  state.trainingPlan = "rest";
  state.school.players.forEach((player) => { player.trainingPlan = "rest"; });
  const trainee = state.school.players.find((player) => player.position === "野手") ?? state.school.players[2];
  trainee.trainingPlan = "power";
  const initialPower = trainee.abilities.power;
  const otherPlayers = state.school.players.filter((player) => player.id !== trainee.id);
  const otherPower = otherPlayers.map((player) => player.abilities.power);
  for (let day = 1; day <= 240; day += 1) {
    applyTrainingDay(state, `2026-04-${String(((day - 1) % 30) + 1).padStart(2, "0")}`);
  }
  assert.ok(trainee.abilities.power > initialPower);
  assert.deepEqual(otherPlayers.map((player) => player.abilities.power), otherPower);
});

test("カスタムスタメンは9人の守備構成を検証し、試合記録へ反映する", () => {
  const state = createInitialState({ seed: 491 });
  const lineup = state.school.startingLineup.slice();
  const backupPitcher = state.school.players.find((player) => player.position === "投手" && player.id !== lineup[0]);
  const pitcherSlot = lineup.findIndex((id) => state.school.players.find((player) => player.id === id).position === "投手");
  lineup[pitcherSlot] = backupPitcher.id;
  assert.equal(selectLineup(state.school.players, lineup)[pitcherSlot].id, backupPitcher.id);

  const opponent = createOpponent({ rng: new SeededRandom(88), gameId: "lineup-check" });
  const game = simulateGame({
    homeTeam: { id: "school", name: state.school.name, players: state.school.players },
    awayTeam: opponent,
    homeLineupIds: lineup,
    date: state.date,
    competition: "スタメン確認",
    seed: 194
  });
  assert.deepEqual(game.participants.home.map((player) => player.id), lineup);
  assert.throws(() => selectLineup(state.school.players, lineup.slice(0, 8)), /9人/);
  assert.throws(() => selectLineup(state.school.players, [...lineup.slice(0, 8), lineup[0]]), /重複/);
});

test("試合予定日に自動試合が行われ、年度末に卒業・進級・新入生が処理される", () => {
  const state = createInitialState({ seed: 43 });
  state.date = "2026-05-10";
  const before = state.games.length;
  advanceDay(state);
  assert.equal(state.games.length, before + 1);
  assert.equal(state.schedule.find((fixture) => fixture.date === "2026-05-10").played, true);
  assert.equal(
    state.school.record.wins + state.school.record.losses + state.school.record.ties,
    1
  );

  state.date = "2027-03-31";
  advanceDay(state);
  assert.equal(state.date, "2027-04-01");
  assert.equal(state.schoolYear, 2027);
  assert.equal(state.alumni.length, 9);
  assert.equal(state.school.players.length, 29);
  assert.equal(state.school.players.filter((player) => player.grade === 1).length, 10);
  assert.equal(state.seasons[0].year, 2026);
});

test("3年度を連続進行しても選手ID・学年・卒業履歴が整合する", () => {
  const state = createInitialState({ seed: 1206 });
  advanceDays(state, 1096);
  assert.equal(state.schoolYear, 2029);
  assert.equal(state.date, "2029-04-01");
  assert.equal(state.seasons.length, 3);
  assert.equal(state.alumni.length, 28);
  assert.equal(state.school.players.length, 30);
  assert.deepEqual(
    [1, 2, 3].map((grade) => state.school.players.filter((player) => player.grade === grade).length),
    [10, 10, 10]
  );
  const ids = [...state.school.players, ...state.alumni].map((player) => player.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(state.games.length, 18);
});

test("セーブデータの重複IDと能力範囲外を拒否する", () => {
  const state = createInitialState({ seed: 8 });
  assert.equal(validateState(state), state);
  const duplicate = structuredClone(state);
  duplicate.school.players[1].id = duplicate.school.players[0].id;
  assert.throws(() => validateState(duplicate), /重複/);
  const invalidAbility = structuredClone(state);
  invalidAbility.school.players[0].abilities.power = 101;
  assert.throws(() => validateState(invalidAbility), /能力値が不正/);
  const invalidTrajectory = structuredClone(state);
  invalidTrajectory.school.players[0].trajectory = 5;
  assert.throws(() => validateState(invalidTrajectory), /弾道/);
});

test("打率・出塁率・長打率・防御率を標準的な定義で集計する", () => {
  const stats = {
    atBats: 10,
    hits: 4,
    doubles: 1,
    triples: 1,
    homeRuns: 1,
    walks: 2,
    hitByPitch: 1,
    sacrificeFlies: 1,
    earnedRuns: 3,
    outsPitched: 18
  };
  assert.equal(formatAverage(stats), ".400");
  assert.equal(formatOnBasePercentage(stats), ".500");
  assert.equal(formatSluggingPercentage(stats), "1.000");
  assert.equal(formatEra(stats), "4.50");
});

test("旧セーブの成績項目を追加してバージョン管理下で移行する", () => {
  const oldState = createInitialState({ seed: 2025 });
  oldState.schemaVersion = 4;
  delete oldState.school.startingLineup;
  delete oldState.school.players[0].trainingPlan;
  delete oldState.school.players[0].careerStats.hitByPitch;
  delete oldState.school.players[0].careerStats.pitchCount;
  oldState.school.players[0].fatigue = 72;
  delete oldState.scouting;
  delete oldState.scoutItems;
  const migrated = migrateState(oldState);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.school.startingLineup.length, 9);
  assert.equal(migrated.school.players[0].trainingPlan, null);
  assert.equal(migrated.school.players[0].careerStats.hitByPitch, 0);
  assert.equal(migrated.school.players[0].careerStats.pitchCount, 0);
  assert.equal(Object.hasOwn(migrated.school.players[0], "fatigue"), false);
  assert.equal(migrated.scoutItems, 0);
  assert.equal(migrated.scouting.candidates.length, 47);
  assert.equal(validateState(migrated), migrated);
});

test("schema v5の投手球種と未処理スカウト入学予定をschema v7へ移行する", () => {
  const oldState = createInitialState({ seed: 2024 });
  oldState.schemaVersion = 5;
  oldState.school.players.forEach((player) => {
    if (player.pitching) player.pitching.pitches = [{ name: "ストレート", break: 0 }, { name: "変化球", break: 2 }];
  });
  const region = oldState.scouting.candidates[0];
  const prospect = region.prospects[0];
  oldState.scoutItems = 3;
  prospect.scoutAttempts = 2;
  prospect.scouted = true;
  prospect.enrollmentYear = oldState.schoolYear + 1;
  oldState.scouting.incomingIds = [prospect.id];
  oldState.scouting.candidates.forEach((entry) => {
    entry.prospects.forEach((candidate) => {
      if (candidate.pitching) candidate.pitching.pitches = [{ name: "ストレート", break: 0 }, { name: "変化球", break: 2 }];
    });
  });

  const migrated = migrateState(oldState);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.scouting.incomingIds.length, 1);
  assert.ok(migrated.school.players.find((player) => player.position === "投手").pitching.pitches.some((pitch) => pitch.kind === "breaking"));
  assert.equal(validateState(migrated), migrated);
});

test("schema v6でフォーク・変化量1に固定された候補球種を再生成する", () => {
  const oldState = createInitialState({ seed: 9210 });
  oldState.schemaVersion = 6;
  for (const region of oldState.scouting.candidates) {
    for (const prospect of region.prospects) {
      if (prospect.position !== "投手") continue;
      prospect.pitching.pitches = [{
        id: `${prospect.id}-pitch-1`,
        kind: "breaking",
        direction: "down",
        type: "フォーク",
        level: 1,
        customName: null
      }];
    }
  }
  const migrated = migrateState(oldState);
  const pitchers = migrated.scouting.candidates.flatMap((region) => region.prospects).filter((prospect) => prospect.position === "投手");
  assert.equal(migrated.schemaVersion, 7);
  assert.ok(new Set(pitchers.flatMap((prospect) => prospect.pitching.pitches.map((pitch) => pitch.type))).size > 1);
  assert.ok(pitchers.some((prospect) => pitchChangeTotal(prospect.pitching.pitches) > 1));
  assert.ok(pitchers.every((prospect) =>
    prospect.pitching.pitches.length <= 3 &&
    pitchChangeTotal(prospect.pitching.pitches) <= 9 &&
    validateArsenal(prospect.pitching.pitches, prospect.throws, { maxPitches: 3, maxChange: 9 })
  ));
  assert.equal(validateState(migrated), migrated);
});

test("スカウト候補は年別に47都道府県へ均等配分され、能力と変化球が上限内", () => {
  const first = createInitialState({ seed: 7021 });
  const second = createInitialState({ seed: 7021 });
  assert.equal(first.school.players.filter((player) => player.grade === 1).length, 10);
  assert.equal(first.scouting.candidates.length, 47);
  assert.deepEqual(first.scouting.candidates, second.scouting.candidates);
  assert.deepEqual(first.scouting.candidates.map((region) => region.prefecture), PREFECTURES);
  assert.ok(first.scouting.candidates.every((region) => region.revealed === false));
  const distribution = Object.fromEntries(Object.keys(SCOUT_REGION_TYPES).map((type) => [
    type,
    first.scouting.candidates.filter((region) => region.regionType === type).length
  ]));
  assert.deepEqual(Object.values(distribution).sort((a, b) => a - b), [9, 9, 9, 10, 10]);
  assert.notDeepEqual(
    first.scouting.candidates.map((region) => region.regionType),
    createScoutCandidates(7021, 2027).map((region) => region.regionType)
  );
  const scoutPitchers = first.scouting.candidates.flatMap((region) => region.prospects)
    .filter((prospect) => prospect.position === "投手");
  assert.ok(new Set(scoutPitchers.flatMap((prospect) => prospect.pitching.pitches.map((pitch) => pitch.type))).size > 10);
  assert.ok(new Set(scoutPitchers.map((prospect) => pitchChangeTotal(prospect.pitching.pitches))).size > 3);
  assert.equal(Math.max(...scoutPitchers.map((prospect) => pitchChangeTotal(prospect.pitching.pitches))), 9);
  for (const region of first.scouting.candidates) {
    assert.equal(region.prospects.length, 8);
    for (const prospect of region.prospects) {
      assert.ok(Object.values(prospect.abilities).every((value) => value >= 20 && value <= 69));
      assert.ok(prospect.trajectory >= 1 && prospect.trajectory <= 2);
      if (prospect.pitching) {
        assert.ok(prospect.pitching.control >= 20 && prospect.pitching.control <= 69);
        assert.ok(prospect.pitching.stamina >= 20 && prospect.pitching.stamina <= 69);
        assert.ok(prospect.pitching.pitches.length <= 3);
        assert.ok(pitchChangeTotal(prospect.pitching.pitches) <= 9);
        assert.ok(validateArsenal(prospect.pitching.pitches, prospect.throws, { maxPitches: 3, maxChange: 9 }));
      }
    }
  }
});

test("候補公開には訪問アイテムが必要で、スキップ後も公開候補は固定される", () => {
  const state = createInitialState({ seed: 825 });
  const region = state.scouting.candidates[0];
  const prospect = region.prospects[0];
  assert.throws(() => scoutProspect(state, region.prefecture, prospect.id), /先にスカウトアイテム/);
  addScoutItems(state, 2);
  beginScoutVisit(state, region.prefecture);
  assert.equal(state.scoutItems, 1);
  assert.equal(validateState(state), state);
  assert.equal(region.revealed, true);
  assert.equal(state.scouting.activeVisit, region.prefecture);
  skipScoutVisit(state);
  assert.equal(state.scoutItems, 1);
  assert.equal(state.scouting.activeVisit, null);
  beginScoutVisit(state, region.prefecture);
  assert.equal(state.scoutItems, 0);
  prospect.scoutAttempts = 2;
  const result = scoutProspect(state, region.prefecture, prospect.id);
  assert.equal(result.success, true);
  assert.equal(state.scouting.activeVisit, null);
});

test("スカウト3回以内で成功し、翌年度の入学者10人に反映する", () => {
  const state = createInitialState({ seed: 820 });
  const prospect = state.scouting.candidates[0].prospects[0];
  addScoutItems(state, 1);
  prospect.scoutAttempts = 2;
  beginScoutVisit(state, state.scouting.candidates[0].prefecture);
  const result = scoutProspect(state, state.scouting.candidates[0].prefecture, prospect.id);
  assert.equal(result.success, true);
  assert.equal(result.chance, 1);
  assert.equal(prospect.scoutAttempts, 3);
  assert.equal(state.scoutItems, 0);
  assert.deepEqual(state.scouting.incomingIds, [prospect.id]);

  state.date = "2027-03-31";
  advanceDay(state);
  const freshman = state.school.players.filter((player) => player.grade === 1);
  assert.equal(freshman.length, 10);
  assert.equal(freshman.filter((player) => player.id.startsWith("scout-")).length, 1);
  assert.equal(freshman.find((player) => player.id === prospect.id).entryYear, 2027);
  assert.deepEqual(state.scouting.incomingIds, []);
  assert.equal(prospect.enrolled, true);
});

test("スカウトの成功率は試行回数で上がり、年度あたり8人で上限になる", () => {
  const state = createInitialState({ seed: 157 });
  const prospects = state.scouting.candidates.slice(0, 9).map((region) => region.prospects[0]);
  state.scoutItems = 9;
  for (const prospect of prospects.slice(0, 8)) {
    prospect.scoutAttempts = 2;
    const region = state.scouting.candidates.find((entry) => entry.prospects.includes(prospect));
    beginScoutVisit(state, region.prefecture);
    const result = scoutProspect(state, region.prefecture, prospect.id);
    assert.equal(result.chance, 1);
    assert.equal(result.success, true);
  }
  assert.equal(state.scouting.incomingIds.length, 8);
  const lastRegion = state.scouting.candidates.find((region) => region.prospects.includes(prospects[8]));
  assert.throws(() => beginScoutVisit(state, lastRegion.prefecture), /最大8人/);
  assert.equal(state.scoutItems, 1);
});

test("スカウトアイテムは勝利2個、敗北・引き分け1個を獲得", () => {
  const state = createInitialState({ seed: 43 });
  state.date = "2026-05-10";
  advanceDay(state);
  const game = state.games[0];
  assert.equal(state.scoutItems, game.winner === "home" ? 2 : 1);
});

test("弾道の高い打線は同条件で本塁打数に優位性を持つ", () => {
  let lowTrajectoryHomeRuns = 0;
  let highTrajectoryAwayRuns = 0;
  for (let trial = 1; trial <= 100; trial += 1) {
    const low = createInitialState({ seed: trial });
    const high = createInitialState({ seed: trial });
    for (const player of low.school.players) {
      player.abilities.contact = 100;
      player.abilities.power = 100;
      player.trajectory = 1;
    }
    for (const player of high.school.players) {
      player.abilities.contact = 100;
      player.abilities.power = 100;
      player.trajectory = 4;
    }
    const game = simulateGame({
      homeTeam: { id: "low", name: "低弾道", players: low.school.players },
      awayTeam: { id: "high", name: "高弾道", players: high.school.players },
      date: "2026-05-10",
      competition: "弾道検証",
      seed: 0x72340000 + trial
    });
    lowTrajectoryHomeRuns += Object.values(game.playerStats.home).reduce((sum, stats) => sum + stats.homeRuns, 0);
    highTrajectoryAwayRuns += Object.values(game.playerStats.away).reduce((sum, stats) => sum + stats.homeRuns, 0);
  }
  assert.ok(highTrajectoryAwayRuns > lowTrajectoryHomeRuns, `${highTrajectoryAwayRuns}本 vs ${lowTrajectoryHomeRuns}本`);
});

test("条件をそろえた複数試合で高ミート選手は安打数に優位性を持つ", () => {
  let highContactHits = 0;
  let lowContactHits = 0;
  const trials = 80;
  for (let trial = 1; trial <= trials; trial += 1) {
    const highState = createInitialState({ seed: trial });
    const lowState = createInitialState({ seed: trial });
    highState.school.players.forEach((player) => { player.abilities.contact = 90; });
    lowState.school.players.forEach((player) => { player.abilities.contact = 20; });
    const game = simulateGame({
      homeTeam: { id: "high-contact", name: "高ミート", players: highState.school.players },
      awayTeam: { id: "low-contact", name: "低ミート", players: lowState.school.players },
      date: "2026-05-10",
      competition: "能力差検証",
      seed: 0x45670000 + trial
    });
    highContactHits += Object.values(game.playerStats.home).reduce((sum, stats) => sum + stats.hits, 0);
    lowContactHits += Object.values(game.playerStats.away).reduce((sum, stats) => sum + stats.hits, 0);
  }
  assert.ok(highContactHits > lowContactHits, `${highContactHits}安打 vs ${lowContactHits}安打`);
});
