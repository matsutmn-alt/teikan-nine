import { SeededRandom, hashSeed } from "./random.js";
import { PITCH_DIRECTIONS, pitchTypesForDirection, SECOND_STRAIGHT_TYPES } from "./pitching.js";
import { SURNAMES } from "./surnames.js";

export const ABILITY_LABELS = {
  contact: "ミート",
  power: "パワー",
  speed: "走力",
  arm: "肩力",
  fielding: "守備力",
  catching: "捕球",
  trajectory: "弾道",
  velocity: "球速",
  control: "コントロール",
  stamina: "スタミナ"
};

export const POSITIONS = ["投手", "捕手", "一塁手", "二塁手", "三塁手", "遊撃手", "外野手", "外野手", "外野手"];
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];
export const FIELD_POSITIONS = [...new Set(POSITIONS.filter((position) => position !== "投手"))];

const GIVEN_NAMES = ["悠真", "蓮", "陽翔", "湊", "大和", "蒼", "陸", "颯太", "樹", "結人", "晴", "健太", "拓海", "翔", "直樹"];
const GROWTH_STYLES = ["早熟", "普通", "晩成"];
const PERSONALITIES = ["努力家", "冷静", "負けず嫌い", "おおらか"];
const SCOUT_ATTEMPT_CHANCES = [0.75, 0.95, 1];
export const SCOUT_REGION_TYPES = {
  fielder: { label: "野手が強くなりやすい地域", description: "野手能力が高め" },
  pitcher: { label: "投手が強くなりやすい地域", description: "投手能力が高め" },
  specialty: { label: "一芸に秀でた選手が多い地域", description: "一つの能力が高め" },
  balanced: { label: "バランスのよい地域", description: "全体的に少し高め" },
  ordinary: { label: "特長のない地域", description: "標準的な能力分布" }
};

function normalAbility(rng, bonus = 0) {
  const u1 = Math.max(Number.EPSILON, rng.next());
  const u2 = rng.next();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(20, Math.min(69, Math.round(44 + bonus + normal * 10)));
}

function shuffled(items, rng) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(0, index);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function generatePitchArsenal(rng, throws, { prospect = false } = {}) {
  const directions = PITCH_DIRECTIONS.map(({ id }) => id);
  const pitches = [];
  const prospectHasSecond = prospect && rng.next() < 0.15;
  const pitchCount = prospect ? rng.int(prospectHasSecond ? 2 : 1, 3) : rng.int(1, 4);
  const breakingCount = pitchCount - Number(prospectHasSecond);
  let changeTotal = 0;
  for (let index = 0; index < breakingCount; index += 1) {
    const availableDirections = directions.filter((direction) =>
      pitches.filter((pitch) => pitch.direction === direction && pitch.kind === "breaking").length < 2
    );
    const direction = rng.pick(availableDirections);
    const type = rng.pick(pitchTypesForDirection(direction, throws));
    const remaining = (prospect ? 9 : 70) - changeTotal;
    const level = rng.int(1, Math.min(prospect ? 3 : 5, remaining));
    pitches.push({
      id: `${prospect ? "scout" : "pitch"}-${index + 1}`,
      kind: "breaking",
      direction,
      type,
      level,
      customName: null
    });
    changeTotal += level;
  }
  if ((!prospect && rng.next() < 0.3) || prospectHasSecond) {
    pitches.push({
      id: `pitch-${pitches.length + 1}`,
      kind: "second",
      direction: null,
      type: rng.pick(SECOND_STRAIGHT_TYPES),
      level: 1,
      customName: null
    });
  }
  return pitches;
}

export function regenerateScoutPitchArsenal(seed, prospectId, throws) {
  const rng = new SeededRandom(hashSeed(`${seed}:scout-arsenal:${prospectId}`));
  return generatePitchArsenal(rng, throws, { prospect: true });
}

export function emptyStats() {
  return {
    games: 0,
    plateAppearances: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    runsBattedIn: 0,
    runs: 0,
    walks: 0,
    hitByPitch: 0,
    hitByPitchAllowed: 0,
    strikeouts: 0,
    sacrificeFlies: 0,
    stolenBases: 0,
    caughtStealing: 0,
    errors: 0,
    outsPitched: 0,
    pitchCount: 0,
    hitsAllowed: 0,
    runsAllowed: 0,
    earnedRuns: 0,
    walksAllowed: 0,
    strikeoutsPitched: 0,
    homeRunsAllowed: 0
  };
}

export function createPlayer({ rng, id, entryYear, grade, position }) {
  const ability = (min, max) => rng.int(min, max);
  const isPitcher = position === "投手";
  const classBonus = (grade - 1) * 5;
  const throws = rng.pick(["右", "左"]);
  const player = {
    id,
    name: `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`,
    entryYear,
    graduationYear: entryYear + 3,
    grade,
    position,
    bats: rng.pick(["右", "左"]),
    throws,
    personality: rng.pick(PERSONALITIES),
    growthStyle: rng.pick(GROWTH_STYLES),
    genius: false,
    condition: 0,
    role: isPitcher ? "投手候補" : "野手",
    trainingPlan: null,
    pitchTrainingType: null,
    trajectory: rng.int(1, 4),
    abilities: {
      contact: ability(25 + classBonus, 52 + classBonus),
      power: ability(25 + classBonus, 52 + classBonus),
      speed: ability(30 + classBonus, 58 + classBonus),
      arm: ability(30 + classBonus, 58 + classBonus),
      fielding: ability(28 + classBonus, 56 + classBonus),
      catching: ability(28 + classBonus, 56 + classBonus)
    },
    pitching: isPitcher
      ? { velocity: ability(118 + classBonus, 138 + classBonus), control: ability(30 + classBonus, 58 + classBonus), stamina: ability(30 + classBonus, 58 + classBonus), pitches: generatePitchArsenal(rng, throws) }
      : null,
    traits: [],
    initialAbilities: null,
    abilityHistory: [],
    practiceProgress: {},
    careerStats: emptyStats(),
    yearlyStats: {},
    history: [{ date: `${entryYear}-04-01`, event: "入学・能力生成" }]
  };
  player.initialAbilities = structuredClone({ abilities: player.abilities, trajectory: player.trajectory, pitching: player.pitching });
  return player;
}

function createClass({ rng, year, grade, nextId, count = POSITIONS.length }) {
  const positions = POSITIONS.slice();
  while (positions.length < count) positions.push(rng.pick(FIELD_POSITIONS));
  return positions.slice(0, count).map((position) => {
    const id = `p-${year}-${String(nextId()).padStart(4, "0")}`;
    return createPlayer({ rng, id, entryYear: year, grade, position });
  });
}

function createRandomStates(seed) {
  return {
    generation: hashSeed(`${seed}:generation`),
    training: hashSeed(`${seed}:training`),
    games: hashSeed(`${seed}:games`)
  };
}

function scheduleForYear(year) {
  return [
    ["05-10", "春季練習試合"],
    ["07-15", "夏季練習試合"],
    ["09-20", "秋季練習試合"],
    ["11-03", "秋季練習試合"],
    ["02-14", "冬季練習試合"],
    ["03-20", "春季練習試合"]
  ].map(([monthDay, competition], index) => {
    const scheduleYear = monthDay.startsWith("0") && ["02", "03"].includes(monthDay.slice(0, 2)) ? year + 1 : year;
    return { id: `fixture-${year}-${index + 1}`, date: `${scheduleYear}-${monthDay}`, competition, played: false };
  });
}

export function createInitialState({ seed = 2026, schoolName = "青葉高校" } = {}) {
  const numericSeed = Number(seed);
  if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 0xffffffff) {
    throw new RangeError("乱数シードは0から4294967295までの整数にしてください。");
  }
  const normalizedName = String(schoolName).trim();
  if (!normalizedName || normalizedName.length > 30) throw new RangeError("学校名は1文字以上30文字以内で指定してください。");
  const randomStates = createRandomStates(numericSeed);
  const rng = new SeededRandom(randomStates.generation);
  let nextPlayerId = 1;
  const nextId = () => nextPlayerId++;
  const players = [];
  for (let grade = 3; grade >= 1; grade -= 1) {
    players.push(...createClass({ rng, year: 2026 - grade + 1, grade, nextId, count: grade === 1 ? 10 : 9 }));
  }
  randomStates.generation = rng.state;
  return {
    schemaVersion: 7,
    seed: numericSeed,
    schoolYear: 2026,
    date: "2026-04-01",
    nextPlayerId,
    school: {
      name: normalizedName,
      players,
      startingLineup: selectLineup(players).map((player) => player.id),
      record: { wins: 0, losses: 0, ties: 0 },
      yearlyRecord: { wins: 0, losses: 0, ties: 0 }
    },
    trainingPlan: "batting",
    scoutItems: 0,
    randomStates,
    schedule: scheduleForYear(2026),
    games: [],
    seasons: [],
    alumni: [],
    scouting: {
      candidates: createScoutCandidates(numericSeed, 2026),
      incomingIds: [],
      activeVisit: null
    },
    notices: [{ date: "2026-04-01", text: "新年度が始まりました。新入生が入学しました。" }]
  };
}

export function createScoutCandidates(seed, schoolYear) {
  const regionRandom = new SeededRandom(hashSeed(`${seed}:scouting-regions:${schoolYear}`));
  const regionTypes = [
    ...Array(9).fill("fielder"),
    ...Array(9).fill("pitcher"),
    ...Array(9).fill("specialty"),
    ...Array(10).fill("balanced"),
    ...Array(10).fill("ordinary")
  ];
  const shuffledRegionTypes = shuffled(regionTypes, regionRandom);
  return PREFECTURES.map((prefecture, prefectureIndex) => {
    const rng = new SeededRandom(hashSeed(`${seed}:scouting:${schoolYear}:${prefectureIndex}`));
    const regionType = shuffledRegionTypes[prefectureIndex];
    const specialty = regionType === "specialty" ? rng.pick(["contact", "power", "speed", "arm", "fielding", "catching"]) : null;
    const positions = ["投手", "投手", "捕手"];
    while (positions.length < 8) positions.push(rng.pick(FIELD_POSITIONS));
    const prospects = positions.map((position, index) => {
      const isPitcher = position === "投手";
      const fieldBonus = regionType === "fielder" ? 8 : regionType === "balanced" ? 4 : regionType === "specialty" ? 0 : 0;
      const specialtyBonus = regionType === "specialty" ? 16 : 0;
      const pitchingBonus = regionType === "pitcher" ? 8 : regionType === "balanced" ? 4 : 0;
      const throws = rng.pick(["右", "左"]);
      const rumoredGenius = rng.next() < 0.04;
      const player = {
        id: `scout-${schoolYear}-${String(prefectureIndex + 1).padStart(2, "0")}-${index + 1}`,
        name: `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_NAMES)}`,
        entryYear: schoolYear + 1,
        graduationYear: schoolYear + 4,
        grade: 1,
        position,
        bats: rng.pick(["右", "左"]),
        throws,
        personality: rng.pick(PERSONALITIES),
        growthStyle: rng.pick(GROWTH_STYLES),
        geniusRumor: rumoredGenius,
        genius: rumoredGenius && rng.next() < 0.8,
        condition: 0,
        role: isPitcher ? "投手候補" : "野手",
        trainingPlan: null,
        pitchTrainingType: null,
        trajectory: rng.int(1, 2),
        abilities: Object.fromEntries(["contact", "power", "speed", "arm", "fielding", "catching"].map((key) => [
          key,
          normalAbility(rng, fieldBonus + (specialty === key ? specialtyBonus : 0))
        ])),
        pitching: isPitcher
          ? {
            velocity: Math.max(110, Math.min(155, Math.round(125 + (normalAbility(rng, pitchingBonus + (specialty === "power" ? specialtyBonus : 0)) - 44) * 0.45))),
            control: normalAbility(rng, pitchingBonus + (specialty === "contact" ? specialtyBonus : 0)),
            stamina: normalAbility(rng, pitchingBonus + (specialty === "speed" ? specialtyBonus : 0)),
            pitches: generatePitchArsenal(rng, throws, { prospect: true })
          }
          : null,
        traits: [],
        abilityHistory: [],
        practiceProgress: {},
        careerStats: emptyStats(),
        yearlyStats: {},
        history: [],
        prefecture,
        regionType,
        specialty,
        scoutAttempts: 0,
        scouted: false,
        enrolled: false,
        enrollmentYear: null
      };
      player.initialAbilities = structuredClone({ abilities: player.abilities, trajectory: player.trajectory, pitching: player.pitching });
      return player;
    });
    return { prefecture, regionType, specialty, revealed: false, prospects };
  });
}

export function beginScoutVisit(state, prefecture) {
  const region = state.scouting?.candidates?.find((item) => item.prefecture === prefecture);
  if (!region) throw new Error("スカウト先の都道府県が見つかりません。");
  if (state.scouting.activeVisit) throw new Error("現在の訪問をスキップまたはスカウトしてから次へ進んでください。");
  if (state.scouting.incomingIds.length >= 8) throw new Error("今年度のスカウト入学枠（最大8人）は埋まっています。");
  if (!region.revealed && state.scoutItems < 1) throw new Error("候補を見るにはスカウトアイテムが1個必要です。");
  if (!region.revealed) {
    state.scoutItems -= 1;
    region.revealed = true;
  } else {
    if (state.scoutItems < 1) throw new Error("再訪にはスカウトアイテムが1個必要です。");
    state.scoutItems -= 1;
  }
  state.scouting.activeVisit = prefecture;
}

export function skipScoutVisit(state) {
  if (!state.scouting.activeVisit) throw new Error("スキップできる訪問がありません。");
  state.scouting.activeVisit = null;
}

export function scoutProspect(state, prefecture, prospectId) {
  const region = state.scouting?.candidates?.find((item) => item.prefecture === prefecture);
  const prospect = region?.prospects.find((item) => item.id === prospectId);
  if (!prospect) throw new Error("スカウト候補が見つかりません。");
  if (prospect.scouted || prospect.enrolled) throw new Error("この選手はすでにスカウト済みです。");
  if (!region.revealed || state.scouting.activeVisit !== prefecture) throw new Error("先にスカウトアイテムを使って都道府県を訪問してください。");
  const incoming = state.scouting.incomingIds;
  if (incoming.length >= 8) throw new Error("今年度のスカウト入学枠（最大8人）は埋まっています。");
  const chance = SCOUT_ATTEMPT_CHANCES[Math.min(prospect.scoutAttempts, SCOUT_ATTEMPT_CHANCES.length - 1)];
  prospect.scoutAttempts += 1;
  const rng = new SeededRandom(hashSeed(`${state.seed}:scout:${state.schoolYear}:${prospect.id}:${prospect.scoutAttempts}`));
  if (rng.next() < chance) {
    prospect.scouted = true;
    prospect.enrollmentYear = state.schoolYear + 1;
    prospect.entryYear = state.schoolYear + 1;
    prospect.graduationYear = state.schoolYear + 4;
    incoming.push(prospect.id);
    state.scouting.activeVisit = null;
    state.notices.unshift({ date: state.date, text: `${prospect.prefecture}の${prospect.name}をスカウトしました。次年度の入学予定です。` });
    return { success: true, chance, attempts: prospect.scoutAttempts };
  }
  state.scouting.activeVisit = null;
  state.notices.unshift({ date: state.date, text: `${prospect.prefecture}の${prospect.name}はスカウトに応じませんでした。` });
  return { success: false, chance, attempts: prospect.scoutAttempts };
}

export function addScoutItems(state, amount) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
    throw new RangeError("追加するスカウトアイテムは1から1000000までの整数にしてください。");
  }
  state.scoutItems += amount;
}

export function createOpponent({ rng, gameId }) {
  let nextId = 1;
  const players = [];
  for (let grade = 3; grade >= 1; grade -= 1) {
    for (const position of POSITIONS) {
      players.push(createPlayer({
        rng,
        id: `op-${gameId}-${String(nextId++).padStart(2, "0")}`,
        entryYear: 2026 - grade + 1,
        grade,
        position
      }));
    }
  }
  return {
    id: `opponent-${gameId}`,
    name: rng.pick(["白峰高校", "北陵高校", "緑川高校", "星見台高校", "桜丘高校"]),
    players,
    record: { wins: 0, losses: 0, ties: 0 }
  };
}

export function selectLineup(players, selectedIds = null) {
  if (selectedIds) {
    if (!Array.isArray(selectedIds) || selectedIds.length !== 9 || new Set(selectedIds).size !== 9) {
      throw new Error("スタメンは重複なしの9人で設定してください。");
    }
    const byId = new Map(players.map((player) => [player.id, player]));
    const lineup = selectedIds.map((id) => byId.get(id));
    if (lineup.some((player) => !player)) throw new Error("スタメンに在籍していない選手が含まれています。");
    const positionCounts = lineup.reduce((counts, player) => {
      counts[player.position] = (counts[player.position] ?? 0) + 1;
      return counts;
    }, {});
    const requiredPositions = ["投手", "捕手", "一塁手", "二塁手", "三塁手", "遊撃手", "外野手", "外野手", "外野手"];
    if (requiredPositions.some((position) => positionCounts[position] !== requiredPositions.filter((item) => item === position).length)) {
      throw new Error("スタメンには投手・捕手・内野手4人・外野手3人を1人ずつ登録してください。");
    }
    return lineup;
  }
  const available = players.slice();
  const lineup = [];
  for (const position of POSITIONS) {
    const candidates = available.filter((player) => player.position === position);
    const pool = candidates.length ? candidates : available.filter((player) => player.position !== "投手");
    if (!pool.length) throw new Error("試合に必要な選手が不足しています。");
    pool.sort((left, right) => overallForPosition(right, position) - overallForPosition(left, position));
    const selected = pool[0];
    lineup.push(selected);
    available.splice(available.findIndex((player) => player.id === selected.id), 1);
  }
  return lineup;
}

export function overallForPosition(player, position = player.position) {
  const abilities = player.abilities;
  const values = position === "投手" && player.pitching
    ? [player.pitching.velocity - 100, player.pitching.control, player.pitching.stamina, abilities.fielding]
    : position === "捕手"
      ? [abilities.contact, abilities.power, abilities.arm, abilities.catching, abilities.fielding]
      : [abilities.contact, abilities.power, abilities.speed, abilities.arm, abilities.fielding];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getYearStats(player, year) {
  if (!player.yearlyStats[year]) player.yearlyStats[year] = emptyStats();
  return player.yearlyStats[year];
}

export function makeGenerationRandom(state) {
  const rng = new SeededRandom(state.randomStates.generation);
  return {
    rng,
    commit() {
      state.randomStates.generation = rng.state;
    }
  };
}

export function createScheduleForYear(year) {
  return scheduleForYear(year);
}

export function recruitClass(state, year, count = 10) {
  const { rng, commit } = makeGenerationRandom(state);
  const students = createClass({
    rng,
    year,
    grade: 1,
    nextId: () => state.nextPlayerId++,
    count
  });
  commit();
  return students;
}

export function freshGameRandom(state) {
  const rng = new SeededRandom(state.randomStates.games);
  const gameSeed = rng.nextUint32();
  state.randomStates.games = rng.state;
  return new SeededRandom(gameSeed);
}
