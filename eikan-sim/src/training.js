import { SeededRandom } from "./random.js";
import { PITCH_DIRECTIONS, pitchChangeTotal, pitchTypesForDirection, SECOND_STRAIGHT_TYPES } from "./pitching.js";

const pitchTrainingPlans = Object.fromEntries(PITCH_DIRECTIONS.flatMap(({ id, label }) => [
  [`pitch-learn-${id}`, { label: `変化球取得（${label}）`, targets: {}, pitchTask: { mode: "learn", direction: id } }],
  [`pitch-up-${id}`, { label: `変化量アップ（${label}）`, targets: {}, pitchTask: { mode: "improve", direction: id } }]
]));

export const TRAINING_PLANS = {
  batting: { label: "打撃練習", targets: { contact: 1.25, power: 0.8, trajectory: 0.22 } },
  power: { label: "筋力練習", targets: { power: 1.45, trajectory: 0.12 } },
  running: { label: "走塁練習", targets: { speed: 1.45 } },
  fielding: { label: "守備練習", targets: { fielding: 1.1, catching: 0.8 } },
  throwing: { label: "送球練習", targets: { arm: 1.4 } },
  pitching: { label: "投球練習", targets: { velocity: 0.7, control: 1.05 } },
  stamina: { label: "走り込み", targets: { stamina: 1.35 } },
  rest: { label: "休養", targets: {} },
  ...pitchTrainingPlans,
  "pitch-second": { label: "第二ストレート取得", targets: {}, pitchTask: { mode: "second" } }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function growthRate(player) {
  const gradeMultiplier = player.grade === 1 ? 1.18 : player.grade === 2 ? 1 : 0.76;
  const personalityMultiplier = player.personality === "努力家" ? 1.08 : 1;
  const styleMultiplier = player.growthStyle === "早熟"
    ? player.grade === 1 ? 1.12 : 0.93
    : player.growthStyle === "晩成"
      ? player.grade === 3 ? 1.12 : 0.94
      : 1;
  return gradeMultiplier * personalityMultiplier * styleMultiplier * (player.genius ? 1.2 : 1);
}

function abilityValue(player, ability) {
  if (ability === "trajectory") return player.trajectory;
  return ability === "velocity" ? player.pitching?.velocity : ability === "control" || ability === "stamina" ? player.pitching?.[ability] : player.abilities[ability];
}

function setAbility(player, ability, value) {
  if (ability === "trajectory") player.trajectory = value;
  else if (ability === "velocity") player.pitching.velocity = value;
  else if (ability === "control" || ability === "stamina") player.pitching[ability] = value;
  else player.abilities[ability] = value;
}

export function applyTrainingDay(state, date) {
  const rng = new SeededRandom(state.randomStates.training);
  const plan = TRAINING_PLANS[state.trainingPlan];
  if (!plan) throw new Error(`不明な練習方針です: ${state.trainingPlan}`);

  for (const player of state.school.players) {
    if (Number(date.slice(-2)) % 7 === 0 && rng.next() < 0.18) {
      player.condition = clamp(player.condition + (rng.next() < 0.5 ? -1 : 1), -2, 2);
    }
    const trainingPlan = player.trainingPlan ?? state.trainingPlan;
    const playerPlan = TRAINING_PLANS[trainingPlan];
    if (!playerPlan) throw new Error(`選手「${player.name}」の練習方針が不正です: ${trainingPlan}`);
    if (trainingPlan === "rest") continue;
    if (playerPlan.pitchTask) {
      applyPitchTraining(player, playerPlan, date, rng);
      continue;
    }
    for (const [ability, weight] of Object.entries(playerPlan.targets)) {
      if (["velocity", "control", "stamina"].includes(ability) && !player.pitching) continue;
      const current = abilityValue(player, ability);
      const cap = ability === "trajectory" ? 4 : ability === "velocity" ? 165 : 100;
      if (current >= cap) continue;
      const variation = 0.82 + rng.next() * 0.36;
      const conditionFactor = 1 + player.condition * 0.025;
      const accumulation = 0.1 * weight * growthRate(player) * conditionFactor * variation;
      player.practiceProgress[ability] = (player.practiceProgress[ability] ?? 0) + accumulation;
      const points = Math.floor(player.practiceProgress[ability]);
      if (points > 0) {
        const next = Math.min(cap, current + points);
        setAbility(player, ability, next);
        player.practiceProgress[ability] -= points;
        player.abilityHistory.push({ date, ability, from: current, to: next, training: trainingPlan });
        player.history.push({ date, event: `${playerPlan.label}で${ability}が${next - current}成長` });
      }
    }
  }
  state.randomStates.training = rng.state;
}

function applyPitchTraining(player, plan, date, rng) {
  if (!player.pitching) return;
  const task = plan.pitchTask;
  const target = player.pitchTrainingType;
  if (!target) return;
  const pitches = player.pitching.pitches;
  let pitch = null;
  let valid = false;
  if (task.mode === "learn") {
    valid = pitchTypesForDirection(task.direction, player.throws).includes(target) &&
      !pitches.some((item) => item.kind === "breaking" && item.type === target) &&
      pitches.filter((item) => item.kind === "breaking" && item.direction === task.direction).length < 2 &&
      pitches.filter((item) => item.kind === "breaking").length < 10;
  } else if (task.mode === "improve") {
    pitch = pitches.find((item) => item.id === target && item.kind === "breaking" && item.direction === task.direction);
    valid = Boolean(pitch && pitch.level < 7 && pitches.reduce((sum, item) => sum + (item.kind === "breaking" ? item.level : 0), 0) < 70);
  } else if (task.mode === "second") {
    valid = SECOND_STRAIGHT_TYPES.includes(target) && !pitches.some((item) => item.kind === "second");
  }
  if (!valid) return;

  const progressKey = `pitch-${task.mode}-${target}`;
  const accumulation = 0.1 * growthRate(player) * (0.82 + rng.next() * 0.36) * (1 + player.condition * 0.025);
  player.practiceProgress[progressKey] = (player.practiceProgress[progressKey] ?? 0) + accumulation;
  if (player.practiceProgress[progressKey] < 1) return;
  player.practiceProgress[progressKey] -= 1;

  let from;
  let to;
  if (task.mode === "learn") {
    pitch = {
      id: `${player.id}-pitch-${pitches.length + 1}`,
      kind: "breaking",
      direction: task.direction,
      type: target,
      level: 1,
      customName: null
    };
    pitches.push(pitch);
    from = 0;
    to = 1;
  } else if (task.mode === "improve") {
    from = pitch.level;
    pitch.level += 1;
    to = pitch.level;
  } else {
    pitch = {
      id: `${player.id}-pitch-${pitches.length + 1}`,
      kind: "second",
      direction: null,
      type: target,
      level: 1,
      customName: null
    };
    pitches.push(pitch);
    from = 0;
    to = 1;
  }
  player.abilityHistory.push({
    date,
    ability: "pitch",
    pitchId: pitch.id,
    pitchName: pitch.customName || pitch.type,
    pitchMode: task.mode,
    from,
    to,
    training: player.trainingPlan ?? statePlanFallback(plan)
  });
  player.history.push({ date, event: `${plan.label}で${pitch.customName || pitch.type}${task.mode === "improve" ? `の変化量が${to}に成長` : "を習得"}` });
}

function statePlanFallback(plan) {
  return Object.keys(TRAINING_PLANS).find((key) => TRAINING_PLANS[key] === plan) ?? "pitching";
}

export function pitchTrainingTargetOptions(player, trainingPlan) {
  const plan = TRAINING_PLANS[trainingPlan];
  if (!player.pitching || !plan?.pitchTask) return [];
  const task = plan.pitchTask;
  if (task.mode === "learn") {
    const breakingPitches = player.pitching.pitches.filter((pitch) => pitch.kind === "breaking");
    if (breakingPitches.length >= 10 || breakingPitches.filter((pitch) => pitch.direction === task.direction).length >= 2) return [];
    return pitchTypesForDirection(task.direction, player.throws)
      .filter((type) => !player.pitching.pitches.some((pitch) => pitch.kind === "breaking" && pitch.type === type))
      .map((type) => ({ value: type, label: type }));
  }
  if (task.mode === "improve") {
    if (pitchChangeTotal(player.pitching.pitches) >= 70) return [];
    return player.pitching.pitches
      .filter((pitch) => pitch.kind === "breaking" && pitch.direction === task.direction && pitch.level < 7)
      .map((pitch) => ({ value: pitch.id, label: `${pitch.customName || pitch.type}（変化量${pitch.level}）` }));
  }
  if (task.mode === "second") {
    return SECOND_STRAIGHT_TYPES
      .filter((type) => !player.pitching.pitches.some((pitch) => pitch.kind === "second" && pitch.type === type))
      .map((type) => ({ value: type, label: type }));
  }
  return [];
}

export function isPitchTraining(plan) {
  return Boolean(TRAINING_PLANS[plan]?.pitchTask);
}

export function validateTrainingPlan(plan) {
  return Object.hasOwn(TRAINING_PLANS, plan);
}
