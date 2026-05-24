import type { MessageRole, SelectionSnapshot } from "../types";
import { buildTextIndex, createAnchor } from "./anchor";

const MESSAGE_SELECTOR = "[data-message-author-role]";
const MARK_SELECTOR = ".gptplugins-highlight-mark";

export function getElementText(element: HTMLElement): string {
  return (element.innerText || element.textContent || "").trim();
}

export function getElementRawText(element: HTMLElement): string {
  return buildTextIndex(element).text;
}

export function getConversationId(): string {
  const match = window.location.pathname.match(/\/c\/([^/?#]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return `page:${window.location.pathname}`;
}

export function getConversationTitle(): string | null {
  const title = document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  return title || null;
}

export function getMessageElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)).filter((element) => {
    return Boolean(getElementText(element));
  });
}

export function getMessageRole(element: HTMLElement): MessageRole {
  const role = element.getAttribute("data-message-author-role");
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return "unknown";
}

export function findMessageElementFromNode(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>(MESSAGE_SELECTOR) || null;
}

function getTextAround(messageText: string, selectedText: string, textStart: number | null): { prefix: string; suffix: string } {
  const normalizedSelected = selectedText.trim();
  const index = textStart ?? messageText.indexOf(normalizedSelected);
  if (index < 0) {
    return { prefix: "", suffix: "" };
  }
  return {
    prefix: messageText.slice(Math.max(0, index - 160), index),
    suffix: messageText.slice(index + normalizedSelected.length, index + normalizedSelected.length + 160)
  };
}

function getSelectionOffsets(message: HTMLElement, range: Range): { textStart: number; textEnd: number } | null {
  if (!message.contains(range.startContainer) || !message.contains(range.endContainer)) {
    return null;
  }

  const selected = range.toString();
  const leadingWhitespace = selected.length - selected.trimStart().length;
  const trailingWhitespace = selected.length - selected.trimEnd().length;

  const before = document.createRange();
  before.selectNodeContents(message);
  before.setEnd(range.startContainer, range.startOffset);

  const rawStart = before.toString().length;
  const rawEnd = rawStart + selected.length;
  return {
    textStart: rawStart + leadingWhitespace,
    textEnd: rawEnd - trailingWhitespace
  };
}

function getHighlightIdFromNode(node: Node): string | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>(MARK_SELECTOR)?.dataset.highlightId || null;
}

function getOverlappingHighlightId(range: Range): string | null {
  const boundaryHighlightId = getHighlightIdFromNode(range.startContainer) || getHighlightIdFromNode(range.endContainer);
  if (boundaryHighlightId) {
    return boundaryHighlightId;
  }

  const marks = Array.from(document.querySelectorAll<HTMLElement>(MARK_SELECTOR));
  for (const mark of marks) {
    if (mark.dataset.highlightId && range.intersectsNode(mark)) {
      return mark.dataset.highlightId;
    }
  }
  return null;
}

export function readSelectionSnapshot(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const message = findMessageElementFromNode(range.commonAncestorContainer);
  if (!message) {
    return null;
  }

  const messages = getMessageElements();
  const messageIndex = messages.indexOf(message);
  if (messageIndex < 0) {
    return null;
  }

  const messageText = getElementRawText(message);
  const anchor = createAnchor(message, range);
  const offsets =
    anchor && anchor.start !== null && anchor.end !== null
      ? { textStart: anchor.start, textEnd: anchor.end }
      : getSelectionOffsets(message, range);
  const { prefix, suffix } = getTextAround(messageText, selectedText, offsets?.textStart ?? null);
  const rect = "getBoundingClientRect" in range ? range.getBoundingClientRect() : new DOMRect();

  return {
    conversation_id: getConversationId(),
    conversation_title: getConversationTitle(),
    selected_text: selectedText,
    prefix,
    suffix,
    text_start: offsets?.textStart ?? null,
    text_end: offsets?.textEnd ?? null,
    anchor,
    message_index: messageIndex,
    message_role: getMessageRole(message),
    note: "",
    color: "yellow",
    message_text: messageText,
    previous_message_text: messages[messageIndex - 1] ? getElementText(messages[messageIndex - 1]) : "",
    next_message_text: messages[messageIndex + 1] ? getElementText(messages[messageIndex + 1]) : "",
    overlapping_highlight_id: getOverlappingHighlightId(range),
    rect
  };
}
