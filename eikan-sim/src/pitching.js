export const PITCH_DIRECTIONS = [
  { id: "right", label: "右" },
  { id: "rightDown", label: "右下" },
  { id: "down", label: "下" },
  { id: "leftDown", label: "左下" },
  { id: "left", label: "左" }
];

export const SECOND_STRAIGHT_TYPES = ["ツーシームファスト", "ムービングファスト", "イーファスピッチ", "チェンジオブペース"];

const RIGHT_HANDED_TYPES = {
  right: ["シュート", "Hシュート", "シンキングツーシーム"],
  rightDown: ["シンカー", "超高速シンカー", "サークルチェンジ", "ファストチェンジ", "シンキングスプリット"],
  down: ["フォーク", "SFF", "チェンジアップ", "Vスライダー", "パーム", "ナックル", "縦カット"],
  leftDown: ["カーブ", "スローカーブ", "ドロップカーブ", "スラーブ", "ナックルカーブ", "ドロップ", "Dスライダー"],
  left: ["スライダー", "スイーパー", "高速スライダー", "カットボール"]
};

const DIRECTION_MIRROR = {
  right: "left",
  rightDown: "leftDown",
  down: "down",
  leftDown: "rightDown",
  left: "right"
};

export function directionsForHand(throws) {
  if (throws === "左") {
    return PITCH_DIRECTIONS.map((direction) => ({
      id: DIRECTION_MIRROR[direction.id],
      label: PITCH_DIRECTIONS.find((item) => item.id === DIRECTION_MIRROR[direction.id]).label
    }));
  }
  return PITCH_DIRECTIONS;
}

export function pitchTypesForDirection(direction, throws) {
  if (throws !== "左") return RIGHT_HANDED_TYPES[direction] ?? [];
  const originalDirection = DIRECTION_MIRROR[direction];
  const types = RIGHT_HANDED_TYPES[originalDirection] ?? [];
  if (originalDirection === "rightDown") {
    return [...types.filter((type) => type !== "シンカー" && type !== "超高速シンカー"), "スクリュー"];
  }
  return types;
}

export function allPitchTypes(throws) {
  return PITCH_DIRECTIONS.flatMap(({ id }) => pitchTypesForDirection(id, throws));
}

export function pitchChangeTotal(pitches = []) {
  return pitches.reduce((total, pitch) => total + (pitch.kind === "breaking" ? pitch.level : 0), 0);
}

export function secondStraight(pitches = []) {
  return pitches.find((pitch) => pitch.kind === "second");
}

export function validateArsenal(pitches, throws, { maxPitches = 11, maxChange = 70 } = {}) {
  if (!Array.isArray(pitches) || pitches.length > maxPitches) return false;
  if (pitches.some((pitch) => !pitch.id || !["breaking", "second"].includes(pitch.kind))) return false;
  const second = pitches.filter((pitch) => pitch.kind === "second");
  if (second.length > 1 || second.some((pitch) => !SECOND_STRAIGHT_TYPES.includes(pitch.type) || pitch.level !== 1 || pitch.direction !== null)) return false;
  const breaking = pitches.filter((pitch) => pitch.kind === "breaking");
  if (breaking.length > 10) return false;
  if (breaking.some((pitch) =>
    !PITCH_DIRECTIONS.some(({ id }) => id === pitch.direction) ||
    !pitchTypesForDirection(pitch.direction, throws).includes(pitch.type) ||
    !Number.isInteger(pitch.level) || pitch.level < 1 || pitch.level > 7
  )) return false;
  if (new Set(pitches.map((pitch) => pitch.id)).size !== pitches.length) return false;
  const directionCounts = Object.fromEntries(PITCH_DIRECTIONS.map(({ id }) => [id, 0]));
  breaking.forEach((pitch) => { directionCounts[pitch.direction] += 1; });
  return Object.values(directionCounts).every((count) => count <= 2) && pitchChangeTotal(pitches) <= maxChange;
}

export function migrateArsenal(pitchData, throws, playerId) {
  if (!Array.isArray(pitchData)) return [];
  return pitchData
    .filter((pitch) => pitch.name && pitch.name !== "ストレート")
    .slice(0, 3)
    .map((pitch, index) => {
      const isKnownType = allPitchTypes(throws).includes(pitch.name);
      const type = pitch.name === "変化球" || !isKnownType ? "フォーク" : pitch.name;
      const direction = PITCH_DIRECTIONS.some(({ id }) => id === pitch.direction)
        ? pitch.direction
        : PITCH_DIRECTIONS.find(({ id }) => pitchTypesForDirection(id, throws).includes(type))?.id ?? "down";
      return {
        id: pitch.id ?? `${playerId}-pitch-${index + 1}`,
        kind: SECOND_STRAIGHT_TYPES.includes(pitch.name) ? "second" : "breaking",
        type: SECOND_STRAIGHT_TYPES.includes(pitch.name) ? pitch.name : type,
        direction: SECOND_STRAIGHT_TYPES.includes(pitch.name) ? null : direction,
        level: SECOND_STRAIGHT_TYPES.includes(pitch.name) ? 1 : Math.max(1, Math.min(7, Math.trunc(pitch.level ?? pitch.break ?? 1))),
        customName: pitch.customName ?? (isKnownType || pitch.name === "変化球" ? null : pitch.name)
      };
    });
}
