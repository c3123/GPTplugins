import type { AppSettings, Highlight, HighlightDraft } from "./types";

interface StartAuthResponse {
  ok: boolean;
  dev_code?: string;
}

interface VerifyAuthResponse {
  access_token: string;
  token_type: string;
  email: string;
}

async function request<T>(settings: AppSettings, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (settings.token) {
    headers.set("Authorization", `Bearer ${settings.token}`);
  }

  const response = await fetch(`${settings.apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch {
      // Keep the HTTP status text.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function startEmailAuth(settings: AppSettings, email: string): Promise<StartAuthResponse> {
  return request<StartAuthResponse>(settings, "/auth/email/start", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function verifyEmailAuth(settings: AppSettings, email: string, code: string): Promise<VerifyAuthResponse> {
  return request<VerifyAuthResponse>(settings, "/auth/email/verify", {
    method: "POST",
    body: JSON.stringify({ email, code })
  });
}

export function listHighlights(settings: AppSettings, conversationId: string): Promise<Highlight[]> {
  return request<Highlight[]>(settings, `/conversations/${encodeURIComponent(conversationId)}/highlights`);
}

export function createHighlight(settings: AppSettings, draft: HighlightDraft): Promise<Highlight> {
  return request<Highlight>(settings, "/highlights", {
    method: "POST",
    body: JSON.stringify(draft)
  });
}

export function updateHighlight(settings: AppSettings, id: string, patch: Partial<HighlightDraft>): Promise<Highlight> {
  return request<Highlight>(settings, `/highlights/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteHighlight(settings: AppSettings, id: string): Promise<void> {
  return request<void>(settings, `/highlights/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
