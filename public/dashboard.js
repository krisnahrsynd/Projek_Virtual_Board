const joinForm = document.getElementById("joinForm");

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const username = document.getElementById("username").value.trim();
  const roomId = document.getElementById("roomId").value.trim();
  const role = document.getElementById("role").value;

  if (!username || !roomId || !role) {
    alert("Semua data wajib diisi.");
    return;
  }

  const url = `/board.html?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`;

  window.location.href = url;
});