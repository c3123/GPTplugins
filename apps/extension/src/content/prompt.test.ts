import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../types";
import { buildAskPrompt } from "./prompt";

function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    conversation_id: "c1",
    conversation_title: "Title",
    selected_text: "important phrase",
    prefix: "prefix",
    suffix: "suffix",
    text_start: 1,
    text_end: 17,
    anchor: null,
    message_index: 1,
    message_role: "assistant",
    note: "",
    color: "yellow",
    message_text: "The important phrase is in this answer.",
    previous_message_text: "What does this mean?",
    next_message_text: "",
    overlapping_highlight_id: null,
    rect: new DOMRect(),
    ...overrides
  };
}

describe("buildAskPrompt", () => {
  it("includes selected text and local context", () => {
    const prompt = buildAskPrompt(snapshot());
    expect(prompt).toContain("important phrase");
    expect(prompt).toContain("The important phrase is in this answer.");
    expect(prompt).toContain("What does this mean?");
    expect(prompt).toContain("assistant");
  });
});
