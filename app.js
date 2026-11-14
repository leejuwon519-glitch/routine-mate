const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const MODE_NAMES = {
  sleep: "수면",
  focus: "디지털 디톡스",
  move: "신체 활동"
};

const MODE_ICONS = {
  sleep: "☾",
  focus: "🌿",
  move: "👟"
};

const WORLD_NAMES = {
  cafe: "라벤더 카페",
  library: "고요한 도서관",
  garden: "초록 산책 정원",
  bedroom: "나의 포근한 방"
};

const CHARACTERS = ["🐰", "🐻", "🐱", "🐸"];

const ITEMS = [
  {
    id: "bed",
    name: "구름 라벤더 침대",
    type: "침대",
    price: 30,
    icon: "🛏️",
    color: "#e4d7ef"
  },
  {
    id: "desk",
    name: "작은 원목 책상",
    type: "책상",
    price: 40,
    icon: "🪑",
    color: "#ecd9c0"
  },
  {
    id: "lamp",
    name: "달빛 펜던트",
    type: "조명",
    price: 20,
    icon: "💡",
    color: "#fbefc8"
  },
  {
    id: "wall",
    name: "민트빛 벽지",
    type: "벽지",
    price: 35,
    icon: "🎨",
    color: "#dcecdf"
  },
  {
    id: "plant",
    name: "초록 친구",
    type: "장식",
    price: 15,
    icon: "🪴",
    color: "#d7e6cc"
  },
  {
    id: "skin",
    name: "별빛 토끼 스킨",
    type: "캐릭터",
    price: 50,
    icon: "🐇",
    color: "#e8ddf5"
  }
];

let state = {
  user: {
    nickname: "루미",
    character: "🐰",
    bedtime: "23:00",
    hours: 8
  },
  coins: 0,
  sessions: [],
  rewards: [],
  owned: [],
  applied: [],
  apps: [],
  room: null,
  rooms: [],
  authenticated: false
};

const game = {
  mode: "focus",
  world: "cafe",
  zoom: 1,
  player: { x: 171, y: 208 },
  target: { x: 171, y: 208 },
  targetMinutes: 60,
  targetKm: 3,
  exercise: "걷기",
  dialog: "",
  lastResult: null,
  online: false
};

const dialog = $("#dialog");
const canvas = $("#game");
const ctx = canvas.getContext("2d");

let requestQueue = Promise.resolve();
let toastTimer;
let geoWatch = null;
let geoPrevious = null;
let geoStatus = "측정 전";
let geoPendingKm = 0;
let geoFlushTimer = null;
let viewScale = 1;
let viewOffsetX = 0;
let viewOffsetY = 0;
let canvasWidth = 0;
let canvasHeight = 0;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function clamp(value, min, max) {
  const n = Number(value);
  return Math.min(
    max,
    Math.max(min, Number.isFinite(n) ? n : min)
  );
}

function timeString(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return [
    Math.floor(s / 3600),
    Math.floor(s / 60) % 60,
    s % 60
  ].map((n) => String(n).padStart(2, "0")).join(":");
}

function localDate(value) {
  return new Date(value).toLocaleDateString("ko-KR");
}

function localDateTime(value) {
  return new Date(value).toLocaleString("ko-KR");
}

function activeSession() {
  return state.sessions.find((s) => s.status === "running");
}

function elapsed(session) {
  if (!session) return 0;
  if (session.status !== "running") return session.elapsed || 0;

  return Math.max(
    0,
    Math.floor((Date.now() - session.startedAt) / 1000)
      + session.offset
  );
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");

  toastTimer = setTimeout(() => {
    $("#toast").classList.add("hidden");
  }, 3500);
}

function setConnection(text, online) {
  game.online = online;
  $("#connection").textContent = text;
  $("#connection").classList.toggle("online", online);
}

/*
 * 모든 서버 요청은 순서대로 실행합니다.
 * 프로필 저장, 방 입장, 미션 종료가 서로 추월하지 않도록 합니다.
 */
function request(body, options = {}) {
  const task = requestQueue.catch(() => {}).then(async () => {
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("온라인 API 응답을 확인할 수 없어요.");
      }

      if (!response.ok) {
        if (response.status === 401) {
          state.authenticated = false;
          $("#login-banner").classList.remove("hidden");
          setConnection("로그인 필요", false);
        } else {
          setConnection("연결 오류", false);
          if (!options.quiet) {
            toast(data.error || "요청을 처리하지 못했어요.");
          }
        }

        return null;
      }

      state = data;
      state.sessions ||= [];
      state.rooms ||= [];
      state.owned ||= [];
      state.applied ||= [];
      state.apps ||= [];

      $("#login-banner").classList.add("hidden");
      setConnection("온라인", true);
      refreshHUD();
      refreshRoomLive();

      return data;
    } catch (error) {
      setConnection("연결 끊김", false);
      if (!options.quiet) {
        toast(error.message || "서버 연결을 확인해 주세요.");
      }
      return null;
    }
  });

  requestQueue = task.then(() => {});
  return task;
}

function sync() {
  return request({
    action: "sync",
    x: game.player.x,
    y: game.player.y,
    world: game.world
  }, { quiet: true });
}

function requireLogin() {
  if (state.authenticated) return true;

  openDialog(
    "login",
    "함께할 준비가 되었나요?",
    `
      <p>
        각자 로그인한 뒤 같은 방에 들어가면
        친구들과 함께 루틴을 실천할 수 있어요.
      </p>
      <div class="notice">
        이 앱은 비밀번호를 직접 수집하거나 저장하지 않습니다.
      </div>
      <a
        class="primary full"
        href="/signin-with-chatgpt?return_to=%2F"
        target="_top"
      >ChatGPT로 로그인</a>
    `,
    "루틴 월드"
  );

  return false;
}

function refreshHUD() {
  const session = activeSession();
  const completed = state.sessions.filter(
    (s) => s.status === "completed"
  );

  const today = completed.filter(
    (s) => new Date(s.endedAt).toDateString()
      === new Date().toDateString()
  );

  const count = new Set(today.map((s) => s.mode)).size;

  $("#coins").textContent = state.coins.toLocaleString();
  $("#profile-button").textContent = state.user.character;
  $("#pet").textContent = state.applied.includes("skin")
    ? "🐇"
    : state.user.character;

  $("#pet-name").textContent =
    `${state.user.nickname} · Lv. ${1 + Math.floor(completed.length / 5)}`;

  $("#greeting").textContent =
    `${state.user.nickname}님, 오늘도 같은 공간에서 함께해요.`;

  $("#location-title").textContent = WORLD_NAMES[game.world];
  $("#room-name").textContent =
    state.room?.name || "친구들과 방 만나기";

  $("#quest-count").textContent = `${count} / 3`;
  $("#quest-description").textContent = today.length
    ? `오늘 ${today.length}번 실천했어요. 차곡차곡 잘하고 있어요!`
    : "첫 루틴을 마치고 내 방을 꾸며보세요.";

  $("#timer").textContent = timeString(elapsed(session));

  $("#mission-title").textContent = session
    ? "차곡차곡, 실천하는 중"
    : "어떤 하루를 만들어볼까요?";

  $("#mission-description").textContent = session
    ? `${MODE_NAMES[session.mode]} 미션 진행 중`
    : "잠시 머물며 나를 위한 루틴을 시작해요.";

  $("#mission-button").textContent = session
    ? "진행 중인 미션 열기"
    : `▶ ${MODE_NAMES[game.mode]} 시작하기`;

  $("#reward-hint").textContent = {
    sleep: "🪙 포근한 밤을 준비하고 루틴 보상 받기",
    focus: "🪙 집중 1시간마다 10코인",
    move: "🪙 1km마다 10코인 · 임시 규칙"
  }[game.mode];

  $("#world").classList.toggle(
    "night",
    session?.mode === "sleep"
  );

  $$("[data-world]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.world === game.world
    );
  });

  $$("[data-mode]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.mode === game.mode
    );
  });

  if (game.dialog === "mission") {
    const timer = $("#session-timer");
    if (timer) timer.textContent = timeString(elapsed(session));

    const distance = $("#session-distance");
    if (distance && session) {
      distance.textContent = `${session.km.toFixed(2)}km`;
    }

    const progress = $("#session-progress");
    if (progress && session) {
      let value;

      if (session.mode === "move") {
        value = session.km / session.targetKm * 100;
      } else {
        const target = session.mode === "sleep"
          ? session.targetHours * 3600
          : session.targetMinutes * 60;

        value = elapsed(session) / target * 100;
      }

      progress.style.width = `${clamp(value, 0, 100)}%`;
    }
  }
}

function openDialog(name, title, html, subtitle = "") {
  game.dialog = name;
  $("#dialog-title").textContent = title;
  $("#dialog-subtitle").textContent = subtitle;
  $("#dialog-content").innerHTML = html;

  dialog.classList.toggle(
    "night",
    name === "mission" && activeSession()?.mode === "sleep"
  );

  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  dialog.close();
  game.dialog = "";
}

function setWorld(world) {
  if (!(world in WORLD_NAMES)) return;
  game.world = world;
  game.target = { x: 171, y: 250 };
  refreshHUD();
  sync();
}

function openRooms() {
  if (!requireLogin()) return;

  openDialog(
    "rooms",
    "함께 만드는 꾸준함",
    `
      <div class="notice">
        친구에게 앱 주소와 초대 코드를 보내주세요.
        각자 로그인 후 같은 코드로 입장하면 함께할 수 있어요.
      </div>

      <form id="create-room-form">
        <label>
          친구방 이름
          <input
            name="name"
            maxlength="32"
            required
            placeholder="우리의 포근한 루틴 모임"
          >
        </label>

        <button class="primary" type="submit">
          ＋ 친구방 생성
        </button>
      </form>

      <form id="join-room-form">
        <label>
          초대 코드
          <input
            name="code"
            maxlength="32"
            required
            placeholder="친구가 보낸 코드"
            autocomplete="off"
          >
        </label>

        <button class="secondary" type="submit">
          코드로 방 참여
        </button>
      </form>

      <div class="divider"></div>

      <h3>공개방 둘러보기</h3>
      <div id="public-room-list"></div>

      <div class="divider"></div>

      <div id="current-room"></div>
    `,
    "함께하면 조금 더 꾸준히"
  );

  refreshRoomLive();
}

function refreshRoomLive() {
  if (game.dialog !== "rooms") return;

  const list = $("#public-room-list");

  if (list) {
    list.innerHTML = state.rooms.length
      ? state.rooms.map((room, index) => `
          <div class="public-room">
            <span>${["🌙", "📚", "🌿"][index % 3]}</span>
            <div>
              <strong>${escapeHTML(room.name)}</strong>
              <p>
                온라인 ${room.count || 0}명
                · 공동 목표 ${room.goal}회
              </p>
            </div>
            <button
              class="secondary"
              data-action="join-public"
              data-name="${escapeHTML(room.name)}"
            >입장</button>
          </div>
        `).join("")
      : `<p class="small">공개방 정보를 불러오는 중이에요.</p>`;
  }

  const current = $("#current-room");
  if (!current) return;

  const room = state.room;

  if (!room) {
    current.innerHTML = `
      <div class="empty">
        <span>🌱</span>
        <h3>아직 참여한 방이 없어요</h3>
        <p>친구방을 만들거나 공개방에 들어가 보세요.</p>
      </div>
    `;
    return;
  }

  current.innerHTML = `
    <div class="row spread">
      <h3>${escapeHTML(room.name)}</h3>
      <button class="secondary" data-action="copy-code">
        초대 코드 ${escapeHTML(room.code)} ⧉
      </button>
    </div>

    <div class="progress">
      <i style="width:${clamp(
        room.contribution / room.goal * 100, 0, 100
      )}%"></i>
    </div>

    <p class="small">
      공동 목표 ${room.contribution} / ${room.goal}회
      · 완료한 미션이 목표에 반영돼요.
    </p>

    <div class="member-grid">
      ${room.members.map((member) => `
        <div class="member">
          <span>${escapeHTML(member.character)}</span>
          <strong>
            ${escapeHTML(member.name)}
            ${member.me ? " · 나" : ""}
          </strong>
          <small>${escapeHTML(member.mode)}</small>
        </div>
      `).join("")}
    </div>

    <button class="primary full" data-action="home">
      같은 공간으로 돌아가기
    </button>

    <p class="small" style="margin-top:12px">
      위치와 상태는 약 2.5초마다 갱신됩니다.
      15초 이상 신호가 없으면 오프라인으로 표시돼요.
      캐릭터를 보려면 친구와 같은 공간을 선택하세요.
    </p>
  `;
}

function openProfile() {
  if (!requireLogin()) return;

  openDialog(
    "profile",
    "나를 닮은 친구",
    `
      <form id="profile-form">
        <label>
          닉네임
          <input
            name="nickname"
            maxlength="16"
            required
            value="${escapeHTML(state.user.nickname)}"
          >
        </label>

        <label>캐릭터 선택</label>

        <div class="character-grid">
          ${CHARACTERS.map((character) => `
            <label>
              <input
                type="radio"
                name="character"
                value="${character}"
                ${state.user.character === character ? "checked" : ""}
              >
              <span>${character}</span>
            </label>
          `).join("")}
        </div>

        <label>
          목표 취침 시각
          <input
            type="time"
            name="bedtime"
            required
            value="${escapeHTML(state.user.bedtime)}"
          >
        </label>

        <label>
          목표 수면 루틴 시간
          <input
            type="number"
            name="hours"
            min="1"
            max="16"
            step="0.5"
            value="${state.user.hours}"
            required
          >
        </label>

        <button class="primary full" type="submit">
          프로필 저장
        </button>
      </form>
    `,
    "나만의 속도로 성장하기"
  );
}

function openSettings() {
  if (!requireLogin()) return;

  const appNames = [
    "인스타그램",
    "유튜브",
    "틱톡",
    "X",
    "페이스북"
  ];

  openDialog(
    "settings",
    "나에게 맞는 루틴",
    `
      <button class="secondary" data-action="profile">
        닉네임 · 캐릭터 · 수면 목표 변경
      </button>

      <div class="divider"></div>

      <h3>모드별 제한 대상 앱</h3>

      <form id="apps-form">
        ${Object.entries(MODE_NAMES).map(([mode, label]) => `
          <details>
            <summary>${label}</summary>
            ${appNames.map((app) => {
              const key = `${mode}:${app}`;
              return `
                <label class="check-label">
                  <input
                    type="checkbox"
                    name="apps"
                    value="${escapeHTML(key)}"
                    ${state.apps.includes(key) ? "checked" : ""}
                  >
                  ${escapeHTML(app)}
                </label>
              `;
            }).join("")}
          </details>
        `).join("")}

        <div class="notice">
          제한 대상을 저장하는 설정입니다.
          일반 웹 앱은 다른 앱을 잠그거나 사용 중인 앱을
          판별할 수 없습니다. 실제 차단에는 네이티브 연동이 필요해요.
        </div>

        <button class="primary" type="submit">
          제한 대상 저장
        </button>
      </form>

      <div class="divider"></div>

      <h3>공통 점수 규칙</h3>

      <p class="small">
        수면 시간: 최대 50점, 목표보다 30분 부족마다 5점 감점.<br>
        시작 시각: 최대 30점, 목표와 30분 차이부터
        30분마다 2점 감점.<br>
        목표와 16~29분 차이는 임시로 감점하지 않습니다.<br>
        디톡스: 완료한 온전한 1시간당 10점.<br>
        활동: 1km당 10점, 소수점 점수는 버립니다.<br>
        1점 = 1코인. 온라인에서는 동일한 서버 규칙을 사용합니다.
      </p>

      <div class="notice">
        수면은 루틴 시작·종료 시간만 기록합니다.
        실제 수면 여부, 수면의 질, 깨어남을 판정하지 않습니다.
      </div>

      <h3>온라인 저장</h3>
      <p class="small">
        코인, 미션 기록, 보유 아이템은 로그인한 계정에 저장합니다.
        같은 방에는 닉네임, 캐릭터, 모드, 게임 속 좌표를 공유합니다.
        GPS 원 좌표는 서버로 보내지 않습니다.
      </p>

      <div class="divider"></div>

      <a
        class="secondary"
        href="/signout-with-chatgpt?return_to=%2F"
        target="_top"
      >로그아웃</a>
    `,
    "편안하게, 꾸준하게"
  );
}

function openShop() {
  if (!requireLogin()) return;

  game.world = "bedroom";
  refreshHUD();

  openDialog(
    "shop",
    "나의 작은 방",
    `
      <div class="row spread">
        <p class="small">구매한 다음 적용하면 방에 반영돼요.</p>
        <strong>🪙 ${state.coins} 코인</strong>
      </div>

      <div class="shop-grid" style="margin-top:18px">
        ${ITEMS.map((item) => {
          const owned = state.owned.includes(item.id);
          const applied = state.applied.includes(item.id);
          const disabled = !owned && state.coins < item.price;

          return `
            <article class="item">
              <div
                class="item-art"
                style="background:${item.color}"
              >${item.icon}</div>

              <small class="small">${item.type}</small>
              <strong>${item.name}</strong>
              <p>
                ${item.price} 코인
                ${owned ? " · 보유" : ""}
              </p>

              <button
                class="${applied ? "primary" : "secondary"} full"
                data-action="buy"
                data-id="${item.id}"
                ${disabled ? "disabled" : ""}
              >
                ${applied
                  ? "적용 중 · 해제"
                  : owned
                    ? "방에 적용"
                    : disabled
                      ? "코인 부족"
                      : "구매하기"}
              </button>
            </article>
          `;
        }).join("")}
      </div>

      <button class="text-button" data-action="home">
        꾸민 방 둘러보기 →
      </button>
    `,
    "작은 노력으로 채우는 공간"
  );
}

function openRecords() {
  if (!requireLogin()) return;

  const complete = state.sessions.filter(
    (s) => s.status === "completed"
  );

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + index);

    const count = complete.filter(
      (s) => new Date(s.endedAt).toDateString()
        === date.toDateString()
    ).length;

    return { date, count };
  });

  const maximum = Math.max(1, ...days.map((d) => d.count));

  openDialog(
    "records",
    "나의 발자국",
    `
      <h3>최근 7일 실천 추이</h3>

      <div class="chart">
        ${days.map(({ date, count }) => `
          <div class="chart-column">
            <strong>${count}회</strong>
            <div style="height:${Math.max(
              3,
              count / maximum * 110
            )}px"></div>
            <small>${date.getMonth() + 1}/${date.getDate()}</small>
          </div>
        `).join("")}
      </div>

      <p class="small">
        완료한 실제·데모 세션을 합산합니다.
        아래 기록에서 실제·데모 여부를 확인할 수 있어요.
      </p>

      <div class="divider"></div>

      ${state.sessions.length
        ? state.sessions.map((session) => `
            <div class="record">
              <span>${MODE_ICONS[session.mode]}</span>
              <div>
                <strong>
                  ${MODE_NAMES[session.mode]}
                  <span class="small-tag">
                    ${session.demo ? "데모" : "실제"}
                  </span>
                </strong>

                <p>
                  ${localDateTime(session.startedAt)}
                  · ${session.status === "running"
                    ? "진행 중"
                    : session.status === "abandoned"
                      ? "중도 종료"
                      : "완료"}
                </p>

                <p>
                  ${timeString(elapsed(session))}
                  ${session.mode === "move"
                    ? ` · ${session.km.toFixed(2)}km`
                    : ""}
                </p>
              </div>

              <button
                class="secondary"
                data-action="record"
                data-id="${session.id}"
              >
                +${session.points || 0}점 ›
              </button>
            </div>
          `).join("")
        : `
          <div class="empty">
            <span>🌱</span>
            <h3>아직 기록이 없어요</h3>
            <p>오늘의 첫 미션으로 발자국을 남겨보세요.</p>
            <button
              class="primary"
              data-action="mission"
              style="margin-top:18px"
            >첫 미션 시작하기</button>
          </div>
        `}
    `,
    "작은 실천도 소중한 기록"
  );
}

function openMissionSetup() {
  if (!requireLogin()) return;

  if (activeSession()) {
    openRunningMission();
    return;
  }

  const mode = game.mode;

  openDialog(
    "setup",
    `${MODE_NAMES[mode]} 시작하기`,
    `
      <div class="session-summary">
        <span style="font-size:45px">${MODE_ICONS[mode]}</span>
      </div>

      <form id="start-form">
        ${mode === "sleep" ? `
          <label>
            목표 취침 시각
            <input
              name="bedtime"
              type="time"
              value="${escapeHTML(state.user.bedtime)}"
              required
            >
          </label>

          <label>
            목표 수면 루틴 시간
            <input
              name="hours"
              type="number"
              min="1"
              max="16"
              step="0.5"
              value="${state.user.hours}"
              required
            >
          </label>

          <div class="notice">
            시작부터 종료까지의 루틴 유지 시간을 기록해요.
            실제 수면 여부를 판정하지 않으며
            화면이 꺼져도 자동 실패하지 않습니다.
          </div>
        ` : mode === "focus" ? `
          <label>
            목표 집중 시간 (분)
            <input
              name="target"
              type="number"
              min="1"
              max="720"
              value="${game.targetMinutes}"
              required
            >
          </label>

          <div class="notice">
            완료된 온전한 1시간마다 10점을 지급합니다.
            중도 포기하면 현재 세션 보상은 지급되지 않습니다.
          </div>
        ` : `
          <label>
            운동 선택
            <select name="exercise">
              <option>걷기</option>
              <option>달리기</option>
            </select>
          </label>

          <label>
            목표 거리 (km)
            <input
              name="distance"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value="${game.targetKm}"
              required
            >
          </label>

          <div class="notice">
            위치 권한을 허용하면 이동 거리를 측정합니다.
            브라우저의 백그라운드 위치 측정은 중단될 수 있어요.
          </div>
        `}

        <button class="primary full" type="submit">
          ▶ 미션 시작
        </button>
      </form>
    `,
    "나를 위한 작은 실천"
  );
}

function openRunningMission() {
  const session = activeSession();

  if (!session) {
    openMissionSetup();
    return;
  }

  openDialog(
    "mission",
    `${MODE_NAMES[session.mode]} 진행 중`,
    `
      <div class="session-summary">
        <span class="small-tag">
          ${session.demo ? "데모 기록" : "실제 기록"}
        </span>

        <div id="session-timer" class="timer">
          ${timeString(elapsed(session))}
        </div>

        <p>${escapeHTML(session.goal)}</p>

        <div class="progress">
          <i id="session-progress" style="width:0"></i>
        </div>
      </div>

      ${session.mode === "sleep" ? `
        <div class="notice">
          시작: ${localDateTime(session.startedAt)}<br>
          수면 루틴 유지 시간만 기록합니다.
          실제 수면의 질이나 깨어남은 판정하지 않습니다.
        </div>
      ` : ""}

      ${session.mode === "move" ? `
        <div class="row spread" style="margin-top:20px">
          <strong id="session-distance">
            ${session.km.toFixed(2)}km
          </strong>
          <span class="small">
            목표 ${session.targetKm}km
          </span>
        </div>

        <p id="geo-status" class="small" style="margin:12px 0">
          ${escapeHTML(geoStatus)}
        </p>

        <div class="row">
          <button class="secondary" data-action="gps-start">
            위치 측정 시작
          </button>
          <button class="secondary" data-action="gps-stop">
            측정 중단
          </button>
        </div>

        <div class="notice">
          권한 거부, 위치 수신 실패, 측정 중단 상태가 표시됩니다.
          백그라운드에서는 위치 수신이 중단될 수 있습니다.
        </div>

        <form id="demo-distance-form">
          <label>
            발표용 데모 거리 (km)
            <input
              type="number"
              name="km"
              min="0"
              max="200"
              step="0.1"
              value="${session.km}"
              required
            >
          </label>

          <button class="secondary" type="submit">
            데모 거리 적용
          </button>
        </form>
      ` : ""}

      <div class="demo-controls">
        <strong>발표 전용 · 시간 단축</strong>

        <button class="secondary" data-action="advance">
          +${session.mode === "sleep"
            ? `${session.targetHours}시간`
            : "1시간"} 빠르게 보내기
        </button>

        <p>
          사용한 세션은 데모 기록으로 표시됩니다.
          수면 데모의 시작 시각 차이는 10분으로 가정합니다.
        </p>
      </div>

      <p class="small">
        페이지 숨김 ${session.hidden.length}회 기록.
        화면 잠금·탭 전환을 특정 앱 사용이나 부정행위로
        판단하지 않습니다.
      </p>

      <button
        class="primary full"
        data-action="finish"
        style="margin-top:18px"
      >미션 완료하기 ✓</button>

      <button class="text-button" data-action="abandon">
        중도 포기
      </button>
    `,
    "나만의 속도로 차곡차곡"
  );

  refreshHUD();
}

function openResult(session) {
  if (!session) return;

  game.lastResult = session;

  openDialog(
    "result",
    session.status === "completed"
      ? "작은 실천, 멋지게 해냈어요!"
      : "다음 작은 실천을 응원해요",
    `
      <div class="session-summary">
        <span style="font-size:48px">
          ${session.status === "completed" ? "🌟" : "🌱"}
        </span>

        <p>
          ${session.demo ? "데모 기록" : "실제 기록"}
          · ${session.status === "completed" ? "완료" : "중도 종료"}
        </p>

        <p>목표: ${escapeHTML(session.goal)}</p>
        <p>
          결과: ${timeString(session.elapsed || 0)}
          ${session.mode === "move"
            ? ` · ${session.km.toFixed(2)}km`
            : ""}
        </p>
      </div>

      <div class="result-score">
        +${session.points || 0}
        <small>
          점 · ${session.coins || 0} 코인
        </small>
      </div>

      ${(session.parts || []).map((part) => `
        <div class="calculation">
          <strong>
            ${escapeHTML(part.label)}
            <span>${part.value}점</span>
          </strong>
          <p>${escapeHTML(part.formula)}</p>
        </div>
      `).join("")}

      <div class="notice">
        공동 목표 기여: ${session.contribution || 0}회<br>
        같은 세션의 보상은 한 번만 지급됩니다.
        새로고침하거나 완료를 다시 요청해도 중복 지급하지 않습니다.
      </div>

      ${session.mode === "sleep" ? `
        <p class="small">
          종료: ${localDateTime(session.endedAt)}<br>
          이 점수는 루틴 유지 시간과 시작 시각에 기반하며
          실제 수면 시간이나 수면의 질을 의미하지 않습니다.
        </p>
      ` : ""}

      <div class="row" style="margin-top:20px">
        <button class="primary" data-action="shop">
          나의 방 꾸미기
        </button>
        <button class="secondary" data-action="rooms">
          미션방으로 돌아가기
        </button>
      </div>
    `,
    "오늘의 나를 위한 보상"
  );
}

/* ---------- 위치 측정 ---------- */

function updateGeoStatus(message) {
  geoStatus = message;
  const element = $("#geo-status");
  if (element) element.textContent = message;
}

function haversine(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;

  const v =
    Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * radians)
      * Math.cos(b.latitude * radians)
      * Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(
    Math.sqrt(v),
    Math.sqrt(Math.max(0, 1 - v))
  );
}

function stopGPS() {
  if (geoWatch !== null) {
    navigator.geolocation.clearWatch(geoWatch);
  }

  geoWatch = null;
  geoPrevious = null;
  clearTimeout(geoFlushTimer);
  geoFlushTimer = null;
  updateGeoStatus("측정 중단");
}

function startGPS() {
  const session = activeSession();

  if (!session || session.mode !== "move") return;

  if (!navigator.geolocation) {
    updateGeoStatus("이 브라우저는 위치 측정을 지원하지 않아요.");
    return;
  }

  stopGPS();
  geoPendingKm = 0;
  updateGeoStatus("위치 수신 대기 중…");

  geoWatch = navigator.geolocation.watchPosition(
    (position) => {
      updateGeoStatus(
        `위치 측정 중 · 정확도 약 ${Math.round(
          position.coords.accuracy
        )}m`
      );

      if (position.coords.accuracy > 100) {
        geoPrevious = null;
        return;
      }

      if (geoPrevious) {
        const delta = haversine(
          geoPrevious.coords,
          position.coords
        );

        if (delta >= 0 && delta < 1) {
          geoPendingKm += delta;

          if (!geoFlushTimer) {
            geoFlushTimer = setTimeout(async () => {
              geoFlushTimer = null;

              const current = activeSession();
              if (!current || current.mode !== "move") return;

              const pending = geoPendingKm;
              geoPendingKm = 0;

              const response = await request({
                action: "patch",
                id: current.id,
                km: current.km + pending
              }, { quiet: true });

              if (!response) {
                geoPendingKm += pending;
              }
            }, 1500);
          }
        }
      }

      geoPrevious = position;
    },
    (error) => {
      updateGeoStatus(
        error.code === 1
          ? "위치 권한이 거부되었어요. 브라우저 설정에서 허용해 주세요."
          : "위치 수신에 실패했어요. 다시 시도해 주세요."
      );
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }
  );
}

/* ---------- 폼 처리 ---------- */

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  event.preventDefault();

  const values = new FormData(form);
  const button = form.querySelector('[type="submit"]');

  if (button) button.disabled = true;

  try {
    if (form.id === "create-room-form") {
      const response = await request({
        action: "join",
        name: String(values.get("name")).trim(),
        create: true
      });

      if (response) {
        closeDialog();
        toast("방을 만들었어요. 미션방에서 초대 코드를 복사하세요.");
      }
    }

    if (form.id === "join-room-form") {
      const response = await request({
        action: "join",
        code: String(values.get("code")).trim().toUpperCase()
      });

      if (response) {
        closeDialog();
        toast("친구방에 입장했어요.");
      }
    }

    if (form.id === "profile-form") {
      const response = await request({
        action: "profile",
        user: {
          nickname: String(values.get("nickname")).trim(),
          character: values.get("character") || state.user.character,
          bedtime: values.get("bedtime"),
          hours: Number(values.get("hours"))
        }
      });

      if (response) {
        closeDialog();
        toast("프로필을 저장했어요.");
      }
    }

    if (form.id === "apps-form") {
      const response = await request({
        action: "profile",
        apps: values.getAll("apps")
      });

      if (response) toast("제한 대상 설정을 저장했어요.");
    }

    if (form.id === "start-form") {
      if (game.mode === "sleep") {
        const profile = await request({
          action: "profile",
          user: {
            bedtime: values.get("bedtime"),
            hours: Number(values.get("hours"))
          }
        });

        if (!profile) return;
      }

      game.targetMinutes = clamp(
        values.get("target") || game.targetMinutes,
        1,
        720
      );

      game.targetKm = clamp(
        values.get("distance") || game.targetKm,
        .1,
        100
      );

      game.exercise =
        values.get("exercise") || game.exercise;

      const response = await request({
        action: "start",
        mode: game.mode,
        target: game.targetMinutes,
        distance: game.targetKm,
        exercise: game.exercise
      });

      if (response) {
        openRunningMission();
      }
    }

    if (form.id === "demo-distance-form") {
      const session = activeSession();
      if (!session) return;

      const response = await request({
        action: "patch",
        id: session.id,
        km: Number(values.get("km")),
        demo: true,
        offset: session.offset
      });

      if (response) {
        openRunningMission();
        toast("데모 거리로 기록했어요.");
      }
    }
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
});

/* ---------- 버튼 처리 ---------- */

document.addEventListener("click", async (event) => {
  const worldButton = event.target.closest("[data-world]");
  if (worldButton) {
    setWorld(worldButton.dataset.world);
    return;
  }

  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    game.mode = modeButton.dataset.mode;

    const world = {
      sleep: "bedroom",
      focus: "cafe",
      move: "garden"
    }[game.mode];

    setWorld(world);
    refreshHUD();
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  if (action === "home") {
    closeDialog();
  }

  if (action === "close") closeDialog();
  if (action === "rooms") openRooms();
  if (action === "profile") openProfile();
  if (action === "settings") openSettings();
  if (action === "shop") openShop();
  if (action === "records") openRecords();
  if (action === "mission") openMissionSetup();

  if (action === "zoom-in") {
    game.zoom = Math.min(1.35, game.zoom + .1);
  }

  if (action === "zoom-out") {
    game.zoom = Math.max(.7, game.zoom - .1);
  }

  if (action === "zoom-reset") game.zoom = 1;

  if (action === "join-public") {
    const response = await request({
      action: "join",
      name: button.dataset.name
    });

    if (response) {
      closeDialog();
      toast("공개방에 입장했어요.");
    }
  }

  if (action === "copy-code" && state.room) {
    try {
      await navigator.clipboard.writeText(state.room.code);
      toast("초대 코드를 복사했어요.");
    } catch {
      toast(`초대 코드: ${state.room.code}`);
    }
  }

  if (action === "buy") {
    button.disabled = true;

    const response = await request({
      action: "buy",
      id: button.dataset.id
    });

    if (response) {
      openShop();
      toast("아이템 상태를 저장했어요.");
    } else if (button.isConnected) {
      button.disabled = false;
    }
  }

  if (action === "record") {
    const session = state.sessions.find(
      (s) => s.id === button.dataset.id
    );

    if (session?.status === "running") {
      openRunningMission();
    } else {
      openResult(session);
    }
  }

  if (action === "advance") {
    const session = activeSession();
    if (!session) return;

    button.disabled = true;

    const amount = session.mode === "sleep"
      ? session.targetHours * 3600
      : 3600;

    const response = await request({
      action: "patch",
      id: session.id,
      demo: true,
      offset: session.offset + amount
    });

    if (response) openRunningMission();
    else if (button.isConnected) button.disabled = false;
  }

  if (action === "finish" || action === "abandon") {
    const session = activeSession();
    if (!session) return;

    const abandoned = action === "abandon";

    if (abandoned && !confirm(
      "중도 포기하면 현재 세션 시간이 초기화되고 "
      + "이번 세션 보상은 지급되지 않습니다. 포기할까요?"
    )) {
      return;
    }

    button.disabled = true;

    if (!abandoned && session.mode === "move" && geoPendingKm > 0) {
      const pending = geoPendingKm;
      geoPendingKm = 0;

      await request({
        action: "patch",
        id: session.id,
        km: session.km + pending
      });
    }

    const response = await request({
      action: "finish",
      id: session.id,
      abandoned,
      tz: -new Date().getTimezoneOffset()
    });

    if (response) {
      stopGPS();

      const finished = response.sessions.find(
        (s) => s.id === session.id
      );

      openResult(finished);
    } else if (button.isConnected) {
      button.disabled = false;
    }
  }

  if (action === "gps-start") startGPS();
  if (action === "gps-stop") stopGPS();
});

dialog.addEventListener("close", () => {
  game.dialog = "";
});

document.addEventListener("visibilitychange", () => {
  const session = activeSession();
  if (!session) return;

  let hidden = [...session.hidden];

  if (document.hidden) {
    hidden.push({ at: Date.now() });
  } else {
    hidden = hidden.map((item, index) =>
      index === hidden.length - 1 && !item.visibleAt
        ? { ...item, visibleAt: Date.now() }
        : item
    );
  }

  request({
    action: "patch",
    id: session.id,
    hidden
  }, { quiet: true });
});

/* ---------- 아이소메트릭 게임 렌더링 ---------- */

function project(x, y, z = 0) {
  return {
    x: 420 + (x - y) * .86,
    y: 205 + (x + y) * .43 - z
  };
}

function polygon(points, color) {
  ctx.beginPath();

  points.forEach(([x, y, z], index) => {
    const p = project(x, y, z);
    if (!index) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });

  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function box(x, y, z, width, depth, height, top, front, side) {
  polygon([
    [x, y + depth, z],
    [x + width, y + depth, z],
    [x + width, y + depth, z + height],
    [x, y + depth, z + height]
  ], front);

  polygon([
    [x + width, y, z],
    [x + width, y + depth, z],
    [x + width, y + depth, z + height],
    [x + width, y, z + height]
  ], side);

  polygon([
    [x, y, z + height],
    [x + width, y, z + height],
    [x + width, y + depth, z + height],
    [x, y + depth, z + height]
  ], top);
}

function ellipse(x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(x, y, width, height, radius, color) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function plant(x, y, scale = 1) {
  const p = project(x, y);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(scale, scale);

  ellipse(0, 4, 22, 8, "#67556c15");

  ctx.fillStyle = "#d9bda0";
  ctx.beginPath();
  ctx.moveTo(-15, -27);
  ctx.lineTo(15, -27);
  ctx.lineTo(10, 0);
  ctx.quadraticCurveTo(0, 8, -10, 0);
  ctx.closePath();
  ctx.fill();

  ellipse(0, -27, 15, 6, "#e7d0b5");

  ctx.strokeStyle = "#7c987b";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.lineTo(0, -75);
  ctx.stroke();

  ctx.save();
  ctx.translate(-9, -53);
  ctx.rotate(-.65);
  ellipse(0, 0, 11, 21, "#8eac8d");
  ctx.restore();

  ctx.save();
  ctx.translate(10, -69);
  ctx.rotate(.55);
  ellipse(0, 0, 10, 20, "#72967b");
  ctx.restore();

  ctx.save();
  ctx.translate(10, -43);
  ctx.rotate(.8);
  ellipse(0, 0, 9, 18, "#a8bb95");
  ctx.restore();

  ctx.restore();
}

function windowPanel(x, y) {
  polygon([
    [x, y, 55],
    [x + 105, y, 55],
    [x + 105, y, 150],
    [x, y, 150]
  ], "#f4ecdf");

  polygon([
    [x + 7, y + 1, 63],
    [x + 98, y + 1, 63],
    [x + 98, y + 1, 142],
    [x + 7, y + 1, 142]
  ], "#c0d5d4");

  polygon([
    [x + 7, y + 2, 63],
    [x + 98, y + 2, 63],
    [x + 98, y + 2, 103],
    [x + 7, y + 2, 116]
  ], "#d9e6dc");

  polygon([
    [x + 50, y + 3, 63],
    [x + 55, y + 3, 63],
    [x + 55, y + 3, 142],
    [x + 50, y + 3, 142]
  ], "#f8f1e5");

  polygon([
    [x + 7, y + 4, 101],
    [x + 98, y + 4, 101],
    [x + 98, y + 4, 106],
    [x + 7, y + 4, 106]
  ], "#f8f1e5");

  box(
    x - 4, y - 2, 53, 113, 15, 5,
    "#e5cfb5", "#cfb399", "#baa18d"
  );
}

function shelf(x, y) {
  box(
    x, y, 0, 110, 23, 105,
    "#d5c0a6", "#ad947d", "#9d8373"
  );

  const colors = [
    "#b8c8ad",
    "#cfaa9d",
    "#b9a9ca",
    "#d7c59a",
    "#a8bdc3"
  ];

  [14, 46, 78].forEach((z, row) => {
    polygon([
      [x + 5, y + 23.1, z],
      [x + 105, y + 23.1, z],
      [x + 105, y + 23.1, z + 25],
      [x + 5, y + 23.1, z + 25]
    ], "#8d776b");

    for (let index = 0; index < 10; index++) {
      const color = colors[index % colors.length];

      box(
        x + 8 + index * 9,
        y + 16,
        z + 1,
        6,
        9,
        15 + (index * 7 + row) % 10,
        color,
        color,
        "#98828f"
      );
    }

    box(
      x, y, z - 3, 110, 25, 4,
      "#e3d0b7", "#c7aa8c", "#a98d76"
    );
  });
}

function desk(x, y, book = false) {
  const p = project(x + 30, y + 24);
  ellipse(p.x, p.y + 5, 40, 13, "#64516b12");

  [
    [3, 3],
    [60, 3],
    [3, 43],
    [60, 43]
  ].forEach(([dx, dy]) => {
    box(
      x + dx, y + dy, 0, 5, 5, 44,
      "#d0b392", "#b99a80", "#aa8e7a"
    );
  });

  box(
    x, y, 43, 70, 53, 7,
    "#e4caab", "#c9aa8c", "#b99a82"
  );

  if (book) {
    box(
      x + 15, y + 15, 50, 35, 24, 2,
      "#faf2df", "#d9c7b5", "#d0bdad"
    );

    polygon([
      [x + 32, y + 15, 52.1],
      [x + 33, y + 15, 52.1],
      [x + 33, y + 39, 52.1],
      [x + 32, y + 39, 52.1]
    ], "#d5c5b8");
  } else {
    box(
      x + 15, y + 12, 50, 34, 22, 2,
      "#bdb3c6", "#a79baf", "#9c90a6"
    );

    box(
      x + 15, y + 10, 52, 34, 2, 24,
      "#cbbfd3", "#b6a7c5", "#9989aa"
    );
  }

  box(
    x + 58, y + 29, 50, 7, 7, 10,
    "#fbf2e6", "#e4d0bb", "#cfbaa8"
  );
}

function chair(x, y) {
  [
    [0, 0],
    [21, 0],
    [0, 22],
    [21, 22]
  ].forEach(([dx, dy]) => {
    box(
      x + dx, y + dy, 0, 4, 4, 20,
      "#bda58d", "#a58b77", "#9a806d"
    );
  });

  box(
    x - 2, y - 2, 19, 30, 32, 7,
    "#c3cbb5", "#a8b397", "#8fa080"
  );

  box(
    x - 2, y + 25, 23, 30, 5, 29,
    "#d0d5c1", "#acb69a", "#94a382"
  );
}

function lamp(x, y) {
  const p = project(x, y, 180);

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.strokeStyle = "#9c8b8c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -55);
  ctx.lineTo(0, 0);
  ctx.stroke();

  ctx.fillStyle = "#e3c9a3";
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(15, 0);
  ctx.lineTo(25, 20);
  ctx.quadraticCurveTo(0, 33, -25, 20);
  ctx.closePath();
  ctx.fill();

  ellipse(0, 20, 25, 8, "#f9e7bb");
  ellipse(0, 21, 17, 5, "#fff2ce");

  ctx.restore();
}

function avatar(person, self = false, now = 0) {
  const p = project(person.x, person.y);
  const bounce = self ? Math.sin(now / 700) * 1.3 : 0;

  ctx.save();
  ctx.translate(p.x, p.y);

  ellipse(0, 4, 25, 9, self ? "#ad93cd44" : "#69537118");

  ctx.translate(0, bounce);

  const kind = person.character;
  const rabbit = kind === "🐰" || kind === "🐇";
  const frog = kind === "🐸";
  const cat = kind === "🐱";

  const skin = frog
    ? "#aac396"
    : kind === "🐻"
      ? "#bd9479"
      : cat
        ? "#dfb791"
        : "#f1eadd";

  roundRect(-11, -7, 9, 13, 4, "#776b77");
  roundRect(3, -7, 9, 13, 4, "#776b77");

  roundRect(
    -16, -32, 32, 31, 13,
    self ? "#ac91c7" : "#9db4a6"
  );

  ellipse(-17, -20, 6, 10, skin);
  ellipse(17, -20, 6, 10, skin);

  if (rabbit) {
    ellipse(-9, -72, 6, 19, skin);
    ellipse(9, -72, 6, 19, skin);
    ellipse(-9, -73, 2.5, 12, "#dfb9bc");
    ellipse(9, -73, 2.5, 12, "#dfb9bc");
  } else if (cat) {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(-22, -48);
    ctx.lineTo(-18, -73);
    ctx.lineTo(-2, -61);
    ctx.lineTo(18, -73);
    ctx.lineTo(23, -48);
    ctx.closePath();
    ctx.fill();
  } else {
    ellipse(-17, -62, 9, 10, skin);
    ellipse(17, -62, 9, 10, skin);
  }

  ellipse(0, -49, 24, 23, skin);
  ellipse(0, -38, 10, 7, frog ? "#c2d3aa" : "#faf0e3");
  ellipse(-9, -50, 2, 3, "#514347");
  ellipse(9, -50, 2, 3, "#514347");
  ellipse(-17, -41, 4.5, 2.5, "#d7aaa5");
  ellipse(17, -41, 4.5, 2.5, "#d7aaa5");

  ctx.strokeStyle = "#917077";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3, -43);
  ctx.lineTo(0, -40);
  ctx.lineTo(3, -43);
  ctx.moveTo(-4, -37);
  ctx.quadraticCurveTo(0, -33, 4, -37);
  ctx.stroke();

  const name = `${person.name}${self ? " · 나" : ""}`;
  ctx.font = "10px system-ui";
  const width = Math.max(52, ctx.measureText(name).width + 20);

  roundRect(
    -width / 2, 14, width, 21, 10,
    self ? "#fffdfd" : "#ffffffdd"
  );

  ctx.fillStyle = "#80658f";
  ctx.textAlign = "center";
  ctx.fillText(name, 0, 28);

  if (person.mode) {
    ctx.font = "8px system-ui";
    const modeWidth = Math.max(
      44,
      ctx.measureText(person.mode).width + 16
    );

    roundRect(
      -modeWidth / 2, -108, modeWidth, 18, 9,
      "#ffffffee"
    );

    ctx.fillStyle = "#95809f";
    ctx.fillText(person.mode, 0, -96);
  }

  ctx.restore();
}

function drawRoom(now) {
  const garden = game.world === "garden";
  const bedroom = game.world === "bedroom";
  const library = game.world === "library";
  const applied = state.applied;
  const night = activeSession()?.mode === "sleep";

  ellipse(
    420, 540, 285, 38,
    night ? "#14132644" : "#aa93ba22"
  );

  box(
    0, 0, -24, 390, 390, 24,
    garden ? "#b8cba6" : "#ddc5af",
    garden ? "#9eb48b" : "#bfa28c",
    garden ? "#8da87d" : "#ad917f"
  );

  if (!garden) {
    const wall = night
      ? "#69617d"
      : bedroom && applied.includes("wall")
        ? "#cfdfcf"
        : library
          ? "#d9d3c7"
          : "#e0d5df";

    polygon([
      [0, 0, 0],
      [390, 0, 0],
      [390, 0, 178],
      [0, 0, 178]
    ], wall);

    polygon([
      [0, 0, 0],
      [0, 390, 0],
      [0, 390, 178],
      [0, 0, 178]
    ], night ? "#59526d" : "#c5bbcd");

    for (let i = 0; i < 13; i++) {
      polygon([
        [0, i * 30, .1],
        [390, i * 30, .1],
        [390, i * 30 + 29, .1],
        [0, i * 30 + 29, .1]
      ], i % 2 ? "#e2cab3" : "#e8d2be");
    }

    windowPanel(55, 1);
    windowPanel(225, 1);
  }

  if (garden) {
    polygon([
      [135, 0, 1],
      [195, 0, 1],
      [195, 390, 1],
      [135, 390, 1]
    ], "#e7dcc2");

    polygon([
      [0, 190, 1],
      [390, 190, 1],
      [390, 235, 1],
      [0, 235, 1]
    ], "#e7dcc2");

    plant(40, 35, 1.9);
    plant(345, 35, 1.8);
    plant(35, 325, 1.6);
    plant(340, 335, 1.6);

    box(
      245, 75, 25, 100, 30, 8,
      "#dfc5a3", "#c6a98c", "#ae927c"
    );

    box(
      250, 101, 31, 90, 5, 28,
      "#dfc5a3", "#bc9e80", "#a98e75"
    );

    box(
      253, 80, 0, 7, 20, 25,
      "#c5af94", "#aa937d", "#99816f"
    );

    box(
      330, 80, 0, 7, 20, 25,
      "#c5af94", "#aa937d", "#99816f"
    );

    [
      [85, 100],
      [280, 275],
      [70, 280]
    ].forEach(([x, y], i) => {
      const p = project(x, y, 2);
      ellipse(p.x, p.y, 25, 10, "#a7be96");

      for (let j = 0; j < 4; j++) {
        const fx = p.x - 15 + j * 10;
        const fy = p.y - 5 - (j % 2) * 6;

        ellipse(
          fx, fy, 5, 5,
          i % 2 ? "#e5c5d5" : "#f3e6bb"
        );

        ellipse(fx, fy, 2, 2, "#d5b36b");
      }
    });
  } else if (bedroom) {
    polygon([
      [65, 155, 1],
      [300, 155, 1],
      [300, 345, 1],
      [65, 345, 1]
    ], "#c4afd4");

    polygon([
      [75, 165, 1.1],
      [290, 165, 1.1],
      [290, 335, 1.1],
      [75, 335, 1.1]
    ], "#d0bfe0");

    box(
      20, 125, 0, 125, 190, 25,
      "#c8ad91", "#b79a83", "#a78a78"
    );

    box(
      18, 122, 25, 129, 192, 20,
      "#f4e9de", "#dac7bf", "#ccb7af"
    );

    box(
      18, 122, 45, 129, 48, 12,
      "#f5edf0", "#dccedb", "#cbbccd"
    );

    box(
      18, 173, 45, 129, 140, 8,
      applied.includes("bed") ? "#9d85c6" : "#cab6d7",
      "#b299c4",
      "#a98fbd"
    );

    box(
      15, 111, 20, 135, 9, 66,
      "#d7c2ad", "#bda188", "#af947d"
    );

    if (applied.includes("desk")) {
      desk(245, 75);
    } else {
      shelf(225, 20);
    }

    plant(
      350, 45,
      applied.includes("plant") ? 1.7 : 1
    );

    box(
      170, 130, 0, 40, 35, 45,
      "#e3c8a7", "#c6a588", "#b7987e"
    );

    if (applied.includes("lamp")) lamp(185, 145);

    plant(35, 355, .8);
  } else {
    shelf(15, 25);
    shelf(15, 160);

    polygon([
      [120, 85, 1],
      [350, 85, 1],
      [350, 325, 1],
      [120, 325, 1]
    ], "#c8ccb7");

    [
      [135, 110],
      [260, 110],
      [135, 245],
      [260, 245]
    ].forEach(([x, y], index) => {
      chair(x + 20, y + 65);
      desk(x, y, library || index === 2);
    });

    box(
      305, 30, 0, 55, 60, 50,
      "#d5b997", "#b69a81", "#a88e79"
    );

    box(
      302, 27, 50, 61, 66, 6,
      "#e8d2b7", "#d1b292", "#bda185"
    );

    box(
      317, 38, 56, 31, 20, 27,
      "#a9aca4", "#90958f", "#7c837d"
    );

    plant(365, 28, 1.2);
    plant(25, 335);
    plant(360, 350, .9);

    lamp(190, 145);
    lamp(310, 275);
  }

  const session = activeSession();

  const people = [{
    id: "self",
    name: state.user.nickname,
    character: applied.includes("skin")
      ? "🐇"
      : state.user.character,
    x: game.player.x,
    y: game.player.y,
    mode: session ? `${MODE_NAMES[session.mode]} 중` : "나의 자리",
    self: true
  }];

  if (state.room) {
    state.room.members
      .filter((member) =>
        !member.me
        && member.online
        && member.world === game.world
      )
      .forEach((member) => people.push({
        ...member,
        self: false
      }));
  }

  people.sort((a, b) => a.x + a.y - b.x - b.y);

  for (const person of people) {
    avatar(person, person.self, now);
  }

  if (night) {
    ctx.fillStyle = "#1d21351a";
    ctx.fillRect(0, 0, 840, 600);
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  canvasWidth = rect.width;
  canvasHeight = rect.height;

  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
}

function render(now) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  game.player.x += (game.target.x - game.player.x) * .12;
  game.player.y += (game.target.y - game.player.y) * .12;

  viewScale = Math.min(
    canvasWidth / 840,
    canvasHeight / 600
  ) * game.zoom;

  viewOffsetX = (canvasWidth - 840 * viewScale) / 2;
  viewOffsetY = (canvasHeight - 600 * viewScale) / 2;

  ctx.save();
  ctx.translate(viewOffsetX, viewOffsetY);
  ctx.scale(viewScale, viewScale);

  drawRoom(now);

  ctx.restore();
  requestAnimationFrame(render);
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();

  const x = (
    event.clientX - rect.left - viewOffsetX
  ) / viewScale;

  const y = (
    event.clientY - rect.top - viewOffsetY
  ) / viewScale;

  const a = (x - 420) / .86;
  const b = (y - 205) / .43;

  let worldX = (a + b) / 2;
  let worldY = (b - a) / 2;

  if (game.world === "cafe" || game.world === "library") {
    const seats = [
      { x: 171, y: 208 },
      { x: 296, y: 208 },
      { x: 171, y: 343 },
      { x: 296, y: 343 }
    ];

    const nearest = seats.find(
      (seat) => Math.hypot(
        seat.x - worldX,
        seat.y - worldY
      ) < 30
    );

    if (nearest) {
      worldX = nearest.x;
      worldY = nearest.y;
      toast("집중할 자리를 골랐어요.");
    }
  }

  game.target = {
    x: clamp(worldX, 35, 365),
    y: clamp(worldY, 35, 365)
  };

  canvas.focus({ preventScroll: true });
});

canvas.addEventListener("keydown", (event) => {
  const moves = {
    ArrowUp: [-12, -12],
    ArrowDown: [12, 12],
    ArrowLeft: [-12, 12],
    ArrowRight: [12, -12],
    w: [-12, -12],
    s: [12, 12],
    a: [-12, 12],
    d: [12, -12]
  };

  const move = moves[event.key];
  if (!move) return;

  event.preventDefault();

  game.target.x = clamp(game.target.x + move[0], 35, 365);
  game.target.y = clamp(game.target.y + move[1], 35, 365);
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", stopGPS);

resizeCanvas();
refreshHUD();
requestAnimationFrame(render);

sync();
setInterval(sync, 2500);
setInterval(refreshHUD, 1000);
