import { describe, expect, it } from "vitest";

import { getConversationId, readSelectionSnapshot } from "./dom";

describe("dom helpers", () => {
  it("reads the conversation id from ChatGPT URLs", () => {
    window.history.pushState({}, "", "/c/test-conversation-id");
    expect(getConversationId()).toBe("test-conversation-id");
  });

  it("extracts selected text with message metadata", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user">hello</div>
        <div data-message-author-role="assistant">prefix selected text suffix</div>
      </main>
    `;
    const textNode = document.querySelectorAll("[data-message-author-role]")[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 7);
    range.setEnd(textNode, 20);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const snapshot = readSelectionSnapshot();
    expect(snapshot?.selected_text).toBe("selected text");
    expect(snapshot?.message_index).toBe(1);
    expect(snapshot?.message_role).toBe("assistant");
    expect(snapshot?.previous_message_text).toBe("hello");
  });

  it("detects selections inside an existing highlight", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant">
          before <mark class="gptplugins-highlight-mark" data-highlight-id="h1">selected text</mark> after
        </div>
      </main>
    `;
    const textNode = document.querySelector("mark")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.setEnd(textNode, 8);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const snapshot = readSelectionSnapshot();
    expect(snapshot?.selected_text).toBe("lected");
    expect(snapshot?.overlapping_highlight_id).toBe("h1");
  });

  it("detects selections that partially cross an existing highlight", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant">
          before <mark class="gptplugins-highlight-mark" data-highlight-id="h1">selected text</mark> after
        </div>
      </main>
    `;
    const message = document.querySelector("[data-message-author-role]") as HTMLElement;
    const beforeNode = message.firstChild as Text;
    const markTextNode = document.querySelector("mark")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(beforeNode, Math.max(0, (beforeNode.textContent || "").length - 3));
    range.setEnd(markTextNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const snapshot = readSelectionSnapshot();
    expect(snapshot?.overlapping_highlight_id).toBe("h1");
  });
});
