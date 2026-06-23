const loginCard = document.getElementById("loginCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginForm = document.getElementById("loginForm");
const adminPinInput = document.getElementById("adminPin");

const refreshBtn = document.getElementById("refreshBtn");
const saveBtn = document.getElementById("saveBtn");
const logoutBtn = document.getElementById("logoutBtn");

const totalRooms = document.getElementById("totalRooms");
const totalStrokes = document.getElementById("totalStrokes");
const totalUsers = document.getElementById("totalUsers");
const storageStatus = document.getElementById("storageStatus");
const noticeBox = document.getElementById("noticeBox");
const roomList = document.getElementById("roomList");

let adminPin = localStorage.getItem("virtualBoardAdminPin") || "";

function showNotice(message, type = "info") {
  noticeBox.textContent = message;
  noticeBox.className = `notice-box ${type}`;
}

function showLogin() {
  loginCard.classList.remove("hidden");
  dashboardCard.classList.add("hidden");
}

function showDashboard() {
  loginCard.classList.add("hidden");
  dashboardCard.classList.remove("hidden");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-pin": adminPin,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request gagal.");
  }

  return data;
}

function formatDate(timestamp) {
  if (!timestamp) return "Belum ada aktivitas";

  return new Date(timestamp).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function renderRooms(rooms) {
  roomList.innerHTML = "";

  if (!rooms.length) {
    roomList.innerHTML = `
      <div class="empty-room">
        Belum ada room yang tersimpan.
      </div>
    `;
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card";

    card.innerHTML = `
      <div class="room-card-header">
        <div>
          <h3>${room.roomId}</h3>
          <p>Last activity: ${formatDate(room.lastActivity)}</p>
        </div>

        <div class="room-badges">
          ${room.locked ? `<span class="badge danger">Locked</span>` : `<span class="badge">Open</span>`}
          ${room.splitMode ? `<span class="badge blue">Split</span>` : `<span class="badge">Normal</span>`}
        </div>
      </div>

      <div class="room-metrics">
        <div><span>Users</span><strong>${room.activeUsers}</strong></div>
        <div><span>Guru</span><strong>${room.teachers}</strong></div>
        <div><span>Siswa</span><strong>${room.students}</strong></div>
        <div><span>Stroke</span><strong>${room.strokes}</strong></div>
        <div><span>Freehand</span><strong>${room.freehandCount}</strong></div>
        <div><span>Shape</span><strong>${room.shapeCount}</strong></div>
        <div><span>Text</span><strong>${room.textCount}</strong></div>
      </div>

      <div class="room-actions">
        <button data-action="open" data-room="${room.roomId}">Open</button>
        <button data-action="lock" data-room="${room.roomId}" data-value="${!room.locked}">
          ${room.locked ? "Unlock" : "Lock"}
        </button>
        <button data-action="split" data-room="${room.roomId}" data-value="${!room.splitMode}">
          ${room.splitMode ? "Unsplit" : "Split"}
        </button>
        <button data-action="clear" data-room="${room.roomId}" class="warning">Clear</button>
        <button data-action="delete" data-room="${room.roomId}" class="danger">Delete</button>
      </div>
    `;

    roomList.appendChild(card);
  });
}

async function loadDashboard() {
  try {
    const [roomsData, storageData] = await Promise.all([
      api("/api/admin/rooms"),
      api("/api/admin/storage")
    ]);

    const rooms = roomsData.rooms || [];

    const strokeTotal = rooms.reduce((sum, room) => sum + room.strokes, 0);
    const userTotal = rooms.reduce((sum, room) => sum + room.activeUsers, 0);

    totalRooms.textContent = rooms.length;
    totalStrokes.textContent = strokeTotal;
    totalUsers.textContent = userTotal;
    storageStatus.textContent = storageData.dataFileExists ? "OK" : "New";

    showNotice(`Data directory: ${storageData.dataDir}`, "info");
    renderRooms(rooms);
    showDashboard();
  } catch (error) {
    showNotice(error.message, "error");

    if (error.message.toLowerCase().includes("pin")) {
      localStorage.removeItem("virtualBoardAdminPin");
      showLogin();
    }
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  adminPin = adminPinInput.value.trim();

  if (!adminPin) return;

  localStorage.setItem("virtualBoardAdminPin", adminPin);

  await loadDashboard();
});

refreshBtn.addEventListener("click", loadDashboard);

saveBtn.addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/save", {
      method: "POST",
      body: JSON.stringify({})
    });

    showNotice(result.message || "Data berhasil disimpan.", "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

logoutBtn.addEventListener("click", () => {
  adminPin = "";
  localStorage.removeItem("virtualBoardAdminPin");
  showLogin();
});

roomList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const action = button.dataset.action;
  const roomId = button.dataset.room;

  try {
    if (action === "open") {
      const url = `/board.html?room=${encodeURIComponent(roomId)}&user=Admin&role=teacher`;
      window.open(url, "_blank");
      return;
    }

    if (action === "lock") {
      const locked = button.dataset.value === "true";

      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}/lock`, {
        method: "POST",
        body: JSON.stringify({ locked })
      });

      await loadDashboard();
      return;
    }

    if (action === "split") {
      const splitMode = button.dataset.value === "true";

      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}/split`, {
        method: "POST",
        body: JSON.stringify({ splitMode })
      });

      await loadDashboard();
      return;
    }

    if (action === "clear") {
      const confirmed = confirm(`Clear semua isi room "${roomId}"?`);
      if (!confirmed) return;

      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}/clear`, {
        method: "POST",
        body: JSON.stringify({})
      });

      await loadDashboard();
      return;
    }

    if (action === "delete") {
      const confirmed = confirm(`Hapus room "${roomId}" secara permanen?`);
      if (!confirmed) return;

      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}`, {
        method: "DELETE"
      });

      await loadDashboard();
      return;
    }
  } catch (error) {
    showNotice(error.message, "error");
  }
});

if (adminPin) {
  loadDashboard();
} else {
  showLogin();
}