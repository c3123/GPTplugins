import type { AppSettings } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: "http://127.0.0.1:8000"
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(["apiBaseUrl", "token", "email"]);
  return {
    ...DEFAULT_SETTINGS,
    ...stored
  };
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const next = {
    ...(await getSettings()),
    ...partial
  };
  await chrome.storage.local.set(next);
  return next;
}
