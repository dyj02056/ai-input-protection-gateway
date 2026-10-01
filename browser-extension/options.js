// 설정 저장: chrome.storage.local만 사용. 서버 전송 없음.
const DEFAULTS = { enabled: { government_id: true, phone_number: true, email: true, api_key: true }, maskStyle: "placeholder" };

async function load() {
  const data = await chrome.storage.local.get(DEFAULTS);
  for (const [k, v] of Object.entries(data.enabled)) {
    const el = document.getElementById("c-" + k);
    if (el) el.checked = !!v;
  }
}

async function save() {
  const enabled = {};
  for (const k of Object.keys(DEFAULTS.enabled)) {
    const el = document.getElementById("c-" + k);
    enabled[k] = el ? el.checked : true;
  }
  await chrome.storage.local.set({ enabled });
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.querySelectorAll('input[type="checkbox"]').forEach((el) => el.addEventListener("change", save));
  document.getElementById("clear").addEventListener("click", async () => {
    await chrome.storage.local.remove(["history", "lastAction"]);
    alert("로컬 기록을 삭제했습니다.");
  });
});
