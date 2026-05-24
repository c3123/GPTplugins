import { describe, expect, it } from "vitest";

import type { Highlight } from "../types";
import { renderHighlights } from "./highlightDom";

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "h1",
    conversation_id: "c1",
    conversation_title: null,
    selected_text: "selected text",
    prefix: "prefix ",
    suffix: " suffix",
    text_start: 7,
    text_end: 20,
    anchor: null,
    message_index: 0,
    message_role: "assistant",
    note: "",
    color: "yellow",
    created_at: new Date().toISOString(),
    ...overrides
  };
}

describe("renderHighlights", () => {
  it("wraps the exact selected text", () => {
    document.body.innerHTML = `<div data-message-author-role="assistant">prefix selected text suffix</div>`;
    expect(renderHighlights([highlight()])).toBe(1);
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("selected text");
    expect(mark?.getAttribute("data-highlight-id")).toBe("h1");
  });

  it("does not wrap newline-only slices", () => {
    document.body.innerHTML = `<div data-message-author-role="assistant">one\nselected text\ntwo</div>`;
    expect(renderHighlights([highlight({ selected_text: "\nselected text\n", prefix: "one", suffix: "two", text_start: 3, text_end: 18 })])).toBe(1);
    expect(Array.from(document.querySelectorAll("mark")).map((node) => node.textContent)).toEqual(["selected text"]);
  });
});
