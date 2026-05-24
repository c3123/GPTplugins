chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_ASK_WINDOW") {
    return false;
  }

  chrome.windows.create(
    {
      url: "https://chatgpt.com/",
      type: "popup",
      width: 450,
      height: 760,
      focused: true
    },
    () => sendResponse({ ok: true })
  );

  return true;
});
