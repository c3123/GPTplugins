import type { Highlight } from "../types";
import { buildTextIndex, restoreAnchor } from "./anchor";
import { getMessageElements } from "./dom";

const MARK_CLASS = "gptplugins-highlight-mark";
const ACTIVE_CLASS = "gptplugins-highlight-active";

export function clearRenderedHighlights(): void {
  document.querySelectorAll<HTMLElement>(`.${MARK_CLASS}`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
  });
  document.body.normalize();
}

function findStartOffset(text: string, highlight: Highlight): number {
  if (
    typeof highlight.text_start === "number" &&
    typeof highlight.text_end === "number" &&
    highlight.text_start >= 0 &&
    highlight.text_end > highlight.text_start &&
    text.slice(highlight.text_start, highlight.text_end) === highlight.selected_text
  ) {
    return highlight.text_start;
  }

  const direct = text.indexOf(highlight.selected_text);
  if (!highlight.prefix && !highlight.suffix) {
    return direct;
  }

  const candidates: number[] = [];
  let index = direct;
  while (index >= 0) {
    candidates.push(index);
    index = text.indexOf(highlight.selected_text, index + Math.max(1, highlight.selected_text.length));
  }

  return (
    candidates.find((candidate) => {
      const before = text.slice(Math.max(0, candidate - highlight.prefix.length), candidate);
      const after = text.slice(candidate + highlight.selected_text.length, candidate + highlight.selected_text.length + highlight.suffix.length);
      return (!highlight.prefix || before.endsWith(highlight.prefix)) && (!highlight.suffix || after.startsWith(highlight.suffix));
    }) ?? direct
  );
}

function legacyRangeFromHighlight(root: HTMLElement, highlight: Highlight): Range | null {
  const index = buildTextIndex(root);
  const start = findStartOffset(index.text, highlight);
  if (start < 0) {
    return null;
  }
  const end =
    typeof highlight.text_start === "number" &&
    typeof highlight.text_end === "number" &&
    start === highlight.text_start
      ? highlight.text_end
      : start + highlight.selected_text.length;
  return rangeFromOffsets(index, start, end);
}

export function renderHighlights(highlights: Highlight[]): number {
  let renderedCount = 0;
  window.dispatchEvent(new CustomEvent("gptplugins:render-start"));
  try {
    clearRenderedHighlights();
    const messages = getMessageElements();

    for (const highlight of highlights) {
      const range = findRangeForHighlight(messages, highlight);
      if (!range) {
        continue;
      }
      if (wrapRange(range, highlight)) {
        renderedCount += 1;
      }
    }
  } finally {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("gptplugins:render-end")), 0);
  }
  return renderedCount;
}

function findRangeForHighlight(messages: HTMLElement[], highlight: Highlight): Range | null {
  const preferred = messages[highlight.message_index] ? [messages[highlight.message_index]] : [];
  const sameRole = messages.filter(
    (message, index) => index !== highlight.message_index && message.getAttribute("data-message-author-role") === highlight.message_role
  );
  const remaining = messages.filter(
    (message, index) =>
      index !== highlight.message_index && message.getAttribute("data-message-author-role") !== highlight.message_role
  );

  for (const message of [...preferred, ...sameRole, ...remaining]) {
    const range = (highlight.anchor ? restoreAnchor(message, highlight.anchor) : null) || legacyRangeFromHighlight(message, highlight);
    if (range) {
      return range;
    }
  }
  return null;
}

function wrapRange(range: Range, highlight: Highlight): boolean {
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;
  const messageRoot = root?.closest<HTMLElement>("[data-message-author-role]");
  if (!messageRoot) {
    return false;
  }

  const index = buildTextIndex(messageRoot);
  const start = positionForPoint(index, range.startContainer, range.startOffset);
  const end = positionForPoint(index, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) {
    return false;
  }

  const nodes = index.segments.map((segment) => segment.node);
  let wrapped = false;
  for (const node of nodes) {
    const text = node.textContent || "";
    const segment = index.segments.find((item) => item.node === node);
    if (!segment) {
      continue;
    }
    const nodeStart = segment.start;
    const nodeEnd = segment.end;

    if (end <= nodeStart || start >= nodeEnd) {
      continue;
    }

    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(text.length, end - nodeStart);
    if (localStart >= localEnd) {
      continue;
    }
    const selectedSlice = text.slice(localStart, localEnd);
    if (!selectedSlice.trim()) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    const before = text.slice(0, localStart);
    const after = text.slice(localEnd);
    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }
    appendHighlightedSlice(fragment, selectedSlice, highlight);
    if (after) {
      fragment.appendChild(document.createTextNode(after));
    }
    node.replaceWith(fragment);
    wrapped = true;
  }
  return wrapped;
}

function appendHighlightedSlice(fragment: DocumentFragment, slice: string, highlight: Highlight): void {
  const parts = slice.split(/(\r?\n+)/);
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part.includes("\n") || !part.trim()) {
      fragment.appendChild(document.createTextNode(part));
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = `${MARK_CLASS} ${MARK_CLASS}--${highlight.color}`;
    mark.dataset.highlightId = highlight.id;
    mark.dataset.note = highlight.note || "";
    mark.textContent = part;
    fragment.appendChild(mark);
  }
}

function positionForPoint(index: ReturnType<typeof buildTextIndex>, container: Node, offset: number): number | null {
  if (container.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const segment = index.segments.find((item) => item.node === container);
  return segment ? segment.start + offset : null;
}

function rangeFromOffsets(index: ReturnType<typeof buildTextIndex>, start: number, end: number): Range | null {
  const startPoint = pointFromOffset(index, start);
  const endPoint = pointFromOffset(index, end);
  if (!startPoint || !endPoint) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function pointFromOffset(index: ReturnType<typeof buildTextIndex>, offset: number): { node: Text; offset: number } | null {
  for (const segment of index.segments) {
    if (offset >= segment.start && offset <= segment.end) {
      return {
        node: segment.node,
        offset: Math.min(segment.node.textContent?.length || 0, offset - segment.start)
      };
    }
  }
  return null;
}

export function scrollToHighlight(id: string): void {
  const mark = document.querySelector<HTMLElement>(`.${MARK_CLASS}[data-highlight-id="${CSS.escape(id)}"]`);
  if (!mark) {
    return;
  }
  mark.scrollIntoView({ block: "center", behavior: "smooth" });
  mark.classList.add(ACTIVE_CLASS);
  window.setTimeout(() => mark.classList.remove(ACTIVE_CLASS), 1600);
}
