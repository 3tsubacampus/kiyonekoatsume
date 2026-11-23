"use strict";

// ============================================================
// キヨ猫あつめ
// ============================================================

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const titleScreen = document.getElementById("title-screen");
const gameScreen = document.getElementById("game-screen");
const startButton = document.getElementById("start-button");
const goalValue = document.getElementById("goal-value");
const moneyValue = document.getElementById("money-value");

const popupOverlay = document.getElementById("popup-overlay");
const popupTitle = document.getElementById("popup-title");
const popupContent = document.getElementById("popup-content");
const popupClose = document.getElementById("popup-close");
let ignoreNextPopupClick = false;

const collectionNotice = document.getElementById("collection-notice");
const resetButton = document.getElementById("reset-button");

const collectionImageOverlay =
  document.getElementById("collection-image-overlay");

const collectionLargeImage =
  document.getElementById("collection-large-image");

const collectionImageClose =
  document.getElementElementById?.("collection-image-close") ||
  document.getElementById("collection-image-close");
// ------------------------------------------------------------
// 周回数
// ------------------------------------------------------------

let lifeCount = Number(localStorage.getItem("kiyoneko-life-count")) || 1;

function updateLifeCount() {
  const lifeElement = document.getElementById("life-count");
  if (!lifeElement) return;

  lifeElement.textContent = `人生${lifeCount}周目`;

}
updateLifeCount();

// ------------------------------------------------------------
// ゲーム状態
// ------------------------------------------------------------

let gameStarted = false;
let stage = 1;
let money = 0;
let goal = 10000;

let speedLevel = 0;
let speed = 5;

let multiplierLevel = 0;
let multiplier = 1;

let cats = [];
let pins = [];
let holes = [];

let lastDropTime = 0;
let lastHoleChange = 0;
let lastPinChange = 0;

let animationId = null;
let previousPattern = -1;

let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

let championMode = false;
let stageCleared = false;
let collection = [];
let newCollection = [];
let drawPending = false;
let paused = false;
let completionShown = false;

let bgmVolume = 0.5;
let seVolume = 0.5;
let bgmOn = true;
let seOn = true;

// ------------------------------------------------------------
// 定数
// ------------------------------------------------------------

const MAX_SPEED_LEVEL = 12;
const MIN_DROP_INTERVAL = 1.5;

const PIN_RADIUS = 22.5;
const HOLE_HEIGHT = 42;
const CAT_RADIUS = 30;
const CAT_COLLISION_RADIUS = CAT_RADIUS * 0.8;
const CAT_LOWER_COLLISION_SCALE = 0.7;

const PIN_WALL_MARGIN =
  CAT_RADIUS + PIN_RADIUS + CAT_RADIUS + 8;

const PIN_CHANGE_INTERVAL = 30000;
const HOLE_CHANGE_INTERVAL = 60000;

// ------------------------------------------------------------
// ピン効果音
// ------------------------------------------------------------

const pinSoundPool = Array.from({ length: 5 }, () => {
  const audio = new Audio("audio/ピン.mp3");
  audio.preload = "auto";
  return audio;
});

let pinSoundIndex = 0;

function playPinSound() {
  if (!seOn || seVolume <= 0) return;

  const audio = pinSoundPool[pinSoundIndex];
  pinSoundIndex = (pinSoundIndex + 1) % pinSoundPool.length;

  audio.pause();
  audio.currentTime = 0;
  audio.volume = seVolume;
  audio.play().catch(() => {});
}

// ------------------------------------------------------------
// 猫画像
// ------------------------------------------------------------

const catImage = new Image();
catImage.src = "images/らっか.png";

const catEmoji = "🐈‍⬛";

// ------------------------------------------------------------
// BGM
// ------------------------------------------------------------

const bgmFiles = {
  normal: "audio/全身デイズ.wav",
  champion: "audio/全身キセキ.wav"
};

let currentBgmMode = null;
let bgmAudio = null;

function updateBGM() {
  if (!bgmOn) {
    if (bgmAudio) bgmAudio.pause();
    return;
  }

  const targetMode = championMode ? "champion" : "normal";
  const targetFile = bgmFiles[targetMode];

  if (currentBgmMode !== targetMode || !bgmAudio) {
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
    }

    bgmAudio = new Audio(targetFile);
    bgmAudio.loop = true;
    bgmAudio.volume = bgmVolume;
    currentBgmMode = targetMode;

    if (targetMode === "champion") {
      const targetAudio = bgmAudio;

      targetAudio.addEventListener("loadedmetadata", () => {
        if (
          currentBgmMode === "champion" &&
          bgmAudio === targetAudio
        ) {
          targetAudio.currentTime = 84.7;
        }
      }, { once: true });

      if (targetAudio.readyState >= 1) {
        targetAudio.currentTime = 84.7;
      }
    }

    const targetAudio = bgmAudio;

    targetAudio.addEventListener("error", () => {
      console.error("[BGM読み込み失敗]", targetFile, targetAudio.error);
    });
  }

  bgmAudio.volume = bgmVolume;

  bgmAudio.play().catch(error => {
    console.error("[BGM再生失敗]", targetFile, error);
  });
}

function updateBGMVolume() {
  if (bgmAudio) {
    bgmAudio.volume = bgmOn ? bgmVolume : 0;
  }
}

// ------------------------------------------------------------
// 絶対王者モードの穴演出
// ------------------------------------------------------------

let sparkleParticles = [];

function createSparkles() {
  sparkleParticles = [];

  holes.forEach((hole, holeIndex) => {
    for (let i = 0; i < 8; i++) {
      sparkleParticles.push({
        holeIndex,
        x: Math.random(),
        y: Math.random(),
        size: randInt(2, 5),
        phase: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.04
      });
    }
  });
}

function drawChampionSparkles(now) {
  if (!championMode) return;

  ctx.save();

  sparkleParticles.forEach(p => {
    const hole = holes[p.holeIndex];
    if (!hole) return;

    const wave = Math.sin(now / 350 + p.phase);
    const alpha = 0.35 + (wave + 1) * 0.3;

    const x = hole.x + hole.width * p.x;
    const y = hole.y + hole.height * p.y;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff5bd";

    // shadowBlurは負荷が大きいため控えめにする
    ctx.shadowColor = "#fff1a0";
    ctx.shadowBlur = 5;

    ctx.beginPath();
    ctx.arc(
      x,
      y,
      p.size * (0.7 + (wave + 1) * 0.25),
      0,
      Math.PI * 2
    );
    ctx.fill();
  });

  ctx.restore();
}

// ------------------------------------------------------------
// 盤面に降るキラキラ
// ------------------------------------------------------------

let boardSparkles = [];

function createBoardSparkles() {
  boardSparkles = [];

  const w = boardW();
  const h = boardH();

  for (let i = 0; i < 45; i++) {
    boardSparkles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 1.5 + Math.random() * 3,
      speed: 0.5 + Math.random() * 1.3,
      drift: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2
    });
  }
}

function updateBoardSparkles(dt) {
  if (!championMode) {
    if (boardSparkles.length) boardSparkles = [];
    return;
  }

  const w = boardW();
  const h = boardH();
  const scale = Math.min(dt / 16.67, 2);

  // パーティクル数の上限を設けて負荷を抑える
  if (
    boardSparkles.length < 60 &&
    Math.random() < 0.06 * scale
  ) {
    boardSparkles.push({
      x: Math.random() * w,
      y: -5,
      size: 1.5 + Math.random() * 3,
      speed: 0.5 + Math.random() * 1.3,
      drift: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2
    });
  }

  for (let i = boardSparkles.length - 1; i >= 0; i--) {
    const p = boardSparkles[i];

    p.y += p.speed * scale;
    p.x += p.drift * scale;

    if (p.y >= h + 10) {
      boardSparkles.splice(i, 1);
    }
  }
}

function drawBoardSparkles(now) {
  if (!championMode || !boardSparkles.length) return;

  ctx.save();

  boardSparkles.forEach(p => {
    const wave = Math.sin(now / 250 + p.phase);
    const alpha = 0.35 + (wave + 1) * 0.3;
    const size = p.size * (0.7 + (wave + 1) * 0.3);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff5bd";

    // ぼかしを減らして描画負荷軽減
    ctx.shadowColor = "#ffd84a";
    ctx.shadowBlur = 4;

    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(p.x - size * 1.8, p.y);
    ctx.lineTo(p.x + size * 1.8, p.y);
    ctx.moveTo(p.x, p.y - size * 1.8);
    ctx.lineTo(p.x, p.y + size * 1.8);
    ctx.stroke();
  });

  ctx.restore();
}
// ------------------------------------------------------------
// 非表示中の収入計測
// ------------------------------------------------------------

const idleIncomeSamples = [];
const IDLE_INCOME_WINDOW = 60000; // 直近60秒
let hiddenAt = null;
let hiddenIncomeRate = 0;
let incomeTrackingStartedAt = Date.now();

// 通常プレイ中に獲得したお金を記録
function recordIdleIncome(amount) {
  // 非表示中の補填金を計測に含めない
  if (document.visibilityState !== "visible") return;
  if (!gameStarted || paused) return;

  const now = Date.now();

  idleIncomeSamples.push({
    time: now,
    amount
  });

  // 60秒より古いデータを削除
  while (
    idleIncomeSamples.length > 0 &&
    now - idleIncomeSamples[0].time > IDLE_INCOME_WINDOW
  ) {
    idleIncomeSamples.shift();
  }
}

// 直近の収入から1秒あたりの平均収入を算出
function calculateIdleIncomeRate() {
  const now = Date.now();

  // 古い収入データを削除
  while (
    idleIncomeSamples.length > 0 &&
    now - idleIncomeSamples[0].time > IDLE_INCOME_WINDOW
  ) {
    idleIncomeSamples.shift();
  }

  const totalIncome = idleIncomeSamples.reduce(
    (sum, sample) => sum + sample.amount,
    0
  );

  const elapsed = Math.min(
    IDLE_INCOME_WINDOW,
    Math.max(1000, now - incomeTrackingStartedAt)
  );

  return totalIncome / (elapsed / 1000);
}
// ------------------------------------------------------------
// ポイント取得履歴
// ------------------------------------------------------------

const pointHistory = [];
const MAX_POINT_HISTORY = 200;

function recordPointGain(type, slotMultiplier, amount, cat) {
  const entry = {
    time: new Date().toLocaleTimeString("ja-JP"),
    stage,
    type,
    multiplier: `×${slotMultiplier}`,
    amount: `+${fmt(amount)}`,
    total: fmt(money),
    catX: Math.round(cat?.x ?? 0),
    catY: Math.round(cat?.y ?? 0)
  };

  pointHistory.push(entry);

  if (pointHistory.length > MAX_POINT_HISTORY) {
    pointHistory.splice(
      0,
      pointHistory.length - MAX_POINT_HISTORY
    );
  }

  console.log(
    `[ポイント獲得] ${entry.time} | STAGE ${entry.stage} | ` +
    `${entry.type} ${entry.multiplier} | ${entry.amount} | ` +
    `合計 ${entry.total}`
  );
}

function printPointHistory() {
  console.group("🐈 キヨ猫あつめ：ポイント取得履歴");

  if (pointHistory.length === 0) {
    console.info("まだポイント取得履歴はありません。");
  } else {
    console.table(pointHistory);
  }

  console.info(
    "ポイント獲得時に新しいログが自動追加されます。"
  );

  console.groupEnd();
}

// ------------------------------------------------------------
// 色
// ------------------------------------------------------------

const pinColors = {
  2: "#ffe17b",
  3: "#ffad52",
  4: "#ff8bbd",
  5: "#e64b54",
  100: "#e6bd45"
};

const holeColors = {
  1: "#56a34d",
  2: "#56a34d",
  3: "#448fce",
  4: "#448fce",
  5: "#448fce",
  6: "#448fce",
  7: "#9b6acb",
  8: "#9b6acb",
  9: "#9b6acb",
  10: "#9b6acb"
};

// ------------------------------------------------------------
// コレクション
// ------------------------------------------------------------

const collectibleFaces = [
  { id: "smile", name: "かれー", image: "かれー.webp" },
  { id: "cry", name: "もえるぞ", image: "ほのお.webp" },
  { id: "angry", name: "コック", image: "コック.webp" },
  { id: "sulk", name: "おおいそがし", image: "店員.webp" },
  { id: "secret", name: "絶対王者", image: "王者.webp" }
];

// ------------------------------------------------------------
// ピン配置パターン
// ------------------------------------------------------------

const pinPatterns = [
  [[.25,.25],[.75,.25],[.5,.43],[.3,.61],[.7,.61]],
  [[.5,.22],[.25,.4],[.75,.4],[.4,.6],[.6,.6]],
  [[.3,.25],[.7,.25],[.5,.4],[.25,.58],[.75,.58]],
  [[.2,.32],[.5,.25],[.8,.32],[.35,.53],[.65,.53]],
  [[.35,.22],[.65,.22],[.25,.44],[.75,.44],[.5,.62]]
];

// ------------------------------------------------------------
// 基本関数
// ------------------------------------------------------------

function randInt(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function fmt(n) {
  return Math.floor(n).toLocaleString("ja-JP");
}

function boardW() {
  return canvas.clientWidth;
}

function boardH() {
  return canvas.clientHeight;
}

function randomHoleMultiplier() {
  return randInt(1, 10);
}

function safePinX(rx, w) {
  const margin = Math.min(PIN_WALL_MARGIN, w / 2);

  const originalX = w * rx;
  const minX = margin;
  const maxX = w - margin;

  if (minX >= maxX) return w / 2;

  return Math.max(minX, Math.min(maxX, originalX));
}

// ------------------------------------------------------------
// 通常モードのピン倍率設定
// 同じ倍率は最大2個まで
// ------------------------------------------------------------

function assignNormalPinMultipliers() {
  const multCounts = {};

  pins.forEach(pin => {
    let m;

    do {
      m = randInt(2, 5);
    } while ((multCounts[m] || 0) >= 2);

    multCounts[m] = (multCounts[m] || 0) + 1;
    pin.multiplier = m;
  });
}

// ------------------------------------------------------------
// 目標・ポイント表示
// ------------------------------------------------------------

function updateGoal() {
  goal = stage <= 5
    ? 10000 * Math.pow(10, stage - 1)
    : Infinity;

  goalValue.textContent = stage <= 5 ? fmt(goal) : "∞";
  resetButton.classList.toggle("hidden", stage < 6);
}
function updateMoney() {
  moneyValue.textContent = `${fmt(money)} えん`;

  const speedButton = document.getElementById("speed-up");
  const multButton = document.getElementById("mult-up");

  if (speedButton) {
    const maxed = speedLevel >= MAX_SPEED_LEVEL;
    const canAfford = money >= speedCost();

    speedButton.disabled = maxed || !canAfford;
    speedButton.classList.toggle(
      "cannot-afford",
      maxed || !canAfford
    );
    speedButton.textContent = maxed
      ? "レベルマックス"
      : "強化する";
  }

  if (multButton) {
    const canAfford = money >= multiplierCost();

    multButton.disabled = !canAfford;
    multButton.classList.toggle(
      "cannot-afford",
      !canAfford
    );
  }

  // 強化メニューを開いている場合、表示中の数値を即時更新する。
  refreshUpgradeMenuDisplay();

  if (stage <= 5 && money >= goal) {
    showClearButton();
  } else {
    removeClearButton();
  }
}

// ------------------------------------------------------------
// 強化メニューの数値表示更新
// ------------------------------------------------------------

function animateUpgradeValue(id, value) {
  const element = document.getElementById(id);
  if (!element) return;

  const newValue = String(value);

  // 数値が変わったときだけ演出する。
  if (element.textContent === newValue) return;

  element.textContent = newValue;

  element.classList.remove("upgrade-value-changed");

  // アニメーションを確実に再スタートさせる。
  void element.offsetWidth;

  element.classList.add("upgrade-value-changed");
}

function refreshUpgradeMenuDisplay() {
  const speedMaxed = speedLevel >= MAX_SPEED_LEVEL;

  animateUpgradeValue(
    "speed-current-value",
    `${speed.toFixed(1)}秒`
  );

  animateUpgradeValue(
    "speed-level-value",
    `Lv.${speedLevel}/${MAX_SPEED_LEVEL}`
  );

  animateUpgradeValue(
    "speed-cost-value",
    speedMaxed
      ? "---"
      : `${speedCost().toLocaleString()}円`
  );

  animateUpgradeValue(
    "mult-current-value",
    `${multiplier}円`
  );

  animateUpgradeValue(
    "mult-level-value",
    `Lv.${multiplierLevel + 1}`
  );

  animateUpgradeValue(
    "mult-cost-value",
    `${multiplierCost().toLocaleString()}円`
  );
}


// ------------------------------------------------------------
// キャンバス調整
// ------------------------------------------------------------

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  lastCanvasWidth = rect.width;
  lastCanvasHeight = rect.height;

  if (holes.length === 3) {
    const w = rect.width;
    const h = rect.height;
    const holeW = w / 3;

    holes.forEach((hole, i) => {
      hole.x = i * holeW;
      hole.width = holeW;
      hole.y = h - HOLE_HEIGHT;
      hole.height = HOLE_HEIGHT;
    });
  }

  pins.forEach(pin => {
    pin.x = safePinX(pin.rx, rect.width);
    pin.y = pin.ry * rect.height;
  });

  if (gameStarted) drawBoard();
}

window.addEventListener("resize", resizeCanvas);

// ------------------------------------------------------------
// ゲームループ管理
// ------------------------------------------------------------

function startGameTicker() {
  if (!gameStarted || paused || animationId !== null) return;

  gameLoop.lastTime = performance.now();
  animationId = requestAnimationFrame(gameLoop);
}

function stopGameTicker() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}
// ------------------------------------------------------------
// ブラウザ非表示中の収入補填
// ------------------------------------------------------------

document.addEventListener("visibilitychange", () => {
  // ブラウザを離れたとき
  if (document.visibilityState === "hidden") {
    if (!gameStarted || paused) {
      hiddenAt = null;
      hiddenIncomeRate = 0;
      return;
    }

    hiddenAt = Date.now();
    hiddenIncomeRate = calculateIdleIncomeRate();
    return;
  }

  // ブラウザに戻ったとき
  if (document.visibilityState === "visible") {
    if (hiddenAt === null) return;

    const elapsed = Math.max(0, Date.now() - hiddenAt);

    if (gameStarted && !paused && hiddenIncomeRate > 0) {
      const earned = Math.floor(
        hiddenIncomeRate * (elapsed / 1000)
      );

      if (earned > 0) {
        money += earned;

        console.log(
          `[非表示収入] ${Math.floor(elapsed / 1000)}秒間 ` +
          `${fmt(earned)}円獲得`
        );

        updateMoney();
      }
    }

    hiddenAt = null;
    hiddenIncomeRate = 0;
  }
});

// ------------------------------------------------------------
// ゲーム開始
// ------------------------------------------------------------

startButton.addEventListener("click", () => {
  if (startButton.disabled) return;
  startButton.disabled = true;

  const titleCatFace = document.querySelector(".title-cat-face");
  const playSound = new Audio("audio/burekiyo.mp3");
  let started = false;

  const beginGame = () => {
    if (started) return;
    started = true;

    titleCatFace?.classList.remove("spinning");
    titleScreen.classList.remove("active");
    gameScreen.classList.add("active");

    gameStarted = true;
    paused = false;
// 非表示収入の計測を初期化
idleIncomeSamples.length = 0;
incomeTrackingStartedAt = Date.now();
hiddenAt = null;
hiddenIncomeRate = 0;

    resizeCanvas();
    createBoard();

    lastDropTime = performance.now();
    lastHoleChange = Date.now();
    lastPinChange = Date.now();

    startGameTicker();
    updateBGM();
  };

  titleCatFace?.classList.add("spinning");
  playSound.currentTime = 0;
  playSound.addEventListener("ended", beginGame, { once: true });
  playSound.play().catch(() => beginGame());
});

// ------------------------------------------------------------
// ピン位置の生成
// ------------------------------------------------------------

function generatePinPositions(count) {
  const w = boardW();
  const h = boardH();

  let p;

  do {
    p = randInt(0, pinPatterns.length - 1);
  } while (p === previousPattern && pinPatterns.length > 1);

  previousPattern = p;

  const layout = pinPatterns[p];

  const candidates = layout.map(pos => {
    const rx = pos[0];

    return {
      x: safePinX(rx, w),
      y: h * (1 / 3 + pos[1] * (2 / 3)),
      rx,
      ry: (1 / 3 + pos[1] * (2 / 3))
    };
  });

  // 候補をシャッフル
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [candidates[i], candidates[j]] =
      [candidates[j], candidates[i]];
  }

  const selected = [];
  const minPinCenterDistance =
    PIN_RADIUS * 2 + CAT_RADIUS * 2 + 8;

  for (const candidate of candidates) {
    if (
      selected.every(pin =>
        Math.hypot(
          candidate.x - pin.x,
          candidate.y - pin.y
        ) >= minPinCenterDistance
      )
    ) {
      selected.push(candidate);

      if (selected.length >= count) break;
    }
  }

  // 間隔条件を満たせない場合も、既存ピンが古い位置に残らないよう
  // 未選択候補を追加して要求数を必ず確保する。
  if (selected.length < count) {
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= count) break;
    }
  }

  return selected;
}

// ------------------------------------------------------------
// 盤面作成
// ------------------------------------------------------------

function createBoard() {
  const w = boardW();
  const h = boardH();

  if (!w || !h) return;

  holes = [];
  const holeW = w / 3;

  for (let i = 0; i < 3; i++) {
    holes.push({
      x: i * holeW,
      width: holeW,
      y: h - HOLE_HEIGHT,
      height: HOLE_HEIGHT,
      multiplier: championMode ? 9999 : randomHoleMultiplier()
    });
  }

  const requestedCount = randInt(3, 5);
  const selected = generatePinPositions(requestedCount);

  pins = selected.map(pos => ({
    x: pos.x,
    y: pos.y,
    rx: pos.rx,
    ry: pos.ry,
    radius: PIN_RADIUS,
    multiplier: championMode ? 100 : 1
  }));

  if (!championMode) {
    assignNormalPinMultipliers();
  }

  createSparkles();

  if (championMode) {
    createBoardSparkles();
  } else {
    boardSparkles = [];
  }

  lastPinChange = Date.now();
  lastHoleChange = Date.now();

  drawBoard();
}

// ------------------------------------------------------------
// 30秒ごとにピン位置を変更
// 倍率は維持する
// ------------------------------------------------------------

function changePinPositions() {
  if (!pins.length) return;

  const count = pins.length;
  const newPositions = generatePinPositions(count);

  // 既存の倍率を保持して位置だけ変更
  newPositions.forEach((pos, i) => {
    if (!pins[i]) return;

    pins[i].x = pos.x;
    pins[i].y = pos.y;
    pins[i].rx = pos.rx;
    pins[i].ry = pos.ry;

    // ピン接触状態をリセットし、移動直後の衝突を正常化
  });

  cats.forEach(cat => {
    const touching = new Set();

    pins.forEach((pin, index) => {
      const dx = cat.x - pin.x;
      const dy = cat.y - pin.y;
      const lowerRatio = Math.max(0, Math.min(1, dy / cat.radius));
      const collisionRadius =
        cat.radius *
        (1 - (1 - CAT_LOWER_COLLISION_SCALE) * lowerRatio);

      if (Math.hypot(dx, dy) < collisionRadius + pin.radius) {
        touching.add(index);
      }
    });

    cat.pinTouching = touching;
  });

  lastPinChange = Date.now();
  drawBoard();
}

// ------------------------------------------------------------
// 猫の排出
// 横幅中央1/3の中でランダムに排出
// ------------------------------------------------------------

function dropCat() {
  const w = boardW();
  const third = w / 3;

  const centerLeft = third;
  const centerRight = third * 2;

  const margin = CAT_RADIUS + 2;
  const minX = centerLeft + margin;
  const maxX = centerRight - margin;

  const spawnX =
    minX + Math.random() * Math.max(1, maxX - minX);

  cats.push({
    x: spawnX,
    y: CAT_RADIUS + 2,
    radius: CAT_RADIUS,
    vx: (Math.random() - 0.5) * 0.35,
    vy: 0,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.012,
    pinTouching: new Set()
  });
}

// ------------------------------------------------------------
// ピン衝突
// ------------------------------------------------------------
function checkPinCollision(cat, pin, index, frameContacts) {
  const dx = cat.x - pin.x;
  const dy = cat.y - pin.y;
  const distanceSquared = dx * dx + dy * dy;

  const lowerRatio = Math.max(
    0,
    Math.min(1, dy / cat.radius)
  );

  const collisionRadius =
    cat.radius *
    (1 - (1 - CAT_LOWER_COLLISION_SCALE) * lowerRatio);

  const minDist = collisionRadius + pin.radius;

  // 衝突していない大半の判定では平方根を計算しない。
  if (distanceSquared >= minDist * minDist) return;

  const dist = Math.sqrt(distanceSquared);

  if (
    !cat.pinTouching?.has(index) &&
    !frameContacts.has(index)
  ) {
    playPinSound();

    const gained = multiplier * pin.multiplier;
    money += gained;
     recordIdleIncome(gained)
    recordPointGain("倍率ピン", pin.multiplier, gained, cat);

    if (stage <= 5 && money >= goal && !stageCleared) {
      stageCleared = true;
      showClearButton();
    }
  }

  frameContacts.add(index);

  const nx = dx / (dist || 1);
  const ny = dy / (dist || 1);
  const overlap = minDist - dist;

  cat.x += nx * (overlap + 0.8);
  cat.y += ny * (overlap + 0.8);

  const dot = cat.vx * nx + cat.vy * ny;

  if (dot < 0) {
    const restitution = 3.25;

    cat.vx -= restitution * dot * nx;
    cat.vy -= restitution * dot * ny;
    cat.vy -= 1.9;
    cat.vx += (Math.random() - 0.5) * 0.7;
  }

  cat.spin += (Math.random() - 0.5) * 0.1;
}
// ------------------------------------------------------------
// ポイント加算：倍率穴
// ------------------------------------------------------------

function awardHole(cat, hole) {
  if (!hole) return;

  const gained = multiplier * hole.multiplier;
  money += gained;
recordIdleIncome(gained);
  recordPointGain("倍率穴", hole.multiplier, gained, cat);

  if (stage <= 5 && money >= goal && !stageCleared) {
    stageCleared = true;
    showClearButton();
  }
}

// ------------------------------------------------------------
// 猫の物理演算
// ------------------------------------------------------------
// 衝突判定の細かすぎる分割を抑え、負荷を軽減
// ------------------------------------------------------------

function updateCats(dt) {
  const w = boardW();
  const h = boardH();
  const moneyBeforeUpdate = money;

  const scale = Math.min(dt / 16.67, 2);
  const gravity = 0.075;
  const terminal = 2.25;

  for (let c = cats.length - 1; c >= 0; c--) {
    const cat = cats[c];

    cat.vy = Math.min(terminal, cat.vy + gravity * scale);

    cat.vx +=
      Math.sin(performance.now() / 950 + cat.rotation) *
      0.008 * scale;

    cat.vx = Math.max(-1.15, Math.min(1.15, cat.vx));
    cat.rotation += cat.spin * scale;

    const frameContacts = new Set();

    const travel = Math.max(
      Math.abs(cat.vx * scale),
      Math.abs(cat.vy * scale)
    );

    // 旧式の細かい分割を軽減
    // 最大3分割までに制限
    const steps = Math.min(
      3,
      Math.max(
        1,
        Math.ceil(travel / Math.max(8, cat.radius * 0.5))
      )
    );

    const stepScale = scale / steps;

    for (let step = 0; step < steps; step++) {
      cat.x += cat.vx * stepScale;
      cat.y += cat.vy * stepScale;

      // 左右の壁
      if (cat.x - cat.radius < 0) {
        cat.x = cat.radius;
        cat.vx = Math.abs(cat.vx) * 0.75;
      }

      if (cat.x + cat.radius > w) {
        cat.x = w - cat.radius;
        cat.vx = -Math.abs(cat.vx) * 0.75;
      }

      // 上壁
      if (cat.y - cat.radius < 0) {
        cat.y = cat.radius;
        cat.vy = Math.abs(cat.vy) * 0.75;
      }

      // ピンとの衝突
      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i];

        // 距離が遠いピンは衝突計算を行わない
        const broadDistance =
          cat.radius + pin.radius + 8;

        const dx = cat.x - pin.x;
        const dy = cat.y - pin.y;

        if (
          Math.abs(dx) > broadDistance ||
          Math.abs(dy) > broadDistance
        ) {
          continue;
        }

        checkPinCollision(cat, pin, i, frameContacts);
      }
    }

    cat.pinTouching = frameContacts;


    // 穴に入った猫を処理
    // 判定位置を穴の上端から12px下げる
    const holeJudgeOffset = 12;
    const holeTop = h - HOLE_HEIGHT + holeJudgeOffset;

    if (cat.y + cat.radius >= holeTop) {
      const x = Math.max(0, Math.min(w - 0.01, cat.x));

      const hole =
        holes.find(q => x >= q.x && x < q.x + q.width) ||
        holes[2];

      awardHole(cat, hole);
      cats.splice(c, 1);
    }
    }


  // 複数の猫が同時に得点しても、DOM更新は1フレームにつき1回にまとめる。
  if (money !== moneyBeforeUpdate) {
    updateMoney();
  }
}

// ------------------------------------------------------------
// 立体ピン描画
// ピン画像は倍率・サイズごとに一度だけ生成して再利用する
// ------------------------------------------------------------

const pinSpriteCache = new Map();

function createPinSprite(multiplier, radius) {
  const key = `${multiplier}:${radius}`;
  const cached = pinSpriteCache.get(key);
  if (cached) return cached;

  const padding = 5;
  const size = Math.ceil(radius * 2 + padding * 2);
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const spriteCtx = sprite.getContext("2d");
  const x = size / 2;
  const y = size / 2;
  const color = pinColors[multiplier] || "#e6bd45";

  // 外側の影
  spriteCtx.beginPath();
  spriteCtx.arc(x + 1.5, y + 2.5, radius, 0, Math.PI * 2);
  spriteCtx.fillStyle = "rgba(70, 45, 20, 0.22)";
  spriteCtx.fill();

  // 本体グラデーション
  const gradient = spriteCtx.createRadialGradient(
    x - radius * 0.4,
    y - radius * 0.45,
    radius * 0.08,
    x,
    y,
    radius
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(0.68, color);
  gradient.addColorStop(1, "#8a5d35");

  spriteCtx.beginPath();
  spriteCtx.arc(x, y, radius, 0, Math.PI * 2);
  spriteCtx.fillStyle = gradient;
  spriteCtx.fill();

  // 外枠
  spriteCtx.strokeStyle = "#6a4b27";
  spriteCtx.lineWidth = 1.8;
  spriteCtx.stroke();

  // 上側の光沢
  spriteCtx.beginPath();
  spriteCtx.ellipse(
    x - radius * 0.15,
    y - radius * 0.38,
    radius * 0.62,
    radius * 0.28,
    -0.2,
    Math.PI,
    Math.PI * 2
  );
  spriteCtx.fillStyle = "rgba(255,255,255,0.35)";
  spriteCtx.fill();

  // 立体リング
  spriteCtx.beginPath();
  spriteCtx.arc(x, y, radius * 0.84, 0, Math.PI * 2);
  spriteCtx.strokeStyle = "rgba(255,255,255,0.2)";
  spriteCtx.lineWidth = 1;
  spriteCtx.stroke();

  // 倍率文字
  spriteCtx.fillStyle = "#000";
  spriteCtx.font = `bold ${Math.max(9, radius * 0.82)}px "Hachi Maru Pop", sans-serif`;
  spriteCtx.textAlign = "center";
  spriteCtx.textBaseline = "middle";
  spriteCtx.fillText("×" + multiplier, x, y + 0.5);

  pinSpriteCache.set(key, sprite);
  return sprite;
}

function drawPin(pin) {
  const sprite = createPinSprite(pin.multiplier, pin.radius);
  ctx.drawImage(
    sprite,
    pin.x - sprite.width / 2,
    pin.y - sprite.height / 2
  );
}

// ------------------------------------------------------------
// 描画
// ------------------------------------------------------------

// 指定した色を少し暗くする
function darkenHexColor(hex, amount = 0.12) {
  const normalized = hex.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hex;
  }

  const value = parseInt(normalized, 16);

  const r = Math.round(((value >> 16) & 255) * (1 - amount));
  const g = Math.round(((value >> 8) & 255) * (1 - amount));
  const b = Math.round((value & 255) * (1 - amount));

  return `#${[r, g, b]
    .map(v => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function drawBoard() {
  const w = boardW();
  const h = boardH();

  if (!w || !h) return;

  // CSS境界・高DPI端数を含め、Canvasの裏面全体を毎フレーム消去する。
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.fillStyle = getComputedStyle(canvas).backgroundColor;
  ctx.fillRect(0, 0, w, h);

  // ピン
  pins.forEach(drawPin);

  // 底部の倍率穴
  holes.forEach(hole => {
    if (championMode) {
      const goldGradient = ctx.createLinearGradient(
        hole.x,
        hole.y,
        hole.x,
        hole.y + hole.height
      );

      goldGradient.addColorStop(0, "#fff2a6");
      goldGradient.addColorStop(0.35, "#e6bd45");
      goldGradient.addColorStop(0.7, "#b78016");
      goldGradient.addColorStop(1, "#704500");

      ctx.fillStyle = goldGradient;
    } else {
      const baseColor =
        holeColors[hole.multiplier] || "#8c65b8";

      const holeGradient = ctx.createLinearGradient(
        hole.x,
        hole.y,
        hole.x,
        hole.y + hole.height
      );

      holeGradient.addColorStop(0, baseColor);
      holeGradient.addColorStop(
        1,
        darkenHexColor(baseColor, 0.70)
      );

      ctx.fillStyle = holeGradient;
    }

    ctx.fillRect(
      hole.x,
      hole.y,
      hole.width,
      hole.height
    );

    ctx.strokeStyle = championMode
      ? "#fff0a0"
      : "#5c472c";

    ctx.lineWidth = championMode ? 2.5 : 1.5;

    ctx.strokeRect(
      hole.x,
      hole.y,
      hole.width,
      hole.height
    );

    if (championMode) {
      ctx.save();

      ctx.shadowColor = "#ffd84a";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "#ffe99a";
      ctx.lineWidth = 1.5;

      ctx.strokeRect(
        hole.x + 2,
        hole.y + 2,
        hole.width - 4,
        hole.height - 4
      );

      ctx.restore();
    }

    ctx.fillStyle = championMode ? "#4b3000" : "#fff";
    ctx.font = 'bold 19px "Hachi Maru Pop", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(
      "×" + hole.multiplier,
      hole.x + hole.width / 2,
      hole.y + hole.height / 2
    );
  });

  if (championMode) {
    drawChampionSparkles(performance.now());
    drawBoardSparkles(performance.now());
  }

  // 猫の描画
  // Canvas外への描画をクリップして端の残像を防止
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  cats.forEach(cat => {
    ctx.save();

    ctx.translate(cat.x, cat.y);
    ctx.rotate(cat.rotation);

    if (catImage.complete && catImage.naturalWidth > 0) {
      const drawSize = cat.radius * 2 * 4;
      const cropBottom = 2;

      ctx.imageSmoothingEnabled = true;

      ctx.drawImage(
        catImage,
        0,
        0,
        catImage.naturalWidth,
        catImage.naturalHeight - cropBottom,
        -drawSize / 2,
        -drawSize / 2,
        drawSize,
        drawSize
      );
    } else {
      ctx.font = `${cat.radius * 4.8}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(catEmoji, 0, 0);
    }

    ctx.restore();
  });

  ctx.restore();
}

// ------------------------------------------------------------
// 倍率穴の変更
// ------------------------------------------------------------

function changeHoleMultipliers() {
  // 絶対王者モードでは倍率を固定し、通常モードだけ抽選し直す。
  if (championMode) {
    holes.forEach(hole => {
      hole.multiplier = 9999;
    });
    lastHoleChange = Date.now();
    drawBoard();
    return;
  }

  holes.forEach(hole => {
    hole.multiplier = randomHoleMultiplier();
  });

  lastHoleChange = Date.now();
  drawBoard();
}

// ------------------------------------------------------------
// ゲーム進行
// ------------------------------------------------------------

function gameLoop(now) {
  animationId = null;

  if (!gameStarted || paused) return;

  // 背景に戻った際の巨大dtによる処理暴走を防ぐ
  const rawDt = Math.max(0, now - (gameLoop.lastTime || now));
  const dt = Math.min(rawDt, 50);

  gameLoop.lastTime = now;

  if (now - lastDropTime >= speed * 1000) {
    dropCat();
    lastDropTime = now;
  }

  // 穴倍率は60秒ごと
  if (
    !championMode &&
    Date.now() - lastHoleChange >= HOLE_CHANGE_INTERVAL
  ) {
    changeHoleMultipliers();
  }

  // ピン配置は30秒ごと
  if (Date.now() - lastPinChange >= PIN_CHANGE_INTERVAL) {
    changePinPositions();
  }

  updateCats(dt);
  updateBoardSparkles(dt);
  drawBoard();

  if (gameStarted && !paused) {
    animationId = requestAnimationFrame(gameLoop);
  }
}

// ------------------------------------------------------------
// 目標達成ボタン
// ------------------------------------------------------------

function showClearButton() {
  if (document.getElementById("stage-clear-button")) return;

  const button = document.createElement("button");
  button.id = "stage-clear-button";
  button.className = "stage-clear";
  button.innerHTML = "もくひょうたっせい！";

  const goalBox = goalValue.closest(".goal-box");

  const positionClearButton = () => {
    if (!goalBox) return;
    button.style.inset = "0";
    button.style.width = "100%";
    button.style.height = "100%";
    button.style.fontSize = "clamp(12px, 3.5vw, 16px)";
  };

  button.onclick = () => {
    removeClearButton();
    openLotteryBefore();
  };

  (goalBox || document.body).appendChild(button);

  positionClearButton();

  button._positionClearButton = positionClearButton;
  window.addEventListener("resize", positionClearButton);
}

function removeClearButton() {
  const button = document.getElementById("stage-clear-button");

  if (!button) return;

  if (button._positionClearButton) {
    window.removeEventListener(
      "resize",
      button._positionClearButton
    );
  }

  button.remove();
}

// ------------------------------------------------------------
// くじ引き
// ------------------------------------------------------------

function openLotteryBefore() {
  openPopup(
    "ステージクリア！",
    `
      <div class="popup-item popup-text lottery-card">
        <div class="lottery-art">
          <img src="images/box.png" alt="豪華なくじ箱">
        </div>

        <div class="lottery-message">
          <span>♛ SPECIAL LOTTERY ♛</span>
          <p>なにが出るかな？</p>
        </div>

        <button id="lottery-draw" class="lottery-button">
          ✨ くじを引く！ ✨
        </button>
      </div>
    `
  );

  document.getElementById("lottery-draw").onclick = drawCollection;
}

// ------------------------------------------------------------
// コレクション抽選・獲得演出
// ------------------------------------------------------------


function drawCollection() {
  if (drawPending) return;

  // クリア目標分のポイントが足りない場合は抽選しない
  if (Number.isFinite(goal) && money < goal) {
    return;
  }

  drawPending = true;

  // クリア目標分のポイントを消費
  if (Number.isFinite(goal)) {
    money -= goal;
    updateMoney();
  }

  const normalFaces = collectibleFaces.filter(
    c => c.id !== "secret"
  );

  const available = normalFaces.filter(
    c => !collection.includes(c.id)
  );

  let prize;

  if (
    available.length === 0 &&
    !collection.includes("secret")
  ) {
    prize = collectibleFaces.find(c => c.id === "secret");
  } else if (available.length > 0) {
    prize = available[randInt(0, available.length - 1)];
  } else {
    drawPending = false;
    finishStage();
    return;
  }
  const drawButton = document.getElementById("lottery-draw");
  if (drawButton) drawButton.disabled = true;

  const lotteryCard = drawButton?.closest(".lottery-card");
  lotteryCard?.classList.add("lottery-shaking");

  // ドラムロール再生
  const drumRoll = new Audio("audio/drum.mp3");
  drumRoll.volume = 1.0;
  drumRoll.play().catch(() => {});

  setTimeout(() => {
    collection.push(prize.id);
    newCollection.push(prize.id);

    collectionNotice.classList.remove("hidden");

    openPopup(
      prize.id === "secret"
        ? "👑 SECRET！獲得！ 👑"
        : "🎉 NEW！獲得！ 🎉",
      `
        <div class="popup-item popup-text reward-card">
          <div class="reward-art">
            <img src="images/get.jpg" alt="豪華獲得演出">

            <div class="reward-face">
              <img src="images/${prize.image}" alt="${prize.name}">
            </div>
          </div>

          <div class="reward-title">
            <div class="reward-new">
              ${prize.id === "secret" ? "♛ SECRET！ ♛" : "★ NEW！ ★"}
            </div>
            <h3>${prize.name}</h3>
            <p>${prize.id === "secret"
              ? "全ての景品を集めた証！絶対王者を獲得！"
              : "コレクションに追加されたよ！"}
            </p>
            <div class="reward-stars">✦ ✧ ★ ✧ ✦</div>
          </div>

          <button id="reveal-continue" class="reward-button">
            つぎへ ▶
          </button>
        </div>
      `
    );

    document.getElementById("reveal-continue").onclick = () => {
      drawPending = false;
      closePopup();
      finishStage();
    };
  }, 1750);
}

// ------------------------------------------------------------
// ステージ終了・次のステージ
// ------------------------------------------------------------

function finishStage() {
  removeClearButton();

  stageCleared = false;
  paused = false;
  drawPending = false;

  if (collection.length >= 5 && !completionShown) {
    completionShown = true;
    stage = 6;

    updateGoal();

    openPopup(
      "絶対王者！",
      `
        <div class="popup-item popup-text">
          <div style="font-size:58px">♛ 🐈‍⬛ ♛</div>
          <h3>コンプリート！！</h3>
          <p>絶対王者の称号を手に入れた！</p>
          <button id="champion-continue">つづける</button>
        </div>
      `
    );

    paused = true;

    document.getElementById("champion-continue").onclick = () => {
      closePopup();
      paused = false;
      updateGoal();
      createBoard();
      resumeLoop();
    };

    return;
  }

  stage++;
  updateGoal();
  createBoard();
  resumeLoop();
}

// ------------------------------------------------------------
// ゲーム再開
// ------------------------------------------------------------

function resumeLoop() {
  paused = false;
  gameLoop.lastTime = performance.now();
  lastDropTime = performance.now();

  if (animationId === null) {
    startGameTicker();
  }
}

// ------------------------------------------------------------
// フリーズ解除
// ------------------------------------------------------------

function recoverGame() {
  console.warn("[キヨ猫あつめ] ゲーム復旧を実行します。");

  stopGameTicker();
  cats = [];

  removeClearButton();

  drawPending = false;
  paused = false;

  const now = performance.now();
  gameLoop.lastTime = now;
  lastDropTime = now;
  lastHoleChange = Date.now();
  lastPinChange = Date.now();

  createBoard();

  if (stageCleared && stage <= 5) {
    showClearButton();
  }

  closePopup();
  startGameTicker();

  console.info(
    "[キヨ猫あつめ] 復旧完了。ポイント・強化・コレクション・ステージは維持されています。"
  );
}

// ------------------------------------------------------------
// ポップアップ
// ------------------------------------------------------------

function openPopup(title, html) {
  popupTitle.textContent = title;
  popupContent.innerHTML = html;
  popupOverlay.classList.remove("hidden");
  document.body.classList.add("popup-open");
}
function closePopup() {
  popupOverlay.classList.add("hidden");
  popupOverlay.classList.remove("rules-overlay");
  document.body.classList.remove("popup-open");
}

popupClose.addEventListener("click", () => {
  const currentTitle = popupTitle.textContent;

  closePopup();

  if (
    paused &&
    currentTitle !== "これくしょん" &&
    currentTitle !== "せってい" &&
    currentTitle !== "つうじょうきょうか"
  ) {
    resumeLoop();
  }
});

popupOverlay.addEventListener("click", e => {

  // ルール画面を開いた直後のクリックだけ無視する。
  if (ignoreNextPopupClick) {
    ignoreNextPopupClick = false;
    return;
  }

  // ルール画面は、どこをタップしても閉じる。
  if (popupOverlay.classList.contains("rules-overlay")) {
    closePopup();
    return;
  }

  // 通常のポップアップは背景部分を押したときだけ閉じる。
  if (e.target === popupOverlay) {
    closePopup();
  }

});
// ------------------------------------------------------------
// メニュー
// ------------------------------------------------------------

document.querySelectorAll(".menu-button").forEach(button => {
  button.addEventListener("click", () => {
    const menu = button.dataset.menu;

    if (!popupOverlay.classList.contains("hidden")) {
      if (
        popupTitle.textContent === "つうじょうきょうか" &&
        menu === "upgrade"
      ) {
        closePopup();
        return;
      }

      if (
        popupTitle.textContent === "これくしょん" &&
        menu === "collection"
      ) {
        closePopup();
        return;
      }

      if (
        popupTitle.textContent === "せってい" &&
        menu === "settings"
      ) {
        closePopup();
        return;
      }
    }

    if (menu === "upgrade") openUpgradeMenu();
    if (menu === "collection") openCollectionMenu();
    if (menu === "settings") openSettingsMenu();
  });
});

// ------------------------------------------------------------
// 強化
// ------------------------------------------------------------

function speedCost() {
  const costs = [
    20,
    100,
    1000,
    10000,
    50000,
    100000,
    250000,
    500000,
    750000,
    1000000,
    3000000,
    5000000
  ];

  return costs[speedLevel] ?? Infinity;
}

function multiplierCost() {
  if (multiplierLevel <= 15) {
    return Math.ceil(5 * Math.pow(1.7, multiplierLevel));
  }

  let cost = Math.ceil(5 * Math.pow(1.7, 15));

  for (let level = 16; level <= multiplierLevel; level++) {
    let growthRate;

    if (level <= 20) growthRate = 1.30;
    else if (level <= 25) growthRate = 1.10;
    else if (level <= 35) growthRate = 1.10;
    else if (level <= 45) growthRate = 1.10;
    else if (level <= 55) growthRate = 1.10;
    else if (level <= 65) growthRate = 1.20;
    else if (level <= 75) growthRate = 1.20;
    else if (level <= 85) growthRate = 1.20;
    else if (level <= 95) growthRate = 1.20;
    else growthRate = 1.30;

    cost = Math.ceil(cost * growthRate);
  }

  return cost;
}
// ------------------------------------------------------------
// 基本獲得金額
// ------------------------------------------------------------

function calculateMultiplier(level) {
  if (level <= 10) return 1 + level * 2;
  if (level <= 20) return 21 + (level - 10) * 3;
  if (level <= 29) return 51 + (level - 20) * 5;
  if (level === 30) return 96;
  return 100 + (level - 30) * 10;
}

// ------------------------------------------------------------
// 強化処理
// ------------------------------------------------------------

function purchaseSpeedUpgrade() {
  if (money < speedCost() || speedLevel >= MAX_SPEED_LEVEL) {
    updateMoney();
    return false;
  }

  money -= speedCost();
  speedLevel++;

  speed = Math.max(
    MIN_DROP_INTERVAL,
    Number((5 - speedLevel * 0.3).toFixed(1))
  );

  updateMoney();
  return true;
}

function purchaseMultiplierUpgrade() {
  const cost = multiplierCost();
  if (money < cost) {
    updateMoney();
    return false;
  }

  money -= cost;
  multiplierLevel++;
  multiplier = calculateMultiplier(multiplierLevel);

  updateMoney();
  return true;
}
// ------------------------------------------------------------
// 長押し連続強化
// ------------------------------------------------------------

let upgradeHoldTimer = null;
let upgradeHoldType = null;
let upgradeHoldActive = false;
let upgradeHoldTriggered = false;
let upgradeHoldPointerId = null;
let suppressUpgradeClick = false;

function stopUpgradeHold() {
  upgradeHoldActive = false;
  upgradeHoldType = null;
  upgradeHoldPointerId = null;

  if (upgradeHoldTimer !== null) {
    clearTimeout(upgradeHoldTimer);
    upgradeHoldTimer = null;
  }

  document.body.classList.remove("upgrade-hold-active");
}

function performUpgrade(type) {
  if (type === "speed") {
    return purchaseSpeedUpgrade();
  }

  if (type === "mult") {
    return purchaseMultiplierUpgrade();
  }

  return false;
}

function startUpgradeHold(type, pointerId) {
  if (upgradeHoldActive) return;

  upgradeHoldActive = true;
  upgradeHoldType = type;
  upgradeHoldPointerId = pointerId;
  upgradeHoldTriggered = false;
  document.body.classList.add("upgrade-hold-active");

  // 350ms押し続けたら購入を開始し、その後120ms間隔で連続購入。
  const repeatUpgrade = () => {
    if (!upgradeHoldActive) return;

    const purchased = performUpgrade(upgradeHoldType);
    if (!purchased) {
      const wasTriggered = upgradeHoldTriggered;
      stopUpgradeHold();
      if (wasTriggered) openUpgradeMenu();
      return;
    }

    upgradeHoldTriggered = true;
    upgradeHoldTimer = setTimeout(repeatUpgrade, 120);
  };

  upgradeHoldTimer = setTimeout(repeatUpgrade, 350);
}

function bindUpgradeHold(button, type) {
  if (!button) return;

  button.onpointerdown = event => {
    if (button.disabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startUpgradeHold(type, event.pointerId);
  };

  button.onclick = event => {
    // 長押し後に発生するclickによる二重購入を防止。
    if (suppressUpgradeClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (upgradeHoldTriggered) {
      event.preventDefault();
      upgradeHoldTriggered = false;
      openUpgradeMenu();
      return;
    }

    // 350ms未満のタップは1回だけ購入。
    performUpgrade(type);
    openUpgradeMenu();
  };
}

window.addEventListener("pointerup", event => {
  if (!upgradeHoldActive) return;
  if (event.pointerId !== upgradeHoldPointerId) return;

  const wasHolding = upgradeHoldTriggered;
  stopUpgradeHold();

  if (wasHolding) {
    suppressUpgradeClick = true;

    // pointerup直後にブラウザが発生させるclickを通過させてから表示更新。
    setTimeout(() => {
      suppressUpgradeClick = false;
      upgradeHoldTriggered = false;
      openUpgradeMenu();
    }, 0);
  }
});

window.addEventListener("pointercancel", event => {
  if (!upgradeHoldActive) return;
  if (event.pointerId !== upgradeHoldPointerId) return;

  const wasHolding = upgradeHoldTriggered;
  stopUpgradeHold();
  upgradeHoldTriggered = false;

  if (wasHolding) openUpgradeMenu();
});

window.addEventListener("blur", () => {
  stopUpgradeHold();
  upgradeHoldTriggered = false;
  suppressUpgradeClick = false;
});
// ------------------------------------------------------------
// 強化メニュー
// ------------------------------------------------------------

function openUpgradeMenu() {
  stopUpgradeHold();

  const speedMaxed = speedLevel >= MAX_SPEED_LEVEL;
  const currentSpeedCost = speedCost();
  const currentMultiplierCost = multiplierCost();

  openPopup(
    "つうじょうきょうか",
    `
<div class="popup-item">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <strong>そくど</strong>
    <strong id="speed-level-value">Lv.${speedLevel}/${MAX_SPEED_LEVEL}</strong>
  </div>

  <p>現在の速度：<span id="speed-current-value">${speed.toFixed(1)}秒</span></p>

  <p>つぎの強化費用：
    <span id="speed-cost-value">${speedMaxed
      ? "---"
      : currentSpeedCost.toLocaleString() + "円"}</span>
  </p>

  <button
    id="speed-up"
    class="${money < currentSpeedCost || speedMaxed
      ? "cannot-afford"
      : ""}"
    ${money < currentSpeedCost || speedMaxed ? "disabled" : ""}
  >${speedMaxed ? "さいだいれべる" : "強化する"}</button>
</div>

<div class="popup-item">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <strong>ばいりつ</strong>
    <strong id="mult-level-value">Lv.${multiplierLevel + 1}</strong>
  </div>

  <p>現在の倍率：<span id="mult-current-value">${multiplier}円</span></p>

  <p>つぎの強化費用：
    <span id="mult-cost-value">${currentMultiplierCost.toLocaleString()}円</span>
  </p>

  <button
    id="mult-up"
    class="${money < currentMultiplierCost
      ? "cannot-afford"
      : ""}"
    ${money < currentMultiplierCost ? "disabled" : ""}
  >強化する</button>
</div>
    `
  );

  bindUpgradeHold(
    document.getElementById("speed-up"),
    "speed"
  );

  bindUpgradeHold(
    document.getElementById("mult-up"),
    "mult"
  );
}
// ------------------------------------------------------------
// コレクション画像の拡大表示
// ------------------------------------------------------------

function openCollectionImage(image) {
  if (!image || !collectionImageOverlay || !collectionLargeImage) {
    return;
  }

  const id = image.dataset.collectionId;

  if (!id || !collection.includes(id)) {
    return;
  }

  collectionLargeImage.src = image.src;
  collectionLargeImage.alt = image.alt || "コレクション画像";

  collectionImageOverlay.classList.remove("hidden");
}

function closeCollectionImage() {
  if (!collectionImageOverlay || !collectionLargeImage) {
    return;
  }

  collectionImageOverlay.classList.add("hidden");
  collectionLargeImage.src = "";
}

// ------------------------------------------------------------
// コレクション画面
// ------------------------------------------------------------

function openCollectionMenu() {
  collectionNotice.classList.add("hidden");

  const cards = collectibleFaces.map(c => {
    const owned = collection.includes(c.id);
    const isSecret = c.id === "secret";

    return `
      <div class="popup-item popup-text collection-card
        ${isSecret ? "secret-card" : ""}">
        ${isSecret
          ? '<div class="throne-layer" aria-hidden="true">♛</div>'
          : ""}

        <div class="collection-face">
          ${owned
            ? `<img
                src="images/${c.image}"
                alt="${c.name}"
                data-collection-id="${c.id}"
              >`
            : "🔒"}
        </div>

        <p class="collection-name">${owned ? c.name : "SECRET"}</p>

        ${newCollection.includes(c.id)
          ? '<strong style="color:#ffdf38">NEW！</strong>'
          : ""}
      </div>
    `;
  }).join("");

  openPopup(
    "これくしょん",
    `<div class="collection-grid">${cards}</div>`
  );

  newCollection = [];
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

// ------------------------------------------------------------
// ルール画面
// ------------------------------------------------------------

function openRulesScreen() {
  openPopup(
    "るーる",
    `
      <div class="rules-content">
        <p>🐈 猫は自動で落ちてくるよ。</p>
        <p>🔴 ピンに当たるか下の穴に入るとおかねゲット！</p>
        <p>✨ ピンや穴の数字が大きいほど、もらえるおかねも増えるよ。</p>
        <p>⬆️ 「つうじょうきょうか」で落下スピードや倍率を強化しよう。</p>
        <p>🎁 目標ポイントに届いたら「もくひょうたっせい！」を押して、くじに挑戦！</p>
        <p>🏆 景品を集めて、絶対王者を目指そう！</p>
      </div>

      <p class="rules-close-hint">
        画面のどこかをタップすると閉じるよ
      </p>
    `
  );

  popupOverlay.classList.add("rules-overlay");
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

function openSettingsMenu() {
  openPopup(
    "せってい",
    `
      <!-- BGM -->
      <div class="popup-item settings-audio-item">
        <div class="settings-toggle-row">
          <strong>BGM</strong>
          <label class="settings-checkbox">
            <input type="checkbox" id="bgm-toggle"
              ${bgmOn ? "checked" : ""}>
            ON
          </label>
        </div>

        <input id="bgm-slider" type="range"
          min="0" max="100" value="${bgmVolume * 100}">
      </div>

      <!-- SE -->
      <div class="popup-item settings-audio-item">
        <div class="settings-toggle-row">
          <strong>SE</strong>
          <label class="settings-checkbox">
            <input type="checkbox" id="se-toggle"
              ${seOn ? "checked" : ""}>
            ON
          </label>
        </div>

        <input id="se-slider" type="range"
          min="0" max="100" value="${seVolume * 100}">
      </div>

      <!-- ルール -->
      <div class="popup-item settings-action-item settings-rules-item">
        <button id="open-rules">るーる</button>
      </div>

      <!-- 絶対王者モード -->
      <div class="popup-item settings-action-item">
        <strong>絶対王者もーど</strong>
        <label class="toggle-line">
          <input type="checkbox" id="champ-toggle"
            ${championMode ? "checked" : ""}>
          ON（忙しい人向け）
        </label>
      </div>

      <!-- ゲーム復旧 -->
      <div class="popup-item settings-action-item">
        <strong>ゲーム復旧</strong>
        <button id="freeze-recovery">フリーズ解除</button>
      </div>
    `
  );

// ルール画面
document.getElementById("open-rules").addEventListener("click", event => {
  event.preventDefault();

  // 次のポップアップクリック処理を1回だけ無視する。
  ignoreNextPopupClick = true;

  openRulesScreen();
});

  // ゲーム復旧
  document.getElementById("freeze-recovery").onclick = () => {
    recoverGame();
  };

  // BGM ON / OFF
  document.getElementById("bgm-toggle").onchange = e => {
    bgmOn = e.target.checked;

    if (bgmOn) {
      updateBGM();
    } else if (bgmAudio) {
      bgmAudio.pause();
    }
  };

  // BGM音量
  document.getElementById("bgm-slider").oninput = e => {
    bgmVolume = Number(e.target.value) / 100;
    updateBGMVolume();
  };

  // SE ON / OFF
  document.getElementById("se-toggle").onchange = e => {
    seOn = e.target.checked;
  };

  // SE音量
  document.getElementById("se-slider").oninput = e => {
    seVolume = Number(e.target.value) / 100;
  };

  // 絶対王者モード
  document.getElementById("champ-toggle").onchange = e => {
    championMode = e.target.checked;

    holes.forEach(hole => {
      hole.multiplier = championMode
        ? 9999
        : randomHoleMultiplier();
    });

    if (championMode) {
      pins.forEach(pin => {
        pin.multiplier = 100;
      });
    } else {
      assignNormalPinMultipliers();
    }

    lastHoleChange = Date.now();
    lastPinChange = Date.now();

    createSparkles();

    if (championMode) {
      createBoardSparkles();
    } else {
      boardSparkles = [];
    }

    updateBGM();
    drawBoard();
  };
}
// ------------------------------------------------------------
// さいしょから
// ------------------------------------------------------------

resetButton.addEventListener("click", () => {
  openPopup(
    "さいしょから？",
    `
      <div class="popup-item popup-text">
        <p>さいしょからはじめると、すべてのデータがリセットされるよ。</p>
        <p>これくしょんもぜんぶなくなるよ！</p>
        <button id="reset-cancel">やめる</button>
        <button id="reset-confirm">さいしょから</button>
      </div>
    `
  );
});

popupContent.addEventListener("click", e => {
  if (e.target.id === "reset-cancel") {
    closePopup();
  }

if (e.target.id === "reset-confirm") {
  stopGameTicker();
  stopUpgradeHold();

  // 周回数を増やして保存
  lifeCount++;
  localStorage.setItem("kiyoneko-life-count", lifeCount);
  updateLifeCount();

  stage = 1;
  money = 0;

    speedLevel = 0;
    speed = 5;

    multiplierLevel = 0;
    multiplier = 1;

    cats = [];
    collection = [];
    newCollection = [];

    completionShown = false;
    stageCleared = false;
    drawPending = false;
    paused = false;

    championMode = false;
    sparkleParticles = [];
    boardSparkles = [];

    pointHistory.length = 0;
// 非表示収入の計測データもリセット
idleIncomeSamples.length = 0;
incomeTrackingStartedAt = Date.now();
hiddenAt = null;
hiddenIncomeRate = 0;
    previousPattern = -1;

    console.info(
      "[キヨ猫あつめ] さいしょから開始。ポイント履歴をリセットしました。"
    );

    updateGoal();
    updateMoney();

    closePopup();
    createBoard();
    resumeLoop();
    updateBGM();
  }
});

// ------------------------------------------------------------
// コレクション画像をクリックしたときに拡大
// ------------------------------------------------------------

popupContent.addEventListener("click", e => {
  const image = e.target.closest(".collection-face img");
  if (!image) return;

  openCollectionImage(image);
});

// ------------------------------------------------------------
// 拡大画像を閉じる
// ------------------------------------------------------------

collectionImageClose.addEventListener("click", closeCollectionImage);

collectionImageOverlay.addEventListener("click", e => {
  if (
    e.target === collectionImageOverlay ||
    e.target === collectionLargeImage
  ) {
    closeCollectionImage();
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeCollectionImage();
  }
});

// ------------------------------------------------------------
// 初期表示
// ------------------------------------------------------------

updateGoal();
updateMoney();

console.info("キヨ猫あつめ 起動準備完了");
console.info(
  "ポイント獲得ログは獲得時に自動表示されます。最新履歴は最大200件保存されます。"
);

printPointHistory();

// ------------------------------------------------------------
// はちまるポップ読み込み確認・Canvas再描画
// ------------------------------------------------------------

(async () => {
  try {
    console.log("[フォント] 読み込み開始：Hachi Maru Pop");

    const loadedFonts = await document.fonts.load(
      '16px "Hachi Maru Pop"',
      "きよねこあつめ"
    );

    await document.fonts.ready;

    const fontLoaded = document.fonts.check(
      '16px "Hachi Maru Pop"',
      "きよねこあつめ"
    );

    console.log("[フォント] 読み込み結果:", loadedFonts);
    console.log("[フォント] 使用可能:", fontLoaded);

    if (fontLoaded) {
      console.log("[フォント] はちまるポップ使用可能");

      ctx.font = 'bold 15px "Hachi Maru Pop", sans-serif';

      if (gameStarted) {
        drawBoard();
      }
    } else {
      console.error("[フォント] 読み込みに失敗。標準フォントで表示します。");
    }
  } catch (error) {
    console.error("[フォント読み込みエラー]", error);
  }
})();