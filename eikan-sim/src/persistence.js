import { createScoutCandidates, emptyStats, PREFECTURES, regenerateScoutPitchArsenal, SCOUT_REGION_TYPES, selectLineup } from "./team.js";
import { pitchChangeTotal, validateArsenal, migrateArsenal } from "./pitching.js";
import { TRAINING_PLANS } from "./training.js";

const SAVE_KEY = "kyushun-save-v1";
const BACKUP_KEY = "kyushun-save-backup-v1";
const CURRENT_SCHEMA_VERSION = 7;
const TRAINING_PLAN_KEYS = new Set(Object.keys(TRAINING_PLANS));

function normalizeArsenal(pitches, throws, playerId) {
  if (Array.isArray(pitches) && pitches.every((pitch) => pitch.kind)) {
    const copied = structuredClone(pitches);
    return validateArsenal(copied, throws) ? copied : migrateArsenal(pitches, throws, playerId);
  }
  return migrateArsenal(pitches, throws, playerId);
}

export function validateState(state) {
  if (!state || typeof state !== "object" || state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error("保存データの形式またはバージョンが対応していません。");
  }
  const parsedDate = typeof state.date === "string" ? new Date(`${state.date}T00:00:00Z`) : null;
  if (
    !Number.isInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff ||
    !parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== state.date
  ) {
    throw new Error("保存データの日付または乱数シードが不正です。");
  }
  if (!state.school || !Array.isArray(state.school.players) || !state.school.players.length) {
    throw new Error("保存データに有効な選手一覧がありません。");
  }
  if (!TRAINING_PLAN_KEYS.has(state.trainingPlan)) throw new Error("チーム練習方針が不正です。");
  if (!Number.isInteger(state.scoutItems) || state.scoutItems < 0 || state.scoutItems > 1000000000) {
    throw new Error("スカウトアイテム数が不正です。");
  }
  if (!Number.isInteger(state.schoolYear) || state.schoolYear < 1900 || state.schoolYear > 9998 || state.date < `${state.schoolYear}-04-01` || state.date > `${state.schoolYear + 1}-03-31`) {
    throw new Error("保存データの年度と日付が一致しません。");
  }
  const playerIds = new Set();
  for (const player of state.school.players) {
    if (!player.id || playerIds.has(player.id)) throw new Error("選手IDが欠落しているか、重複しています。");
    playerIds.add(player.id);
    const abilityKeys = ["contact", "power", "speed", "arm", "fielding", "catching"];
    if (!player.abilities || abilityKeys.some((key) => !Number.isFinite(player.abilities[key]) || player.abilities[key] < 0 || player.abilities[key] > 100)) {
      throw new Error(`選手「${player.name ?? player.id}」の能力値が不正です。`);
    }
    if (!Number.isInteger(player.trajectory) || player.trajectory < 1 || player.trajectory > 4) {
      throw new Error(`選手「${player.name ?? player.id}」の弾道は1から4の整数にしてください。`);
    }
    if (!Number.isInteger(player.entryYear) || player.grade !== state.schoolYear - player.entryYear + 1 || player.graduationYear !== player.entryYear + 3) {
      throw new Error(`選手「${player.name ?? player.id}」の学年または在籍年度が不正です。`);
    }
    if (player.trainingPlan !== null && !TRAINING_PLAN_KEYS.has(player.trainingPlan)) {
      throw new Error(`選手「${player.name ?? player.id}」の個別練習が不正です。`);
    }
    if (typeof player.genius !== "boolean" || (player.pitchTrainingType !== null && typeof player.pitchTrainingType !== "string")) {
      throw new Error(`選手「${player.name ?? player.id}」の成長特性または球種練習対象が不正です。`);
    }
    if (player.pitching && (
      !Number.isFinite(player.pitching.velocity) || player.pitching.velocity < 0 || player.pitching.velocity > 165 ||
      ["control", "stamina"].some((key) => !Number.isFinite(player.pitching[key]) || player.pitching[key] < 0 || player.pitching[key] > 100)
    )) {
      throw new Error(`選手「${player.name ?? player.id}」の投手能力が不正です。`);
    }
    if (player.pitching && !validateArsenal(player.pitching.pitches, player.throws)) {
      throw new Error(`選手「${player.name ?? player.id}」の球種構成が不正です。`);
    }
  }
  for (const alumni of state.alumni ?? []) {
    if (!alumni.id || playerIds.has(alumni.id)) throw new Error("卒業生のIDが欠落しているか、再利用されています。");
    if (!Number.isInteger(alumni.trajectory) || alumni.trajectory < 1 || alumni.trajectory > 4) {
      throw new Error(`卒業生「${alumni.name ?? alumni.id}」の弾道データが不正です。`);
    }
    if (alumni.pitching && !validateArsenal(alumni.pitching.pitches, alumni.throws)) {
      throw new Error(`卒業生「${alumni.name ?? alumni.id}」の球種構成が不正です。`);
    }
    playerIds.add(alumni.id);
  }
  if (!Array.isArray(state.school.startingLineup)) throw new Error("スターティングメンバーの設定がありません。");
  selectLineup(state.school.players, state.school.startingLineup);
  if (!state.randomStates || ["generation", "training", "games"].some((key) => !Number.isInteger(state.randomStates[key]) || state.randomStates[key] < 0 || state.randomStates[key] > 0xffffffff)) {
    throw new Error("保存データの乱数状態が不正です。");
  }
  if (!Array.isArray(state.schedule) || !Array.isArray(state.games) || !Array.isArray(state.seasons) || !Array.isArray(state.alumni)) {
    throw new Error("保存データの日程または戦績が欠損しています。");
  }
  if (!state.scouting || !Array.isArray(state.scouting.candidates) || state.scouting.candidates.length !== PREFECTURES.length || !Array.isArray(state.scouting.incomingIds) || state.scouting.incomingIds.length > 8 || !(state.scouting.activeVisit === null || typeof state.scouting.activeVisit === "string")) {
    throw new Error("スカウト候補または入学予定データが不正です。");
  }
  const candidateIds = new Set();
  const regions = new Set();
  for (const region of state.scouting.candidates) {
    if (!PREFECTURES.includes(region.prefecture) || regions.has(region.prefecture) || !Array.isArray(region.prospects) || region.prospects.length !== 8 || !Object.hasOwn(SCOUT_REGION_TYPES, region.regionType) || typeof region.revealed !== "boolean") {
      throw new Error("スカウト都道府県または候補人数が不正です。");
    }
    regions.add(region.prefecture);
    for (const prospect of region.prospects) {
      if (!prospect.id || candidateIds.has(prospect.id) || !Number.isInteger(prospect.scoutAttempts) || prospect.scoutAttempts < 0 || prospect.scoutAttempts > 3) {
        throw new Error("スカウト候補のIDまたは試行回数が不正です。");
      }
      candidateIds.add(prospect.id);
      const prospectAbilityKeys = ["contact", "power", "speed", "arm", "fielding", "catching"];
      if (!Number.isInteger(prospect.trajectory) || prospect.trajectory < 1 || prospect.trajectory > 2 ||
          prospectAbilityKeys.some((key) => !Number.isInteger(prospect.abilities?.[key]) || prospect.abilities[key] < 20 || prospect.abilities[key] > 69)) {
        throw new Error(`スカウト候補「${prospect.name ?? prospect.id}」の能力値が不正です。`);
      }
      if (typeof prospect.genius !== "boolean" || typeof prospect.geniusRumor !== "boolean" || (prospect.genius && !prospect.geniusRumor) ||
          (prospect.position === "投手") !== Boolean(prospect.pitching) ||
          (prospect.pitching && (
            !Number.isFinite(prospect.pitching.velocity) || prospect.pitching.velocity < 110 || prospect.pitching.velocity > 155 ||
            ["control", "stamina"].some((key) => !Number.isInteger(prospect.pitching[key]) || prospect.pitching[key] < 20 || prospect.pitching[key] > 69) ||
            !validateArsenal(prospect.pitching.pitches, prospect.throws, { maxPitches: 3, maxChange: 9 }) ||
            pitchChangeTotal(prospect.pitching.pitches) > 9
          ))) {
        throw new Error(`スカウト候補「${prospect.name ?? prospect.id}」の天才特性または球種構成が不正です。`);
      }
    }
  }
  if (state.scouting.candidates.some((region) => region.prefecture === state.scouting.activeVisit && !region.revealed)) {
    throw new Error("訪問中の都道府県の候補が未公開です。");
  }
  if (state.scouting.activeVisit && !regions.has(state.scouting.activeVisit)) throw new Error("訪問中の都道府県が見つかりません。");
  const regionTypeCounts = Object.fromEntries(Object.keys(SCOUT_REGION_TYPES).map((type) => [type, 0]));
  state.scouting.candidates.forEach((region) => { regionTypeCounts[region.regionType] += 1; });
  if (JSON.stringify(Object.values(regionTypeCounts).sort((a, b) => a - b)) !== JSON.stringify([9, 9, 9, 10, 10])) {
    throw new Error("都道府県の地域タイプ配分が不正です。");
  }
  const incomingSet = new Set(state.scouting.incomingIds);
  if (incomingSet.size !== state.scouting.incomingIds.length || state.scouting.incomingIds.some((id) => {
    const prospect = state.scouting.candidates.flatMap((region) => region.prospects).find((item) => item.id === id);
    return !prospect || !prospect.scouted || prospect.enrolled || prospect.enrollmentYear !== state.schoolYear + 1;
  })) {
    throw new Error("次年度のスカウト入学予定が不正です。");
  }
  return state;
}

function upgradeStatLine(stats) {
  return { ...emptyStats(), ...stats };
}

export function migrateState(state) {
  if (!state || typeof state !== "object") throw new Error("保存データがJSONオブジェクトではありません。");
  if (state.schemaVersion === CURRENT_SCHEMA_VERSION) return validateState(state);
  if (![1, 2, 3, 4, 5, 6].includes(state.schemaVersion)) throw new Error("保存データの形式またはバージョンが対応していません。");

  const migrated = JSON.parse(JSON.stringify(state));
  if (!migrated.school || !Array.isArray(migrated.school.players) || !Array.isArray(migrated.games)) {
    throw new Error("旧形式の保存データに必須項目がありません。");
  }
  const oldScouting = migrated.scouting;
  migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
  migrated.scoutItems ??= 0;
  const newCandidates = createScoutCandidates(migrated.seed, migrated.schoolYear);
  const idMap = new Map();
  if (Array.isArray(oldScouting?.candidates)) {
    newCandidates.forEach((region) => {
      const oldRegion = oldScouting.candidates.find((item) => item.prefecture === region.prefecture);
      region.revealed = Boolean(oldRegion?.revealed);
      region.prospects.forEach((freshProspect, index) => {
        const oldProspect = oldRegion?.prospects?.[index];
        if (!oldProspect) return;
        idMap.set(oldProspect.id, freshProspect.id);
        const oldThrows = oldProspect.throws ?? "右";
        const oldPitches = oldProspect.pitching?.pitches ?? [];
        const fallbackArsenal = oldPitches.length === 1 &&
          oldPitches[0].kind === "breaking" &&
          oldPitches[0].type === "フォーク" &&
          oldPitches[0].level === 1 &&
          !oldPitches[0].customName;
        const legacyArsenal = oldPitches.some((pitch) => !pitch.kind);
        const pitcher = oldProspect.position === "投手";
        const savedPitching = oldProspect.pitching;
        const migratedArsenal = pitcher
          ? legacyArsenal || fallbackArsenal
            ? regenerateScoutPitchArsenal(migrated.seed, oldProspect.id, oldThrows)
            : normalizeArsenal(oldPitches, oldThrows, freshProspect.id)
          : null;
        Object.assign(freshProspect, oldProspect, {
          id: freshProspect.id,
          regionType: region.regionType,
          genius: oldProspect.genius ?? false,
          geniusRumor: oldProspect.geniusRumor ?? false,
          throws: oldThrows,
          position: oldProspect.position,
          pitching: pitcher ? {
            ...(savedPitching ?? freshProspect.pitching),
            pitches: migratedArsenal.map((pitch, pitchIndex) => ({
              ...pitch,
              id: `${freshProspect.id}-pitch-${pitchIndex + 1}`
            }))
          } : null
        });
        if (freshProspect.pitching && freshProspect.pitching.pitches.length === 0) {
          freshProspect.pitching.pitches = regenerateScoutPitchArsenal(migrated.seed, oldProspect.id, oldThrows)
            .map((pitch, pitchIndex) => ({ ...pitch, id: `${freshProspect.id}-pitch-${pitchIndex + 1}` }));
        }
        freshProspect.initialAbilities = structuredClone({
          abilities: freshProspect.abilities,
          trajectory: freshProspect.trajectory,
          pitching: freshProspect.pitching
        });
        if ((oldProspect.scoutAttempts ?? 0) > 0 || oldProspect.scouted) region.revealed = true;
      });
    });
  }
  migrated.scouting = {
    candidates: newCandidates,
    incomingIds: (oldScouting?.incomingIds ?? []).map((id) => idMap.get(id)).filter(Boolean),
    activeVisit: null
  };
  migrated.school.yearlyRecord ??= { wins: 0, losses: 0, ties: 0 };
  migrated.school.startingLineup ??= selectLineup(migrated.school.players).map((player) => player.id);
  migrated.alumni ??= [];
  migrated.seasons ??= [];
  migrated.notices ??= [];
  for (const player of migrated.school.players) {
    delete player.fatigue;
    player.careerStats = upgradeStatLine(player.careerStats);
    for (const [year, stats] of Object.entries(player.yearlyStats ?? {})) {
      player.yearlyStats[year] = upgradeStatLine(stats);
    }
    player.yearlyStats ??= {};
    player.trainingPlan ??= null;
    player.practiceProgress ??= {};
    player.abilityHistory ??= [];
    player.history ??= [];
    player.trajectory ??= 1;
    player.genius ??= false;
    player.pitchTrainingType ??= null;
    if (player.pitching) {
      player.pitching.pitches = normalizeArsenal(player.pitching.pitches, player.throws ?? "右", player.id);
      if (!player.pitching.pitches.length) player.pitching.pitches = [{ id: `${player.id}-pitch-1`, kind: "breaking", direction: "down", type: "フォーク", level: 1, customName: null }];
    }
    if (player.initialAbilities) player.initialAbilities.trajectory ??= player.trajectory;
    if (player.initialAbilities?.pitching) {
      player.initialAbilities.pitching.pitches = normalizeArsenal(player.initialAbilities.pitching.pitches, player.throws ?? "右", `${player.id}-initial`);
    }
  }
  for (const graduate of migrated.alumni) {
    delete graduate.fatigue;
    graduate.careerStats = upgradeStatLine(graduate.careerStats);
    graduate.yearlyStats ??= {};
    graduate.abilities ??= graduate.abilitiesAtGraduation ?? {};
    graduate.abilityHistory ??= [];
    graduate.history ??= [];
    graduate.pitching ??= null;
    graduate.genius ??= false;
    if (graduate.pitching) {
      graduate.pitching.pitches = normalizeArsenal(graduate.pitching.pitches, graduate.throws ?? "右", graduate.id);
      if (!graduate.pitching.pitches.length) graduate.pitching.pitches = [{ id: `${graduate.id}-pitch-1`, kind: "breaking", direction: "down", type: "フォーク", level: 1, customName: null }];
    }
    graduate.position ??= "不明";
    graduate.trajectory ??= 1;
  }
  for (const prospect of migrated.scouting.candidates.flatMap((region) => region.prospects)) {
    prospect.scoutAttempts ??= 0;
    prospect.scouted ??= false;
    prospect.enrolled ??= false;
    prospect.enrollmentYear ??= null;
    prospect.genius ??= false;
    prospect.geniusRumor ??= false;
    prospect.pitching ??= null;
    prospect.throws ??= "右";
    if (prospect.pitching) {
      prospect.pitching.pitches = normalizeArsenal(prospect.pitching.pitches, prospect.throws, prospect.id);
      if (!prospect.pitching.pitches.length) prospect.pitching.pitches = [{ id: `${prospect.id}-pitch-1`, kind: "breaking", direction: "down", type: "フォーク", level: 1, customName: null }];
    }
    delete prospect.fatigue;
  }
  for (const game of migrated.games) {
    for (const side of ["home", "away"]) {
      if (!game.playerStats?.[side]) continue;
      for (const [id, stats] of Object.entries(game.playerStats[side])) {
        game.playerStats[side][id] = upgradeStatLine(stats);
      }
    }
  }
  return validateState(migrated);
}

export function loadState() {
  const serialized = localStorage.getItem(SAVE_KEY);
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    const loaded = migrateState(parsed);
    if (loaded.schemaVersion !== parsed.schemaVersion) saveState(loaded);
    return loaded;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("保存データを読み取れません。JSON形式が壊れている可能性があります。");
    throw error;
  }
}

export function saveState(state) {
  validateState(state);
  const serialized = JSON.stringify(state);
  try {
    const previous = localStorage.getItem(SAVE_KEY);
    if (previous) localStorage.setItem(BACKUP_KEY, previous);
    localStorage.setItem(SAVE_KEY, serialized);
  } catch (error) {
    throw new Error(`自動保存に失敗しました: ${error.message}`);
  }
}

export function restoreBackup() {
  const backup = localStorage.getItem(BACKUP_KEY);
  if (!backup) throw new Error("復元できるバックアップがありません。");
  let state;
  try {
    state = migrateState(JSON.parse(backup));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("バックアップを読み取れません。");
    throw error;
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (error) {
    throw new Error(`バックアップ復元後の保存に失敗しました: ${error.message}`);
  }
  return state;
}

export function parseImport(serialized) {
  let state;
  try {
    state = JSON.parse(serialized);
  } catch {
    throw new Error("読み込んだファイルは有効なJSONではありません。");
  }
  return migrateState(state);
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kyushun-${state.date}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportRosterCsv(state) {
  const columns = ["id", "name", "grade", "position", "contact", "power", "trajectory", "speed", "arm", "fielding", "catching"];
  const rows = state.school.players.map((player) => [
    player.id, player.name, player.grade, player.position,
    player.abilities.contact, player.abilities.power, player.trajectory, player.abilities.speed,
    player.abilities.arm, player.abilities.fielding, player.abilities.catching
  ]);
  const csv = [columns, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kyushun-roster-${state.date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
