chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NOVA_GRAB_DOWNLOAD') {
    sendResponse({ ok: true });
  }
});
