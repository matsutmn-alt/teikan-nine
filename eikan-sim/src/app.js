import { advanceDay, advanceDays } from "./career.js";
import { simulateGame, formatAverage, formatEra, formatOnBasePercentage, formatSluggingPercentage } from "./baseball.js";
import {
  ABILITY_LABELS, FIELD_POSITIONS, PREFECTURES, addScoutItems, createInitialState,
  beginScoutVisit, freshGameRandom, scoutProspect, SCOUT_REGION_TYPES, selectLineup, skipScoutVisit
} from "./team.js";
import { isPitchTraining, pitchTrainingTargetOptions, TRAINING_PLANS, validateTrainingPlan } from "./training.js";
import { exportRosterCsv, exportState, loadState, parseImport, restoreBackup, saveState } from "./persistence.js";
import { pitchChangeTotal } from "./pitching.js";

const $ = (id) => document.getElementById(id);
const views = ["dashboard", "roster", "scouting", "history"];
let state = null;
let selectedPlayerId = null;
let selectedGameId = null;
let activeView = "dashboard";
let rosterCategory = "field";
let rosterSort = "grade";
let noticeTimer;

function showNotice(message, isError = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  window.clearTimeout(noticeTimer);
  if (!isError) noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4500);
}

function withStateChange(action, successMessage) {
  if (!state) {
    showNotice("進行データがありません。新規スタートまたは有効なJSONの読み込みを行ってください。", true);
    return false;
  }
  const previous = structuredClone(state);
  try {
    action();
    saveState(state);
    render();
    if (successMessage) showNotice(successMessage);
    return true;
  } catch (error) {
    state = previous;
    render();
    showNotice(error instanceof Error ? error.message : String(error), true);
    return false;
  }
}

function fmtDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function recordText(record) {
  return `${record.wins}勝 ${record.losses}敗 ${record.ties}分`;
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = String(text);
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function daysInAcademicYear(year) {
  return (Date.UTC(year + 1, 3, 1) - Date.UTC(year, 3, 1)) / 86400000;
}

function dayOfAcademicYear() {
  const start = Date.parse(`${state.schoolYear}-04-01T00:00:00Z`);
  return Math.max(1, Math.floor((Date.parse(`${state.date}T00:00:00Z`) - start) / 86400000) + 1);
}

function renderDashboard() {
  $("school-name").textContent = state.school.name;
  $("academic-year").textContent = state.schoolYear;
  $("current-date").textContent = fmtDate(state.date);
  $("day-number").textContent = `年度 ${dayOfAcademicYear()} 日目`;
  $("season-wins").textContent = state.school.yearlyRecord.wins;
  $("season-losses").textContent = state.school.yearlyRecord.losses;
  $("season-ties").textContent = state.school.yearlyRecord.ties;
  $("career-record").textContent = recordText(state.school.record);
  $("active-player-count").textContent = `${state.school.players.length}名`;

  const training = $("training-plan");
  if (!training.options.length) {
    for (const [key, plan] of Object.entries(TRAINING_PLANS).filter(([key]) => !isPitchTraining(key))) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = plan.label;
      training.append(option);
    }
  }
  training.value = state.trainingPlan;
  $("training-description").textContent = trainingDescription(state.trainingPlan);

  const upcoming = state.schedule
    .filter((fixture) => !fixture.played && fixture.date >= state.date)
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  const nextFixture = $("next-fixture");
  nextFixture.replaceChildren();
  if (upcoming) {
    nextFixture.append(
      makeElement("span", "fixture-date", fmtDate(upcoming.date)),
      makeElement("strong", "fixture-name", upcoming.competition),
      makeElement("span", "fixture-description", "対戦相手と試合結果はシミュレーションで決定します。")
    );
  } else {
    nextFixture.append(makeElement("span", "fixture-description", "今シーズンの予定は終了しました。"));
  }
  const percent = (dayOfAcademicYear() / daysInAcademicYear(state.schoolYear)) * 100;
  $("season-progress").style.width = `${Math.min(100, percent)}%`;
  $("schedule-count").textContent = `${state.schedule.filter((fixture) => fixture.played).length} / ${state.schedule.length} 試合を消化`;

  const lineup = selectLineup(state.school.players, state.school.startingLineup);
  const preview = $("preview-players");
  preview.replaceChildren();
  lineup.forEach((player) => {
    const row = document.createElement("tr");
    row.dataset.playerId = player.id;
    const nameCell = addCell(row, "");
    nameCell.className = "player-cell";
    nameCell.append(makeElement("strong", "", player.name), makeElement("small", "", `${player.personality}${player.genius ? "・天才" : ""}`));
    addCell(row, `${player.grade}年・${player.position}`);
    addCell(row, player.abilities.contact);
    addCell(row, player.abilities.power);
    addCell(row, player.trajectory ?? 1);
    addCell(row, player.abilities.speed);
    addCell(row, player.pitching ? `${player.pitching.velocity} km/h` : "—");
    row.addEventListener("click", () => openPlayer(player.id));
    preview.append(row);
  });
  renderLineupEditor();

  $("notice-count").textContent = `${state.notices.length}件`;
  const noticeList = $("notice-list");
  noticeList.replaceChildren();
  state.notices.slice(0, 10).forEach((entry) => {
    const item = document.createElement("li");
    item.append(makeElement("time", "", entry.date), makeElement("span", "", entry.text));
    noticeList.append(item);
  });
  renderGrowthLog();
}

function renderGrowthLog() {
  const records = [...state.school.players, ...state.alumni]
    .flatMap((player) => (player.abilityHistory ?? []).map((entry) => ({ ...entry, playerName: player.name })))
    .sort((left, right) => right.date.localeCompare(left.date));
  $("growth-count").textContent = `${records.length}回`;
  const list = $("growth-list");
  list.replaceChildren();
  if (!records.length) {
    list.append(makeElement("li", "muted empty-growth", "能力アップはまだありません。練習を進めると、ここに記録されます。"));
    return;
  }
  records.slice(0, 30).forEach((record) => {
    const item = document.createElement("li");
    item.append(
      makeElement("time", "", record.date),
      makeElement("strong", "", record.playerName),
      makeElement("span", "growth-change", record.ability === "pitch"
        ? record.pitchMode === "improve" ? `${record.pitchName} 変化量 ${record.from} → ${record.to}` : `${record.pitchName} 習得`
        : `${ABILITY_LABELS[record.ability] ?? record.ability} ${record.from} → ${record.to}`),
      makeElement("small", "", TRAINING_PLANS[record.training]?.label ?? "練習")
    );
    list.append(item);
  });
}

function renderLineupEditor() {
  const editor = $("lineup-editor");
  editor.replaceChildren();
  const lineup = selectLineup(state.school.players, state.school.startingLineup);
  lineup.forEach((player, index) => {
    const row = makeElement("div", "lineup-row");
    row.append(makeElement("span", "lineup-order", `${index + 1}`));
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${index + 1}番打者`);
    const taken = new Set(state.school.startingLineup.filter((_, otherIndex) => otherIndex !== index));
    const candidates = state.school.players
      .filter((candidate) => candidate.position === player.position && (!taken.has(candidate.id) || candidate.id === player.id))
      .sort((left, right) => right.grade - left.grade || left.name.localeCompare(right.name, "ja"));
    candidates.forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = `${candidate.name}（${candidate.grade}年 ${candidate.position}）`;
      select.append(option);
    });
    select.value = player.id;
    select.addEventListener("change", () => {
      const nextLineup = [...state.school.startingLineup];
      nextLineup[index] = select.value;
      withStateChange(() => {
        selectLineup(state.school.players, nextLineup);
        state.school.startingLineup = nextLineup;
      }, "スターティングメンバーを更新しました。");
    });
    const controls = makeElement("span", "lineup-controls");
    for (const [delta, label] of [[-1, "↑"], [1, "↓"]]) {
      const move = makeElement("button", "lineup-move", label);
      move.type = "button";
      move.setAttribute("aria-label", `${index + 1}番の打順を${delta < 0 ? "上げる" : "下げる"}`);
      move.disabled = index + delta < 0 || index + delta >= lineup.length;
      move.addEventListener("click", () => {
        withStateChange(() => {
          [state.school.startingLineup[index], state.school.startingLineup[index + delta]] =
            [state.school.startingLineup[index + delta], state.school.startingLineup[index]];
        }, "打順を変更しました。");
      });
      controls.append(move);
    }
    row.append(select, controls);
    editor.append(row);
  });
}

function trainingDescription(key) {
  if (isPitchTraining(key)) {
    const plan = TRAINING_PLANS[key];
    return `投手の個別練習です。プロフィールで${plan.pitchTask.mode === "improve" ? "強化する球種" : "習得する球種"}を選択してください。`;
  }
  const descriptions = {
    batting: "ミートとパワーを中心に、弾道も育成します。成長量は独自の推定式です。",
    power: "パワーを重点的に、弾道も育成します。",
    running: "走力を重点的に育成します。",
    fielding: "守備力と捕球を育成します。",
    throwing: "肩力を育成します。",
    pitching: "投手の球速とコントロールを育成します。",
    stamina: "投手のスタミナを育成します。",
    rest: "能力練習を休みます（疲労の蓄積・管理はありません）。"
  };
  return descriptions[key] ?? "";
}

function renderRoster() {
  const fieldView = rosterCategory === "field";
  const sorted = state.school.players
    .filter((player) => fieldView ? player.position !== "投手" : player.position === "投手")
    .sort((left, right) => {
      const gradeOrder = right.grade - left.grade;
      const positionOrder = FIELD_POSITIONS.indexOf(left.position) - FIELD_POSITIONS.indexOf(right.position);
      return (rosterSort === "grade" ? gradeOrder || positionOrder : positionOrder || gradeOrder) || left.name.localeCompare(right.name, "ja");
    });
  $("roster-total").textContent = `${sorted.length}名`;
  const head = $("roster-head");
  head.replaceChildren();
  const columns = fieldView
    ? ["選手", "学年", "守備位置", "ミート", "パワー", "走力", "肩力", "守備", "捕球", "弾道 (1–4)", "個別練習"]
    : ["選手", "学年", "守備位置", "球速", "コントロール", "スタミナ", "球種・変化量", "個別練習"];
  columns.forEach((column) => addHeader(head, column));
  const tableBody = $("roster-players");
  tableBody.replaceChildren();
  for (const player of sorted) {
    const row = document.createElement("tr");
    row.dataset.playerId = player.id;
    if (player.id === selectedPlayerId) row.classList.add("selected");
    const nameCell = addCell(row, "");
    nameCell.className = "player-cell";
    nameCell.append(makeElement("strong", "", player.name), makeElement("small", "", `${player.personality}・${player.growthStyle}${player.genius ? "・天才" : ""}`));
    addCell(row, `${player.grade}年`, "grade-tag");
    addCell(row, player.position);
    if (fieldView) {
      for (const key of ["contact", "power", "speed", "arm", "fielding", "catching"]) addCell(row, player.abilities[key]);
      addCell(row, player.trajectory ?? 1);
    } else {
      addCell(row, `${player.pitching.velocity} km/h`);
      addCell(row, player.pitching.control);
      addCell(row, player.pitching.stamina);
      const pitchSummary = player.pitching.pitches.map((pitch) =>
        pitch.kind === "second" ? `${pitch.customName || pitch.type}（第二ストレート）` : `${pitch.customName || pitch.type} ${pitch.level}`
      ).join(" / ");
      addCell(row, `${pitchSummary || "球種なし"}・総${pitchChangeTotal(player.pitching.pitches)}`);
    }
    const trainingCell = addCell(row, "");
    trainingCell.className = "training-cell";
    const trainingSelect = document.createElement("select");
    trainingSelect.className = "player-training";
    trainingSelect.setAttribute("aria-label", `${player.name}の個別練習`);
    const inheritOption = document.createElement("option");
    inheritOption.value = "";
    inheritOption.textContent = `チーム方針（${TRAINING_PLANS[state.trainingPlan].label}）`;
    trainingSelect.append(inheritOption);
    for (const [key, plan] of Object.entries(TRAINING_PLANS)) {
      if (isPitchTraining(key) && !player.pitching) continue;
      const option = document.createElement("option");
      option.value = key;
      option.textContent = plan.label;
      trainingSelect.append(option);
    }
    trainingSelect.value = player.trainingPlan ?? "";
    trainingSelect.addEventListener("click", (event) => event.stopPropagation());
    trainingSelect.addEventListener("change", (event) => {
      const trainingPlan = event.target.value || null;
      withStateChange(() => {
        player.trainingPlan = trainingPlan;
        player.pitchTrainingType = null;
      }, `${player.name}の練習方針を${trainingPlan ? TRAINING_PLANS[trainingPlan].label : "チーム方針に従う"}に設定しました。`);
    });
    trainingCell.append(trainingSelect);
    row.addEventListener("click", () => openPlayer(player.id));
    tableBody.append(row);
  }
  renderPlayerDetail();
}

function renderScouting() {
  const prefectureSelect = $("scout-prefecture");
  const selectedPrefecture = prefectureSelect.value;
  prefectureSelect.replaceChildren();
  PREFECTURES.forEach((prefecture) => {
    const option = document.createElement("option");
    option.value = prefecture;
    const region = state.scouting.candidates.find((entry) => entry.prefecture === prefecture);
    option.textContent = `${prefecture} — ${SCOUT_REGION_TYPES[region.regionType].label}`;
    prefectureSelect.append(option);
  });
  if (PREFECTURES.includes(selectedPrefecture)) prefectureSelect.value = selectedPrefecture;
  $("scout-item-count").textContent = state.scoutItems;
  $("scout-committed-count").textContent = `${state.scouting.incomingIds.length} / 8人`;
  $("scouted-prospect-count").textContent = `${state.scouting.incomingIds.length} / 8人`;
  const recruitedProspects = state.scouting.incomingIds.map((id) => {
    const region = state.scouting.candidates.find((entry) => entry.prospects.some((prospect) => prospect.id === id));
    return region?.prospects.find((prospect) => prospect.id === id);
  }).filter(Boolean);
  const recruitedRows = $("scouted-prospects");
  recruitedRows.replaceChildren();
  recruitedProspects.forEach((prospect) => {
    const row = document.createElement("tr");
    const nameCell = addCell(row, "");
    nameCell.className = "player-cell";
    nameCell.append(makeElement("strong", "", prospect.name));
    if (prospect.genius) nameCell.append(makeElement("small", "genius-rumor", "天才"));
    addCell(row, prospect.prefecture);
    addCell(row, prospect.position);
    if (prospect.pitching) {
      addCell(row, `球速 ${prospect.pitching.velocity} km/h・制球 ${prospect.pitching.control}・スタミナ ${prospect.pitching.stamina}`);
      const pitchSummary = prospect.pitching.pitches.map((pitch) => pitch.kind === "second"
        ? `${pitch.customName || pitch.type}（第二ストレート）`
        : `${pitch.customName || pitch.type} ${pitch.level}`);
      addCell(row, `総変化量 ${pitchChangeTotal(prospect.pitching.pitches)} / 9（${pitchSummary.join(" / ")}）`);
    } else {
      addCell(row, `ミート ${prospect.abilities.contact}・パワー ${prospect.abilities.power}・走力 ${prospect.abilities.speed}・肩力 ${prospect.abilities.arm}・守備 ${prospect.abilities.fielding}・捕球 ${prospect.abilities.catching}`);
      addCell(row, prospect.trajectory);
    }
    addCell(row, `${prospect.enrollmentYear}年4月`);
    recruitedRows.append(row);
  });
  if (!recruitedProspects.length) {
    const row = document.createElement("tr");
    const cell = addCell(row, "スカウト済みの候補生はいません。候補選手をスカウトすると、ここに表示されます。");
    cell.colSpan = 6;
    cell.className = "muted";
    recruitedRows.append(row);
  }
  const region = state.scouting.candidates.find((entry) => entry.prefecture === prefectureSelect.value)
    ?? state.scouting.candidates.find((entry) => entry.prefecture === selectedPrefecture)
    ?? state.scouting.candidates[0];
  prefectureSelect.value = region.prefecture;
  const regionType = SCOUT_REGION_TYPES[region.regionType];
  $("scout-region-type").textContent = regionType.label;
  $("scout-region-description").textContent = region.specialty
    ? `${regionType.description}（${ABILITY_LABELS[region.specialty]}が特に高め）`
    : regionType.description;
  const visitButton = $("scout-visit");
  visitButton.textContent = region.revealed ? "アイテムを使って再訪" : "アイテムを使って候補を見る";
  visitButton.disabled = Boolean(state.scouting.activeVisit) || state.scoutItems < 1 || state.scouting.incomingIds.length >= 8;
  const skipButton = $("scout-skip");
  skipButton.hidden = state.scouting.activeVisit !== region.prefecture;
  const rows = $("scout-prospects");
  rows.replaceChildren();
  rows.hidden = !region.revealed;
  if (!region.revealed) return;
  const scoutingActive = state.scouting.activeVisit === region.prefecture;
  region.prospects.forEach((prospect) => {
    const row = document.createElement("tr");
    const nameCell = addCell(row, "");
    nameCell.className = "player-cell";
    nameCell.append(makeElement("strong", "", prospect.name));
    if (prospect.geniusRumor && !prospect.enrolled) nameCell.append(makeElement("small", "genius-rumor", "天才なのかもしれない"));
    else if (prospect.genius && prospect.enrolled) nameCell.append(makeElement("small", "genius-rumor", "天才"));
    addCell(row, prospect.position);
    if (prospect.position === "投手") {
      const pitchSummary = prospect.pitching.pitches.map((pitch) => pitch.kind === "second"
        ? `${pitch.customName || pitch.type}（第二ストレート）`
        : `${pitch.customName || pitch.type} 変化量${pitch.level}`);
      addCell(row, `球速 ${prospect.pitching.velocity} km/h・制球 ${prospect.pitching.control}・スタミナ ${prospect.pitching.stamina}・球種 ${pitchSummary.join(" / ")}`, "prospect-abilities");
    } else {
      addCell(row, `ミート ${prospect.abilities.contact}・パワー ${prospect.abilities.power}・走力 ${prospect.abilities.speed}・肩力 ${prospect.abilities.arm}・守備 ${prospect.abilities.fielding}・捕球 ${prospect.abilities.catching}`, "prospect-abilities");
    }
    addCell(row, prospect.position === "投手" ? `${pitchChangeTotal(prospect.pitching.pitches)} / 9` : prospect.trajectory);
    const status = prospect.enrolled
      ? "入学済み"
      : prospect.scouted
        ? "翌年度入学予定"
        : `試行 ${prospect.scoutAttempts}回・次回成功率 ${Math.round([75, 95, 100][prospect.scoutAttempts] ?? 100)}%`;
    addCell(row, status);
    const actionCell = addCell(row, "");
    const button = makeElement("button", "button button-secondary scout-action", prospect.scouted ? "スカウト済み" : prospect.enrolled ? "入学済み" : "スカウトする");
    button.type = "button";
    button.disabled = !scoutingActive || prospect.scouted || prospect.enrolled || state.scouting.incomingIds.length >= 8 || prospect.scoutAttempts >= 3;
    button.addEventListener("click", () => {
      let result;
      withStateChange(() => {
        result = scoutProspect(state, region.prefecture, prospect.id);
      });
      if (result) showNotice(result.success
        ? `${prospect.name}のスカウトに成功しました。次年度の入学予定です。`
        : `${prospect.name}は今回は応じませんでした。成功率は次回上がります。`);
    });
    actionCell.append(button);
    rows.append(row);
  });
}

function renderPlayerDetail() {
  const panel = $("player-detail");
  const player = state.school.players.find((item) => item.id === selectedPlayerId)
    ?? state.alumni.find((item) => item.id === selectedPlayerId);
  panel.replaceChildren();
  if (!player) {
    panel.append(
      makeElement("p", "eyebrow", "PLAYER PROFILE"),
      makeElement("h2", "", "選手を選択"),
      makeElement("p", "muted", "一覧から選手を選ぶと、能力と成長記録を表示します。")
    );
    return;
  }
  const isAlumni = !state.school.players.some((item) => item.id === player.id);
  panel.append(
    makeElement("p", "eyebrow", "PLAYER PROFILE"),
    makeElement("h2", "detail-name", player.name),
    makeElement("p", "detail-meta", `${isAlumni ? `${player.entryYear}年入学・${player.graduationYear}年卒業` : `${player.grade}年`} / ${player.position} / ${player.bats ?? "—"}打・${player.throws ?? "—"}投 / ${player.personality ?? "—"}・${player.growthStyle ?? "—"}${player.genius ? " / 天才" : ""}`)
  );
  const abilities = makeElement("div", "ability-grid");
  const abilityRows = player.position === "投手"
    ? [["velocity", "球速"], ["control", "コントロール"], ["stamina", "スタミナ"]]
    : [["contact", "ミート"], ["power", "パワー"], ["speed", "走力"], ["arm", "肩力"], ["fielding", "守備力"], ["catching", "捕球"], ["trajectory", "弾道"]];
  for (const [key, label] of abilityRows) {
    const item = makeElement("div", "ability-item");
    const value = key === "trajectory" ? player.trajectory ?? 1
      : key === "velocity" ? `${player.pitching?.velocity ?? "—"} km/h`
        : key === "control" || key === "stamina" ? player.pitching?.[key] ?? "—"
          : player.abilities?.[key] ?? "—";
    item.append(makeElement("span", "", label), makeElement("strong", "", key === "trajectory" ? `${value} / 4` : value));
    abilities.append(item);
  }
  panel.append(abilities);
  if (player.pitching) {
    panel.append(makeElement("p", "detail-meta", `変化球総量 ${pitchChangeTotal(player.pitching.pitches)} / 70　${player.pitching.pitches.map((pitch) => pitch.kind === "second"
      ? `${pitch.customName || pitch.type}（第二ストレート）`
      : `${pitch.customName || pitch.type}（変化量${pitch.level}）`).join("・") || "球種なし"}`));
    const arsenal = makeElement("div", "pitch-arsenal");
    player.pitching.pitches.forEach((pitch) => {
      const row = makeElement("div", "pitch-name-row");
      row.append(makeElement("span", "pitch-type-label", pitch.kind === "second" ? "第二ストレート" : `${pitch.type}・変化量${pitch.level}`));
      const input = document.createElement("input");
      input.value = pitch.customName || pitch.type;
      input.maxLength = 24;
      input.setAttribute("aria-label", `${pitch.type}の表示名`);
      const rename = makeElement("button", "button button-secondary", "名前を保存");
      rename.type = "button";
      rename.addEventListener("click", () => withStateChange(() => {
        const current = state.school.players.find((item) => item.id === player.id);
        const targetPitch = current?.pitching?.pitches.find((item) => item.id === pitch.id);
        if (!targetPitch) throw new Error("変更する球種が見つかりません。");
        targetPitch.customName = input.value.trim() === targetPitch.type ? null : input.value.trim() || null;
      }, "球種名を変更しました。"));
      row.append(input, rename);
      arsenal.append(row);
    });
    panel.append(arsenal);
  }
  if (!isAlumni && player.pitching) {
    const trainingPlan = player.trainingPlan ?? state.trainingPlan;
    if (isPitchTraining(trainingPlan)) {
      const targetOptions = pitchTrainingTargetOptions(player, trainingPlan);
      const label = makeElement("label", "pitch-target-label", "変化球練習の対象");
      const select = document.createElement("select");
      select.setAttribute("aria-label", "変化球練習の対象");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = targetOptions.length ? "球種を選択" : "選択できる球種がありません";
      select.append(placeholder);
      targetOptions.forEach(({ value, label: optionLabel }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = optionLabel;
        select.append(option);
      });
      select.value = player.pitchTrainingType ?? "";
      select.disabled = targetOptions.length === 0;
      select.addEventListener("change", (event) => withStateChange(() => {
        const current = state.school.players.find((item) => item.id === player.id);
        current.pitchTrainingType = event.target.value || null;
      }, "変化球練習の対象を設定しました。"));
      label.append(select);
      panel.append(label);
    }
  }
  if (!isAlumni) panel.append(makeElement("p", "detail-meta", `個別練習 ${player.trainingPlan ? TRAINING_PLANS[player.trainingPlan].label : `チーム方針（${TRAINING_PLANS[state.trainingPlan].label}）`} / コンディション ${player.condition}${player.genius ? " / 天才" : ""}`));
  const career = player.careerStats;
  panel.append(makeElement("h3", "stats-subheading", "通算個人成績"));
  panel.append(buildPersonalStatsTable(career, true));
  const yearlyStats = makeElement("div", "career-stats");
  yearlyStats.append(makeElement("h3", "stats-subheading", "年度別成績"));
  const seasons = Object.entries(player.yearlyStats ?? {}).sort(([left], [right]) => right.localeCompare(left));
  if (!seasons.length) yearlyStats.append(makeElement("p", "muted", "年度成績はまだありません。"));
  for (const [year, stats] of seasons) {
    const item = makeElement("div", "year-stat");
    item.append(makeElement("strong", "", `${year}年度`), buildPersonalStatsTable(stats, false));
    yearlyStats.append(item);
  }
  panel.append(yearlyStats);
  const historyTitle = makeElement("p", "eyebrow", "成長・在籍履歴");
  historyTitle.style.marginTop = "16px";
  panel.append(historyTitle);
  const history = makeElement("div", "compact-list");
  player.history.slice(-8).reverse().forEach((entry) => {
    const item = makeElement("div", "compact-item");
    item.append(makeElement("strong", "", entry.event), makeElement("small", "", entry.date));
    history.append(item);
  });
  panel.append(history);
}

function buildPersonalStatsTable(stats, includePitching) {
  const wrap = makeElement("div", "table-scroll career-stats");
  const table = document.createElement("table");
  const head = document.createElement("tr");
  const labels = ["試合", "PA", "AB", "打率", "出塁率", "長打率", "安打", "2B", "3B", "HR", "打点", "得点", "四球", "死球", "三振", "盗塁", "盗塁死", "失策"];
  if (includePitching) labels.push("投球回", "球数", "被安打", "自責点", "防御率", "奪三振", "与四球");
  labels.forEach((label) => addHeader(head, label));
  const thead = document.createElement("thead");
  thead.append(head);
  table.append(thead);
  const row = document.createElement("tr");
  const values = [
    stats.games, stats.plateAppearances, stats.atBats, formatAverage(stats),
    formatOnBasePercentage(stats), formatSluggingPercentage(stats), stats.hits, stats.doubles,
    stats.triples, stats.homeRuns, stats.runsBattedIn, stats.runs, stats.walks,
    stats.hitByPitch, stats.strikeouts, stats.stolenBases, stats.caughtStealing, stats.errors
  ];
  if (includePitching) {
    values.push(
      `${Math.floor(stats.outsPitched / 3)}.${stats.outsPitched % 3}`,
      stats.pitchCount, stats.hitsAllowed, stats.earnedRuns, formatEra(stats),
      stats.strikeoutsPitched, stats.walksAllowed
    );
  }
  values.forEach((value) => addCell(row, value));
  const tbody = document.createElement("tbody");
  tbody.append(row);
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function renderHistory() {
  $("game-count").textContent = `${state.games.length}試合`;
  const list = $("game-list");
  list.replaceChildren();
  state.games.forEach((game) => {
    const button = makeElement("button", `game-result${game.id === selectedGameId ? " selected" : ""}`);
    button.type = "button";
    const label = makeElement("span", "");
    label.append(
      makeElement("strong", "", game.summary),
      makeElement("small", "", `${game.date} · ${game.competition} · seed ${game.seed}`)
    );
    const result = game.winner === "home" ? "勝利" : game.winner === "away" ? "敗戦" : "引分";
    button.append(label, makeElement("span", `result-chip${game.winner === "away" ? " loss" : game.winner === "tie" ? " tie" : ""}`, result));
    button.addEventListener("click", () => {
      selectedGameId = game.id;
      renderHistory();
    });
    list.append(button);
  });

  const seasons = $("season-list");
  seasons.replaceChildren();
  state.seasons.forEach((season) => {
    const item = makeElement("div", "compact-item");
    item.append(
      makeElement("strong", "", `${season.year}年度`),
      makeElement("small", "", `${recordText(season.record)} · ${season.gamesPlayed}試合`)
    );
    seasons.append(item);
  });
  if (!state.seasons.length) seasons.append(makeElement("p", "muted", "年度終了後に記録が表示されます。"));

  $("alumni-count").textContent = `${state.alumni.length}名`;
  const alumni = $("alumni-list");
  alumni.replaceChildren();
  state.alumni.slice(0, 30).forEach((graduate) => {
    const item = makeElement("button", "compact-item player-history-link");
    item.type = "button";
    item.append(
      makeElement("strong", "", graduate.name),
      makeElement("small", "", `${graduate.entryYear}年入学・${graduate.graduationYear}年卒業`)
    );
    item.addEventListener("click", () => openPlayer(graduate.id));
    alumni.append(item);
  });
  if (!state.alumni.length) alumni.append(makeElement("p", "muted", "卒業生はいません。"));
  renderGameDetail();
}

function renderGameDetail() {
  const panel = $("game-detail");
  const game = state.games.find((item) => item.id === selectedGameId);
  panel.replaceChildren();
  if (!game) {
    panel.append(
      makeElement("p", "eyebrow", "BOX SCORE"),
      makeElement("h2", "", "試合を選択"),
      makeElement("p", "muted", "試合結果からイニング別スコアと個人成績を確認できます。")
    );
    return;
  }
  panel.append(makeElement("p", "eyebrow", "BOX SCORE"), makeElement("h2", "", `${game.competition} · ${game.date}`));
  panel.append(makeElement("p", "muted", game.ruleNote));
  const box = makeElement("div", "box-score");
  const table = document.createElement("table");
  const header = document.createElement("tr");
  addHeader(header, "");
  const maxInnings = Math.max(game.innings.away.length, game.innings.home.length);
  for (let inning = 0; inning < maxInnings; inning += 1) addHeader(header, `${inning + 1}`);
  addHeader(header, "R");
  const thead = document.createElement("thead");
  thead.append(header);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const side of ["away", "home"]) {
    const row = document.createElement("tr");
    addCell(row, game[side].name);
    for (let inning = 0; inning < maxInnings; inning += 1) {
      const run = game.innings[side][inning];
      addCell(row, run === undefined ? "—" : run);
    }
    addCell(row, game.score[side]);
    tbody.append(row);
  }
  table.append(tbody);
  box.append(table);
  panel.append(box);

  const statWrap = makeElement("div", "game-stat-list");
  statWrap.append(makeElement("h3", "stats-subheading", "試合別個人成績"));
  const participants = game.participants ?? { home: [], away: [] };
  for (const side of ["home", "away"]) {
    const stats = game.playerStats[side];
    const rows = participants[side].length
      ? participants[side].map((person) => [person, stats[person.id]]).filter(([, line]) => Boolean(line))
      : Object.entries(stats).filter(([, line]) => line.plateAppearances > 0).map(([id, line]) => [{ id, name: id, position: "" }, line]);
    if (!rows.length) continue;
    statWrap.append(makeElement("p", "detail-meta", `${side === "home" ? game.home.name : game.away.name} · 打撃`));
    const statTable = document.createElement("table");
    const head = document.createElement("tr");
    ["打順・選手", "守備", "PA", "AB", "打率", "出塁率", "長打率", "安打", "2B", "3B", "HR", "打点", "得点", "四球", "死球", "三振", "盗塁", "盗塁死", "失策"].forEach((heading) => addHeader(head, heading));
    const statHead = document.createElement("thead");
    statHead.append(head);
    statTable.append(statHead);
    const body = document.createElement("tbody");
    rows.forEach(([person, line], index) => {
      const row = document.createElement("tr");
      const nameCell = addCell(row, "");
      const playerLink = makeElement("button", "player-history-link", `${index + 1}番 ${person.name}`);
      playerLink.type = "button";
      playerLink.addEventListener("click", () => {
        if (state.school.players.some((player) => player.id === person.id) || state.alumni.some((player) => player.id === person.id)) {
          openPlayer(person.id);
        }
      });
      nameCell.append(playerLink);
      addCell(row, person.position);
      addCell(row, line.plateAppearances);
      addCell(row, line.atBats);
      addCell(row, formatAverage(line));
      addCell(row, formatOnBasePercentage(line));
      addCell(row, formatSluggingPercentage(line));
      addCell(row, line.hits);
      addCell(row, line.doubles);
      addCell(row, line.triples);
      addCell(row, line.homeRuns);
      addCell(row, line.runsBattedIn);
      addCell(row, line.runs);
      addCell(row, line.walks);
      addCell(row, line.hitByPitch);
      addCell(row, line.strikeouts);
      addCell(row, line.stolenBases);
      addCell(row, line.caughtStealing);
      addCell(row, line.errors);
      body.append(row);
    });
    statTable.append(body);
    statWrap.append(makeElement("p", "detail-meta", side === "home" ? game.home.name : game.away.name), statTable);
  }
  panel.append(statWrap);
  const pitchList = makeElement("div", "game-stat-list");
  pitchList.append(makeElement("h3", "stats-subheading", "投手成績"));
  for (const side of ["home", "away"]) {
    const pitchers = participants[side]?.filter((person) => game.playerStats[side][person.id]?.outsPitched > 0) ?? [];
    for (const pitcher of pitchers) {
      const line = game.playerStats[side][pitcher.id];
      pitchList.append(makeElement("p", "detail-meta", `${side === "home" ? game.home.name : game.away.name}: ${pitcher.name} / ${Math.floor(line.outsPitched / 3)}.${line.outsPitched % 3}回 / ${line.pitchCount}球 / ${line.hitsAllowed}被安打 / ${line.runsAllowed}失点 / ${line.earnedRuns}自責点 / 防御率 ${formatEra(line)} / ${line.strikeoutsPitched}奪三振 / ${line.walksAllowed}与四球 / ${line.homeRunsAllowed}被本塁打`));
    }
  }
  panel.append(pitchList);
}

function addHeader(row, text) {
  const cell = document.createElement("th");
  cell.textContent = text;
  row.append(cell);
}

function render() {
  if (!state) {
    for (const id of ["advance-day", "advance-game", "advance-month", "advance-year", "export-save", "export-csv", "training-plan"]) $(id).disabled = true;
    return;
  }
  for (const id of ["advance-day", "advance-game", "advance-month", "advance-year", "export-save", "export-csv", "training-plan"]) $(id).disabled = false;
  for (const view of views) $(view).hidden = view !== activeView;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === activeView));
  renderDashboard();
  renderRoster();
  renderScouting();
  renderHistory();
}

function openPlayer(playerId) {
  selectedPlayerId = playerId;
  activeView = "roster";
  render();
}

function advanceUntilGame() {
  const previousCount = state.games.length;
  for (let day = 0; day < 370 && state.games.length === previousCount; day += 1) advanceDay(state);
  if (state.games.length === previousCount) throw new Error("今後370日以内に予定試合が見つかりません。");
}

function advanceToNextMonth() {
  const [year, month] = state.date.split("-").map(Number);
  const initialMonth = month;
  for (let day = 0; day < 32; day += 1) {
    advanceDay(state);
    const nextMonth = Number(state.date.slice(5, 7));
    if (nextMonth !== initialMonth || Number(state.date.slice(0, 4)) !== year) return;
  }
  throw new Error("翌月への日付進行が完了しませんでした。");
}

function advanceAcademicYear() {
  const startingYear = state.schoolYear;
  for (let day = 0; day < 367 && state.schoolYear === startingYear; day += 1) advanceDay(state);
  if (state.schoolYear === startingYear) throw new Error("年度末に到達できませんでした。");
}

function initialize() {
  try {
    const saved = loadState();
    if (saved) state = saved;
    else {
      state = createInitialState();
      saveState(state);
    }
  } catch (error) {
    showNotice(`保存データを開けませんでした。データは置き換えていません。${error.message} バックアップ復元、JSON読込、新規スタートから選択してください。`, true);
  }
  render();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeView = tab.dataset.view;
    render();
  });
});
document.querySelectorAll("[data-open-view]").forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.openView;
    render();
  });
});
$("advance-day").addEventListener("click", () => withStateChange(() => advanceDay(state), "1日進行しました。"));
$("advance-game").addEventListener("click", () => withStateChange(advanceUntilGame, "次の試合まで進行しました。"));
$("advance-month").addEventListener("click", () => withStateChange(advanceToNextMonth, "翌月まで進行しました。"));
$("advance-year").addEventListener("click", () => withStateChange(advanceAcademicYear, "年度を更新しました。"));
$("training-plan").addEventListener("change", (event) => {
  const plan = event.target.value;
  if (!validateTrainingPlan(plan)) {
    showNotice("選択された練習方針は利用できません。", true);
    render();
    return;
  }
  withStateChange(() => { state.trainingPlan = plan; }, `${TRAINING_PLANS[plan].label}に設定しました。`);
});
$("roster-category").addEventListener("change", (event) => {
  if (!state) return;
  rosterCategory = event.target.value;
  const selected = state.school.players.find((player) => player.id === selectedPlayerId);
  if (selected && (rosterCategory === "pitcher") !== (selected.position === "投手")) selectedPlayerId = null;
  renderRoster();
});
$("roster-sort").addEventListener("change", (event) => {
  if (!state) return;
  rosterSort = event.target.value;
  renderRoster();
});
$("scout-prefecture").addEventListener("change", () => {
  if (state) renderScouting();
});
$("scout-visit").addEventListener("click", () => {
  const prefecture = $("scout-prefecture").value;
  withStateChange(() => beginScoutVisit(state, prefecture), "都道府県を訪問し、候補選手を公開しました。");
});
$("scout-skip").addEventListener("click", () => {
  withStateChange(() => skipScoutVisit(state), "今回の訪問をスキップしました。アイテムは消費済みです。");
});
$("scout-code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("scout-code").value;
  const amount = Number($("scout-code-amount").value);
  if (code !== "pass4150") {
    showNotice("パスコードが正しくありません。", true);
    return;
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
    showNotice("追加個数は1から1000000までの整数にしてください。", true);
    return;
  }
  const added = withStateChange(() => addScoutItems(state, amount), `${amount}個のスカウトアイテムを受け取りました。`);
  if (added) {
    $("scout-code").value = "";
  }
});
$("export-save").addEventListener("click", () => {
  try {
    exportState(state);
    showNotice("保存データをJSONで書き出しました。");
  } catch (error) {
    showNotice(`JSON書き出しに失敗しました: ${error.message}`, true);
  }
});
$("export-csv").addEventListener("click", () => {
  try {
    exportRosterCsv(state);
    showNotice("選手一覧をCSVで書き出しました。");
  } catch (error) {
    showNotice(`CSV書き出しに失敗しました: ${error.message}`, true);
  }
});
$("import-save").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const imported = parseImport(await file.text());
    saveState(imported);
    state = imported;
    selectedPlayerId = null;
    selectedGameId = null;
    render();
    showNotice("JSONデータを読み込みました。");
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    event.target.value = "";
  }
});
$("new-save").addEventListener("click", () => $("new-save-dialog").showModal());
$("new-save-form").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "confirm") return;
  event.preventDefault();
  try {
    const seed = Number($("new-seed").value);
    const name = $("new-school-name").value.trim();
    const nextState = createInitialState({ seed, schoolName: name });
    saveState(nextState);
    state = nextState;
    selectedPlayerId = null;
    selectedGameId = null;
    activeView = "dashboard";
    $("new-save-dialog").close();
    render();
    showNotice("新しい高校のシミュレーションを開始しました。");
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  }
});
$("restore-backup").addEventListener("click", () => {
  try {
    state = restoreBackup();
    selectedPlayerId = null;
    selectedGameId = null;
    render();
    showNotice("直前の自動バックアップを復元しました。");
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  }
});

initialize();
