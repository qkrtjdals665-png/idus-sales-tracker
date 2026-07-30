const trackedElement = document.querySelector("#tracked");
const checkedElement = document.querySelector("#checked");
const lastCheckedElement = document.querySelector("#lastChecked");
const refreshButton = document.querySelector("#refresh");
const messageElement = document.querySelector("#message");
const cloudUrlElement = document.querySelector("#cloudUrl");
const saveCloudButton = document.querySelector("#saveCloud");
const cloudStatusElement = document.querySelector("#cloudStatus");

async function loadSummary() {
  const response = await chrome.runtime.sendMessage({
    type: "IDUS_GET_SUMMARY"
  });
  if (!response?.ok) return;

  trackedElement.textContent = response.tracked.toLocaleString("ko-KR");
  checkedElement.textContent = response.checked.toLocaleString("ko-KR");
  lastCheckedElement.textContent = response.lastChecked
    ? `마지막 확인: ${new Date(response.lastChecked).toLocaleString("ko-KR")}`
    : "마지막 확인: 아직 없음";
  cloudUrlElement.value = response.cloudUrl || "";
  cloudStatusElement.textContent = response.cloudConnected
    ? `서버 연결됨 · ${response.cloudUpdatedAt
        ? new Date(response.cloudUpdatedAt).toLocaleString("ko-KR")
        : "데이터 확인 완료"}`
    : response.cloudUrl
      ? "서버 주소 확인 필요"
      : "서버 미연결";
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  messageElement.textContent = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.idus.com/v2/search")) {
    messageElement.textContent = "아이디어스 검색 결과 페이지에서 눌러주세요.";
    refreshButton.disabled = false;
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "IDUS_FORCE_REFRESH" });
    messageElement.textContent = "새 판매량을 확인하고 있습니다.";
    setTimeout(loadSummary, 1800);
  } catch {
    messageElement.textContent = "페이지를 새로고침한 뒤 다시 눌러주세요.";
  } finally {
    refreshButton.disabled = false;
  }
});

saveCloudButton.addEventListener("click", async () => {
  saveCloudButton.disabled = true;
  cloudStatusElement.textContent = "연결 확인 중...";
  const response = await chrome.runtime.sendMessage({
    type: "IDUS_SET_CLOUD_URL",
    url: cloudUrlElement.value.trim()
  });
  cloudStatusElement.textContent = response?.connected
    ? cloudUrlElement.value.trim()
      ? "서버 연결 완료"
      : "서버 연결 해제"
    : "주소에서 데이터를 읽지 못했습니다";
  saveCloudButton.disabled = false;
});

loadSummary();
