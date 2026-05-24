export type MessageRole = "user" | "assistant" | "system" | "unknown";

export interface AnchorSelector {
  exact: string;
  prefix: string;
  suffix: string;
  start: number | null;
  end: number | null;
  start_path: number[] | null;
  start_offset: number | null;
  end_path: number[] | null;
  end_offset: number | null;
  text_hash: string | null;
}

export interface Highlight {
  id: string;
  conversation_id: string;
  conversation_title: string | null;
  selected_text: string;
  prefix: string;
  suffix: string;
  text_start: number | null;
  text_end: number | null;
  anchor: AnchorSelector | null;
  message_index: number;
  message_role: MessageRole;
  note: string;
  color: string;
  created_at: string;
}

export interface HighlightDraft {
  conversation_id: string;
  conversation_title: string | null;
  selected_text: string;
  prefix: string;
  suffix: string;
  text_start: number | null;
  text_end: number | null;
  anchor: AnchorSelector | null;
  message_index: number;
  message_role: MessageRole;
  note: string;
  color: string;
}

export interface SelectionSnapshot extends HighlightDraft {
  message_text: string;
  previous_message_text: string;
  next_message_text: string;
  overlapping_highlight_id: string | null;
  rect: DOMRect;
}

export interface AppSettings {
  apiBaseUrl: string;
  token?: string;
  email?: string;
}

export interface RuntimeOpenAskWindowMessage {
  type: "OPEN_ASK_WINDOW";
}
