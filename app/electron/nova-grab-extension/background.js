// NOVA GRAB — Background Service Worker
// Receives download requests from content script and relays via console
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NOVA_GRAB_DOWNLOAD') {
    sendResponse({ ok: true });
  }
});
