
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

const collectionNotice = document.getElementById("collection-notice");
const resetButton = document.getElementById("reset-button");
const collectionImageOverlay =
  document.getElementById("collection-image-overlay");

const collectionLargeImage =
  document.getElementById("collection-large-image");

const collectionImageClose =
  document.getElementById("collection-image-close");
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

const PIN_RADIUS = 29;
const HOLE_HEIGHT = 42;
const CAT_RADIUS = 30;
const CAT_COLLISION_RADIUS = CAT_RADIUS * 0.8;
const CAT_LOWER_COLLISION_SCALE = 0.7;

const PIN_WALL_MARGIN =
  CAT_RADIUS + PIN_RADIUS + CAT_RADIUS + 8;

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

    // 絶対王者モードは1分24.7秒から再生
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

  sparkleParticles.forEach(p => {
    const hole = holes[p.holeIndex];
    if (!hole) return;

    const wave = Math.sin(now / 350 + p.phase);
    const alpha = 0.35 + (wave + 1) * 0.3;

    const x = hole.x + hole.width * p.x;
    const y = hole.y + hole.height * p.y;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff5bd";
    ctx.shadowColor = "#fff1a0";
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.arc(
      x,
      y,
      p.size * (0.7 + (wave + 1) * 0.25),
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
  });
}

// ------------------------------------------------------------
// 盤面に降るキラキラ
// ------------------------------------------------------------

let boardSparkles = [];

function createBoardSparkles() {
  boardSparkles = [];

  const w = boardW();
  const h = boardH();

  for (let i = 0; i < 65; i++) {
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
    boardSparkles = [];
    return;
  }

  const w = boardW();
  const h = boardH();
  const scale = Math.min(dt / 16.67, 2);

  if (Math.random() < 0.08 * scale) {
    boardSparkles.push({
      x: Math.random() * w,
      y: -5,
      size: 1.5 + Math.random() * 3,
      speed: 0.5 + Math.random() * 1.3,
      drift: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2
    });
  }

  boardSparkles.forEach(p => {
    p.y += p.speed * scale;
    p.x += p.drift * scale;
  });

  boardSparkles = boardSparkles.filter(p => p.y < h + 10);
}

function drawBoardSparkles(now) {
  if (!championMode) return;

  boardSparkles.forEach(p => {
    const wave = Math.sin(now / 250 + p.phase);
    const alpha = 0.35 + (wave + 1) * 0.3;
    const size = p.size * (0.7 + (wave + 1) * 0.3);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff5bd";
    ctx.shadowColor = "#ffd84a";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x - size * 1.8, p.y);
    ctx.lineTo(p.x + size * 1.8, p.y);
    ctx.moveTo(p.x, p.y - size * 1.8);
    ctx.lineTo(p.x, p.y + size * 1.8);
    ctx.stroke();

    ctx.restore();
  });
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
// 通常モードのピン倍率を設定
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
  }

  if (multButton) {
    const canAfford = money >= multiplierCost();

    multButton.disabled = !canAfford;
    multButton.classList.toggle(
      "cannot-afford",
      !canAfford
    );
  }

  // 目標金額に到達したら達成ボタンを表示
  if (stage <= 5 && money >= goal) {
    showClearButton();
  } else {
    removeClearButton();
  }
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

    resizeCanvas();
    createBoard();

    lastDropTime = performance.now();
    lastHoleChange = Date.now();

    startGameTicker();
    updateBGM();
  };

  titleCatFace?.classList.add("spinning");
  playSound.currentTime = 0;
  playSound.addEventListener("ended", beginGame, { once: true });
  playSound.play().catch(() => beginGame());
});

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

  let p;

  do {
    p = randInt(0, pinPatterns.length - 1);
  } while (p === previousPattern);

  previousPattern = p;

  const layout = pinPatterns[p];
  const requestedCount = randInt(3, 5);
  pins = [];
  const multCounts = {};

  const candidates = layout.map(pos => {
    const rx = pos[0];

    return {
      x: safePinX(rx, w),
      y: h * (1 / 3 + pos[1] * (2 / 3)),
      rx,
      ry: (1 / 3 + pos[1] * (2 / 3))
    };
  });

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

      if (selected.length >= requestedCount) break;
    }
  }

  if (selected.length < 3) {
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;

      selected.push(candidate);

      if (selected.length >= 3) break;
    }
  }

  selected.forEach(pos => {
    pins.push({
      x: pos.x,
      y: pos.y,
      rx: pos.rx,
      ry: pos.ry,
      radius: PIN_RADIUS,
      multiplier: championMode ? 100 : 1
    });
  });

  if (!championMode) {
    assignNormalPinMultipliers();
  }

  createSparkles();

  if (championMode) {
    createBoardSparkles();
  } else {
    boardSparkles = [];
  }

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
  const dist = Math.hypot(dx, dy);

  const lowerRatio = Math.max(
    0,
    Math.min(1, dy / cat.radius)
  );

  const collisionRadius =
    cat.radius *
    (1 - (1 - CAT_LOWER_COLLISION_SCALE) * lowerRatio);

  const minDist = collisionRadius + pin.radius;

  if (dist >= minDist) return;

  if (
    !cat.pinTouching?.has(index) &&
    !frameContacts.has(index)
  ) {
    playPinSound();

    const gained = multiplier * pin.multiplier;
    money += gained;

    updateMoney();
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

  updateMoney();
  recordPointGain("倍率穴", hole.multiplier, gained, cat);

  if (stage <= 5 && money >= goal && !stageCleared) {
    stageCleared = true;
    showClearButton();
  }
}

// ------------------------------------------------------------
// 猫の物理演算
// ------------------------------------------------------------

function updateCats(dt) {
  const w = boardW();
  const h = boardH();

  const scale = Math.min(dt / 16.67, 2);
  const gravity = 0.075;
  const terminal = 2.25;

  cats.forEach(cat => {
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

    const steps = Math.max(
      1,
      Math.ceil(travel / Math.max(4, cat.radius * 0.22))
    );

    const stepScale = scale / steps;

    for (let step = 0; step < steps; step++) {
      cat.x += cat.vx * stepScale;
      cat.y += cat.vy * stepScale;

      if (cat.x - cat.radius < 0) {
        cat.x = cat.radius;
        cat.vx = Math.abs(cat.vx) * 0.75;
      }

      if (cat.x + cat.radius > w) {
        cat.x = w - cat.radius;
        cat.vx = -Math.abs(cat.vx) * 0.75;
      }

      if (cat.y - cat.radius < 0) {
        cat.y = cat.radius;
        cat.vy = Math.abs(cat.vy) * 0.75;
      }

      pins.forEach((pin, i) => {
        checkPinCollision(cat, pin, i, frameContacts);
      });
    }

    cat.pinTouching = frameContacts;
  });

  cats = cats.filter(cat => {
    const holeTop = h - HOLE_HEIGHT;

    if (cat.y + cat.radius >= holeTop) {
      const x = Math.max(0, Math.min(w - 0.01, cat.x));

      const hole =
        holes.find(q => x >= q.x && x < q.x + q.width) ||
        holes[2];

      awardHole(cat, hole);
      return false;
    }

    return true;
  });
}

// ------------------------------------------------------------
// 描画
// ------------------------------------------------------------

function drawBoard() {
  const w = boardW();
  const h = boardH();

  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#fff8e9";
  ctx.fillRect(0, 0, w, h);

  // ピン
  pins.forEach(pin => {
    ctx.beginPath();
    ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);

    ctx.fillStyle = pinColors[pin.multiplier];
    ctx.fill();

    ctx.strokeStyle = "#6a4b27";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.fillStyle = "#000";
ctx.font = 'bold 15px "Hachi Maru Pop", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText("×" + pin.multiplier, pin.x, pin.y);
  });

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
      ctx.fillStyle =
        holeColors[hole.multiplier] || "#8c65b8";
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
      ctx.shadowBlur = 15;
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
  }

  drawBoardSparkles(performance.now());

  // 落下中の猫
  cats.forEach(cat => {
    ctx.save();

    ctx.translate(cat.x, cat.y);
    ctx.rotate(cat.rotation);

    if (catImage.complete && catImage.naturalWidth > 0) {
      const drawSize = cat.radius * 2 * 5;
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
      ctx.font = `${cat.radius * 6}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(catEmoji, 0, 0);
    }

    ctx.restore();
  });
}

// ------------------------------------------------------------
// 倍率穴の変更
// ------------------------------------------------------------

function changeHoleMultipliers() {
  holes.forEach(hole => {
    hole.multiplier = championMode
      ? 9999
      : randomHoleMultiplier();
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

  const dt = Math.max(0, now - (gameLoop.lastTime || now));
  gameLoop.lastTime = now;

  if (now - lastDropTime >= speed * 1000) {
    dropCat();
    lastDropTime = now;
  }

  if (Date.now() - lastHoleChange >= 60000) {
    changeHoleMultipliers();
  }

  let remaining = dt;

  while (remaining > 0) {
    const slice = Math.min(remaining, 16.67);
    updateCats(slice);
    remaining -= slice;
  }

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
    paused = true;
    stopGameTicker();
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
          <img src="images/kiyoneko_lottery.png" alt="豪華なくじ箱">
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
  drawPending = true;

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
            <img src="images/kiyoneko_reward.png" alt="豪華獲得演出">

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
  }, 1200);
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
// 猫消去・盤面再生成・タイマー再初期化
// 進行データは維持
// ------------------------------------------------------------

function recoverGame() {
  console.warn("[キヨ猫あつめ] ゲーム復旧を実行します。");

  // 古いアニメーションループを停止
  stopGameTicker();

  // 猫だけを全消去
  cats = [];

  // クリアボタンの二重表示防止
  removeClearButton();

  // 一時的な抽選状態を解除
  drawPending = false;

  // 進行状況は維持し、ゲームを再開可能にする
  paused = false;

  // 現在時刻を基準にタイマーを再初期化
  const now = performance.now();
  gameLoop.lastTime = now;
  lastDropTime = now;
  lastHoleChange = Date.now();

  // 現在のステージ・モードに応じて盤面を再生成
  createBoard();

  // すでに目標達成済みならクリアボタンを復元
  if (stageCleared && stage <= 5) {
    showClearButton();
  }

  // 設定ポップアップを閉じる
  closePopup();

  // ゲームループ再起動
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
}

function closePopup() {
  popupOverlay.classList.add("hidden");
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
  // レベル15までは従来の料金を維持
  if (multiplierLevel <= 15) {
    return Math.ceil(5 * Math.pow(1.7, multiplierLevel));
  }

  // レベル15時点の料金を基準にする
  let cost = Math.ceil(5 * Math.pow(1.7, 15));

  // レベル16以降は10レベルごとに上昇率を変更
  for (let level = 16; level <= multiplierLevel; level++) {
    let growthRate;

    if (level <= 25) {
      growthRate = 1.65;
    } else if (level <= 35) {
      growthRate = 1.60;
    } else if (level <= 45) {
      growthRate = 1.56;
    } else if (level <= 55) {
      growthRate = 1.52;
    } else if (level <= 65) {
      growthRate = 1.48;
    } else if (level <= 75) {
      growthRate = 1.45;
    } else if (level <= 85) {
      growthRate = 1.43;
    } else if (level <= 95) {
      growthRate = 1.40;
    } else {
      growthRate = 1.30;
    }

    cost = Math.ceil(cost * growthRate);
  }

  return cost;
}


// ------------------------------------------------------------
// 基本獲得金額
// ------------------------------------------------------------

function calculateMultiplier(level) {
  // Lv.1～10：1円ずつ上昇
  if (level <= 10) {
    return level;
  }

  // Lv.11～15：2円ずつ上昇
  if (level <= 15) {
    return 10 + (level - 10) * 2;
  }

  // Lv.16～20：3円ずつ上昇
  if (level <= 20) {
    return 20 + (level - 15) * 3;
  }

  // Lv.21以降：5円ずつ上昇
  return 35 + (level - 20) * 5;
}

function openUpgradeMenu() {
  const speedMaxed = speedLevel >= MAX_SPEED_LEVEL;
  const currentSpeedCost = speedCost();
  const currentMultiplierCost = multiplierCost();

  openPopup(
    "つうじょうきょうか",
    `
      <div class="popup-item">
        <strong>そくど</strong>
        <p>現在：${speed.toFixed(1)}秒</p>
        <p>Lv.${speedLevel}/${MAX_SPEED_LEVEL}</p>
        <p>次の強化：${speedMaxed
          ? "---"
          : currentSpeedCost.toLocaleString() + "円"}
        </p>
        <button
          id="speed-up"
          class="${money < currentSpeedCost || speedMaxed
            ? "cannot-afford"
            : ""}"
          ${money < currentSpeedCost || speedMaxed ? "disabled" : ""}
        >${speedMaxed ? "レベルマックス" : "強化する"}</button>
      </div>

      <div class="popup-item">
        <strong>ばいりつ</strong>
        <p>現在：${multiplier}円</p>
        <p>Lv.${multiplierLevel + 1}</p>
        <p>次の強化：${currentMultiplierCost.toLocaleString()}円</p>
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

  document.getElementById("speed-up").onclick = () => {
    if (money < speedCost() || speedLevel >= MAX_SPEED_LEVEL) return;

    money -= speedCost();
    speedLevel++;

    speed = Math.max(
      MIN_DROP_INTERVAL,
      Number((5 - speedLevel * 0.3).toFixed(1))
    );

    updateMoney();
    openUpgradeMenu();
  };

document.getElementById("mult-up").onclick = () => {
  const cost = multiplierCost();
  if (money < cost) return;

  money -= cost;
  multiplierLevel++;
  multiplier = calculateMultiplier(multiplierLevel + 1);

  updateMoney();
  openUpgradeMenu();
};
}

// ------------------------------------------------------------
// コレクション画像の拡大表示
// ------------------------------------------------------------

function openCollectionImage(image) {
  if (!image || !collectionImageOverlay || !collectionLargeImage) {
    return;
  }

  const id = image.dataset.collectionId;

  // 所持しているコレクションだけ拡大できる
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

function openSettingsMenu() {
  openPopup(
    "せってい",
    `
      <div class="popup-item">
        <strong>BGM</strong>
        <label class="toggle-line">
          <input type="checkbox" id="bgm-toggle"
            ${bgmOn ? "checked" : ""}> ON
        </label>
        <input id="bgm-slider" type="range"
          min="0" max="100" value="${bgmVolume * 100}">
      </div>

      <div class="popup-item">
        <strong>効果音</strong>
        <label class="toggle-line">
          <input type="checkbox" id="se-toggle"
            ${seOn ? "checked" : ""}> ON
        </label>
        <input id="se-slider" type="range"
          min="0" max="100" value="${seVolume * 100}">
      </div>

      <div class="popup-item">
        <strong>絶対王者モード</strong>
        <label class="toggle-line">
          <input type="checkbox" id="champ-toggle"
            ${championMode ? "checked" : ""}>
          ON（忙しい人向け）
        </label>
      </div>

      <div class="popup-item">
        <strong>ゲーム復旧</strong>
        <p>ゲームがフリーズしたときに動作を再開するよ。</p>
        <button id="freeze-recovery">フリーズ解除</button>
      </div>
    `
  );

  // フリーズ解除ボタン
  document.getElementById("freeze-recovery").onclick = () => {
    recoverGame();
  };

  document.getElementById("bgm-toggle").onchange = e => {
    bgmOn = e.target.checked;

    if (bgmOn) {
      updateBGM();
    } else if (bgmAudio) {
      bgmAudio.pause();
    }
  };

  document.getElementById("bgm-slider").oninput = e => {
    bgmVolume = Number(e.target.value) / 100;
    updateBGMVolume();
  };

  document.getElementById("se-toggle").onchange = e => {
    seOn = e.target.checked;
  };

  document.getElementById("se-slider").oninput = e => {
    seVolume = Number(e.target.value) / 100;
  };

  document.getElementById("champ-toggle").onchange = e => {
    championMode = e.target.checked;

    // 穴の倍率変更
    holes.forEach(hole => {
      hole.multiplier = championMode
        ? 9999
        : randomHoleMultiplier();
    });

    // ピンの倍率変更
    if (championMode) {
      pins.forEach(pin => {
        pin.multiplier = 100;
      });
    } else {
      // 通常モードでは同じ倍率を最大2個に制限
      assignNormalPinMultipliers();
    }

    lastHoleChange = Date.now();

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
// コレクション画像をクリックしたときに拡大
popupContent.addEventListener("click", e => {
  const image = e.target.closest(".collection-face img");

  if (!image) return;

  openCollectionImage(image);
});

// 拡大画像を閉じる
collectionImageClose.addEventListener("click", closeCollectionImage);

// 拡大画像そのもの、または背景をクリックして閉じる
collectionImageOverlay.addEventListener("click", e => {
  if (
    e.target === collectionImageOverlay ||
    e.target === collectionLargeImage
  ) {
    closeCollectionImage();
  }
});

// Escapeキーでも閉じられるようにする
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
      "きよ猫あつめ"
    );

    await document.fonts.ready;

    const fontLoaded = document.fonts.check(
      '16px "Hachi Maru Pop"',
      "きよ猫あつめ"
    );

    console.log("[フォント] 読み込み結果:", loadedFonts);
    console.log("[フォント] 使用可能:", fontLoaded);

    if (fontLoaded) {
      console.log("[フォント] はちまるポップ使用可能");

      // Canvasのフォントを明示的に指定
      ctx.font = 'bold 15px "Hachi Maru Pop", sans-serif';

      // ゲーム開始済みなら盤面を再描画
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