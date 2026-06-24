const loginCard = document.getElementById("loginCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginForm = document.getElementById("loginForm");
const adminPinInput = document.getElementById("adminPin");

const refreshBtn = document.getElementById("refreshBtn");
const saveBtn = document.getElementById("saveBtn");
const logoutBtn = document.getElementById("logoutBtn");
const iotRefreshBtn = document.getElementById("iotRefreshBtn");

const totalRooms = document.getElementById("totalRooms");
const totalStrokes = document.getElementById("totalStrokes");
const totalUsers = document.getElementById("totalUsers");
const iotOnline = document.getElementById("iotOnline");

const noticeBox = document.getElementById("noticeBox");
const roomList = document.getElementById("roomList");
const iotDeviceList = document.getElementById("iotDeviceList");

let adminPin = localStorage.getItem("virtualBoardAdminPin") || "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function formatAge(ageMs) {
  if (ageMs === null || ageMs === undefined) return "-";

  const seconds = Math.round(ageMs / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);

  return `${hours}h ago`;
}

function getState(device) {
  return device && typeof device.state === "object" && device.state
    ? device.state
    : {};
}

function boolText(value) {
  return value ? "ON" : "OFF";
}

function modeText(modeManual) {
  return Number(modeManual) === 1 ? "MANUAL" : "AUTO";
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
          <h3>${escapeHtml(room.roomId)}</h3>
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
        <div><span>Material</span><strong>${room.materialCount || 0}</strong></div>
        <div><span>IoT</span><strong>${room.iotDevices || 0}</strong></div>
        <div><span>Text</span><strong>${room.textCount || 0}</strong></div>
        <div><span>Image</span><strong>${room.imageCount || 0}</strong></div>
      </div>

      <div class="room-actions">
        <button data-action="open" data-room="${escapeHtml(room.roomId)}">Open</button>
        <button data-action="lock" data-room="${escapeHtml(room.roomId)}" data-value="${!room.locked}">
          ${room.locked ? "Unlock" : "Lock"}
        </button>
        <button data-action="split" data-room="${escapeHtml(room.roomId)}" data-value="${!room.splitMode}">
          ${room.splitMode ? "Unsplit" : "Split"}
        </button>
        <button data-action="clear" data-room="${escapeHtml(room.roomId)}" class="warning">Clear</button>
        <button data-action="delete" data-room="${escapeHtml(room.roomId)}" class="danger">Delete</button>
      </div>
    `;

    roomList.appendChild(card);
  });
}

function renderIotDevices(devices) {
  iotDeviceList.innerHTML = "";

  if (!devices.length) {
    iotDeviceList.innerHTML = `
      <div class="empty-room">
        Belum ada device ESP32-S3 yang terhubung.
      </div>
    `;
    return;
  }

  devices.forEach((device) => {
    const state = getState(device);

    const suhu = state.suhu ?? "-";
    const hum = state.hum ?? "-";
    const gerak = Number(state.gerak || 0) === 1 ? "Ada" : "Tidak";
    const cahaya = state.cahaya ?? "-";
    const suara = state.suara ?? "-";
    const aksiLabel = state.aksiLabel || "STANDBY";
    const brand = state.brand || "-";
    const modeManual = modeText(state.modeManual);
    const targetTemp = state.targetTemp || "-";
    const lampu = boolText(Boolean(state.lampu));
    const forceOff = Boolean(state.remoteForceAcOff) ? "YA" : "TIDAK";
    const lastMode = state.lastMode || "-";

    const card = document.createElement("article");
    card.className = "iot-card";

    card.innerHTML = `
      <div class="iot-card-header">
        <div>
          <h3>${escapeHtml(device.name || device.deviceId)}</h3>
          <p>ID: ${escapeHtml(device.deviceId)}</p>
          <p>Room: ${escapeHtml(device.roomId || "-")}</p>
          <p>IP: ${escapeHtml(device.ip || "-")} | Firmware: ${escapeHtml(device.firmware || "-")}</p>
          <p>Last seen: ${formatAge(device.ageMs)}</p>
        </div>

        <div class="room-badges">
          ${
            device.online
              ? `<span class="badge blue">Online</span>`
              : `<span class="badge danger">Offline</span>`
          }
        </div>
      </div>

      <div class="iot-sensor-grid">
        <div class="iot-sensor-card">
          <span>Suhu</span>
          <strong>${escapeHtml(suhu)}°C</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Kelembapan</span>
          <strong>${escapeHtml(hum)}%</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Gerak PIR</span>
          <strong>${escapeHtml(gerak)}</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Cahaya</span>
          <strong>${escapeHtml(cahaya)}</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Suara</span>
          <strong>${escapeHtml(suara)}</strong>
        </div>

        <div class="iot-sensor-card">
          <span>RSSI</span>
          <strong>${escapeHtml(device.rssi || 0)}</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Free Heap</span>
          <strong>${escapeHtml(device.freeHeap || 0)}</strong>
        </div>

        <div class="iot-sensor-card">
          <span>Uptime</span>
          <strong>${Math.round((device.uptimeMs || 0) / 1000)}s</strong>
        </div>
      </div>

      <div class="iot-status-panel">
        <div>
          <span>Brand AC</span>
          <strong>${escapeHtml(brand)}</strong>
        </div>

        <div>
          <span>Mode</span>
          <strong>${escapeHtml(modeManual)}</strong>
        </div>

        <div>
          <span>Target</span>
          <strong>${escapeHtml(targetTemp)}°C</strong>
        </div>

        <div>
          <span>Aksi Aktif</span>
          <strong>${escapeHtml(aksiLabel)}</strong>
        </div>

        <div>
          <span>Lampu</span>
          <strong>${escapeHtml(lampu)}</strong>
        </div>

        <div>
          <span>Force AC Off</span>
          <strong>${escapeHtml(forceOff)}</strong>
        </div>

        <div>
          <span>Last Mode</span>
          <strong>${escapeHtml(lastMode)}</strong>
        </div>
      </div>

      <div class="iot-command-panel">
        <div class="iot-command-group">
          <strong>Lampu</strong>
          <div>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="lampu_on">Lampu ON</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="lampu_off">Lampu OFF</button>
          </div>
        </div>

        <div class="iot-command-group">
          <strong>Mode Sistem</strong>
          <div>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="auto_on">AUTO</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="manual_on">MANUAL</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="status">Status</button>
          </div>
        </div>

        <div class="iot-command-group">
          <strong>Kontrol AC</strong>
          <div>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_cool_20">COOL 20</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_cool_22">COOL 22</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_cool_24">COOL 24</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_dry">DRY</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_dry_fan">DRY + FAN</button>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="ac_off" class="danger">AC OFF</button>
          </div>
        </div>

        <div class="iot-command-group">
          <strong>Set Target Suhu</strong>
          <div class="iot-temp-control">
            <input
              type="number"
              min="16"
              max="30"
              value="${Number(targetTemp) || 24}"
              data-iot-temp-input="${escapeHtml(device.deviceId)}"
            />
            <button data-iot-action="set-temp" data-device="${escapeHtml(device.deviceId)}">Set Temp</button>
          </div>
        </div>

        <div class="iot-command-group">
          <strong>Device</strong>
          <div>
            <button data-iot-action="control" data-device="${escapeHtml(device.deviceId)}" data-command="restart" class="warning">Restart ESP32-S3</button>
          </div>
        </div>
      </div>

      <div class="iot-bind-panel">
        <input
          data-iot-room-input="${escapeHtml(device.deviceId)}"
          placeholder="Room ID"
          value="${escapeHtml(device.roomId || "")}"
        />

        <input
          data-iot-name-input="${escapeHtml(device.deviceId)}"
          placeholder="Device name"
          value="${escapeHtml(device.name || "")}"
        />

        <button data-iot-action="bind" data-device="${escapeHtml(device.deviceId)}">Bind</button>
        <button data-iot-action="delete" data-device="${escapeHtml(device.deviceId)}" class="danger">Delete</button>
      </div>

      ${
        device.lastCommandResult
          ? `
            <div class="iot-last-ack">
              <strong>Last ACK:</strong>
              ${escapeHtml(device.lastCommandResult.command || "-")}
              —
              ${device.lastCommandResult.ok ? "OK" : "FAILED"}
              —
              ${escapeHtml(device.lastCommandResult.message || "")}
            </div>
          `
          : ""
      }
    `;

    iotDeviceList.appendChild(card);
  });
}

async function loadDashboard() {
  try {
    const [roomsData, storageData, iotData] = await Promise.all([
      api("/api/admin/rooms"),
      api("/api/admin/storage"),
      api("/api/admin/iot/devices")
    ]);

    const rooms = roomsData.rooms || [];
    const devices = iotData.devices || [];

    const strokeTotal = rooms.reduce((sum, room) => sum + room.strokes, 0);
    const userTotal = rooms.reduce((sum, room) => sum + room.activeUsers, 0);
    const onlineTotal = devices.filter((device) => device.online).length;

    totalRooms.textContent = rooms.length;
    totalStrokes.textContent = strokeTotal;
    totalUsers.textContent = userTotal;
    iotOnline.textContent = onlineTotal;

    showNotice(`Data directory: ${storageData.dataDir}`, "info");

    renderRooms(rooms);
    renderIotDevices(devices);
    showDashboard();
  } catch (error) {
    showNotice(error.message, "error");

    if (error.message.toLowerCase().includes("pin")) {
      localStorage.removeItem("virtualBoardAdminPin");
      showLogin();
    }
  }
}

async function loadIotOnly() {
  try {
    const iotData = await api("/api/admin/iot/devices");
    const devices = iotData.devices || [];

    iotOnline.textContent = devices.filter((device) => device.online).length;
    renderIotDevices(devices);
  } catch (error) {
    showNotice(error.message, "error");
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
iotRefreshBtn.addEventListener("click", loadIotOnly);

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

iotDeviceList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");

  if (!button) return;

  const action = button.dataset.iotAction;
  const deviceId = button.dataset.device;

  if (!action || !deviceId) return;

  try {
    if (action === "control") {
      const command = button.dataset.command;

      await api(`/api/admin/iot/${encodeURIComponent(deviceId)}/control`, {
        method: "POST",
        body: JSON.stringify({
          command,
          payload: {}
        })
      });

      showNotice(`Command "${command}" dikirim ke ${deviceId}. Tunggu heartbeat berikutnya.`, "success");
      await loadIotOnly();
      return;
    }

    if (action === "set-temp") {
      const tempInput = document.querySelector(`[data-iot-temp-input="${deviceId}"]`);
      const temp = Number(tempInput ? tempInput.value : 24);

      if (!Number.isFinite(temp) || temp < 16 || temp > 30) {
        alert("Target suhu harus 16 sampai 30.");
        return;
      }

      await api(`/api/admin/iot/${encodeURIComponent(deviceId)}/control`, {
        method: "POST",
        body: JSON.stringify({
          command: "set_temp",
          payload: { temp }
        })
      });

      showNotice(`Command set_temp ${temp}°C dikirim ke ${deviceId}.`, "success");
      await loadIotOnly();
      return;
    }

    if (action === "bind") {
      const roomInput = document.querySelector(`[data-iot-room-input="${deviceId}"]`);
      const nameInput = document.querySelector(`[data-iot-name-input="${deviceId}"]`);

      await api(`/api/admin/iot/${encodeURIComponent(deviceId)}/bind`, {
        method: "POST",
        body: JSON.stringify({
          roomId: roomInput ? roomInput.value.trim() : "",
          name: nameInput ? nameInput.value.trim() : ""
        })
      });

      showNotice(`Device ${deviceId} berhasil dibind.`, "success");
      await loadDashboard();
      return;
    }

    if (action === "delete") {
      const confirmed = confirm(`Hapus device "${deviceId}" dari dashboard?`);
      if (!confirmed) return;

      await api(`/api/admin/iot/${encodeURIComponent(deviceId)}`, {
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

setInterval(() => {
  if (adminPin && !dashboardCard.classList.contains("hidden")) {
    loadIotOnly();
  }
}, 5000);