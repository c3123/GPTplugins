import { createRoot } from "react-dom/client";
import { useState } from "react";

import { deleteHighlight } from "../apiClient";
import { getSettings } from "../storage";
import type { SelectionSnapshot } from "../types";
import { App } from "./App";
import { readSelectionSnapshot } from "./dom";
import styles from "./styles.css?inline";

const HOST_ID = "gptplugins-root";
const MARK_SELECTOR = ".gptplugins-highlight-mark";
const TOOLTIP_ID = "gptplugins-note-tooltip";
const PAGE_STYLE_ID = "gptplugins-highlight-style";

let hideTooltipTimer: number | null = null;

function injectPageHighlightStyles(): void {
  document.getElementById(PAGE_STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = PAGE_STYLE_ID;
  style.textContent = `
    .gptplugins-highlight-mark {
      background: #fff1a8;
      color: inherit;
      border-radius: 3px;
      padding: 0 1px;
      transition: background 160ms ease, box-shadow 160ms ease;
    }
    .gptplugins-highlight-mark--green { background: #c7f7d4; }
    .gptplugins-highlight-mark--blue { background: #c9e7ff; }
    .gptplugins-highlight-active {
      background: #ffcf33 !important;
      box-shadow: 0 0 0 3px rgba(255, 207, 51, 0.45);
    }
    #gptplugins-note-tooltip {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      width: 240px;
      height: 320px;
      overflow: hidden;
      padding: 10px 12px;
      border: 1px solid #cfd6df;
      border-radius: 8px;
      background: #ffffff;
      color: #1f2937;
      box-shadow: 0 16px 40px rgba(16, 24, 40, 0.18);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: normal;
    }
    .gptplugins-note-tooltip__note {
      height: 260px;
      overflow-y: auto;
      overflow-x: hidden;
      margin-bottom: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .gptplugins-note-tooltip__actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }
    .gptplugins-note-tooltip__button {
      border: 1px solid #d0d5dd;
      border-radius: 6px;
      background: #ffffff;
      color: #a11d1d;
      cursor: pointer;
      font: 13px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 5px 8px;
    }
    .gptplugins-note-tooltip__button:hover {
      background: #fff5f5;
    }
  `;
  document.documentElement.appendChild(style);
}

function getTooltip(): HTMLElement {
  const existing = document.getElementById(TOOLTIP_ID);
  if (existing) {
    return existing;
  }
  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.hidden = true;
  tooltip.addEventListener("mouseenter", () => {
    if (hideTooltipTimer) {
      window.clearTimeout(hideTooltipTimer);
      hideTooltipTimer = null;
    }
  });
  tooltip.addEventListener("mouseleave", scheduleHideTooltip);
  document.documentElement.appendChild(tooltip);
  return tooltip;
}

function scheduleHideTooltip(): void {
  if (hideTooltipTimer) {
    window.clearTimeout(hideTooltipTimer);
  }
  hideTooltipTimer = window.setTimeout(() => {
    getTooltip().hidden = true;
  }, 180);
}

function showNoteTooltip(mark: HTMLElement): void {
  const note = mark.dataset.note?.trim();
  const highlightId = mark.dataset.highlightId;
  if (!highlightId) {
    return;
  }
  if (hideTooltipTimer) {
    window.clearTimeout(hideTooltipTimer);
    hideTooltipTimer = null;
  }

  const tooltip = getTooltip();
  tooltip.replaceChildren();
  if (note) {
    const noteElement = document.createElement("div");
    noteElement.className = "gptplugins-note-tooltip__note";
    noteElement.textContent = note;
    tooltip.appendChild(noteElement);
  }
  const actions = document.createElement("div");
  actions.className = "gptplugins-note-tooltip__actions";
  const cancelButton = document.createElement("button");
  cancelButton.className = "gptplugins-note-tooltip__button";
  cancelButton.type = "button";
  cancelButton.textContent = "取消划线";
  cancelButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancelButton.disabled = true;
    cancelButton.textContent = "取消中...";
    try {
      const settings = await getSettings();
      if (settings.token) {
        await deleteHighlight(settings, highlightId);
      }
      document.querySelectorAll<HTMLElement>(`${MARK_SELECTOR}[data-highlight-id="${CSS.escape(highlightId)}"]`).forEach((item) => {
        item.replaceWith(document.createTextNode(item.textContent || ""));
      });
      document.body.normalize();
      window.dispatchEvent(new CustomEvent("gptplugins:highlight-deleted", { detail: { id: highlightId } }));
      tooltip.hidden = true;
    } catch (error) {
      cancelButton.disabled = false;
      cancelButton.textContent = error instanceof Error ? error.message : "取消失败";
    }
  });
  actions.appendChild(cancelButton);
  tooltip.appendChild(actions);
  tooltip.hidden = false;

  const rect = mark.getBoundingClientRect();
  const width = Math.min(240, Math.max(180, window.innerWidth - 32));
  const height = Math.round((width * 4) / 3);
  tooltip.style.width = `${width}px`;
  tooltip.style.height = `${height}px`;

  const below = rect.bottom + 8;
  const above = rect.top - height - 8;
  const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, above);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function installNoteTooltipHandlers(): void {
  document.addEventListener("mouseover", (event) => {
    const mark = (event.target as Element | null)?.closest<HTMLElement>(MARK_SELECTOR);
    if (mark) {
      showNoteTooltip(mark);
    }
  });
  document.addEventListener("mouseout", (event) => {
    const mark = (event.target as Element | null)?.closest<HTMLElement>(MARK_SELECTOR);
    if (mark) {
      scheduleHideTooltip();
    }
  });
}

function shouldIgnoreSelectionRefresh(event: Event, host: HTMLElement): boolean {
  const path = event.composedPath();
  if (path.includes(host)) {
    return true;
  }
  return path.some((item) => item instanceof HTMLElement && item.id === TOOLTIP_ID);
}

function mount() {
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(TOOLTIP_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const appRoot = document.createElement("div");
  shadow.appendChild(appRoot);

  let setSelectionSnapshot: ((snapshot: SelectionSnapshot | null) => void) | null = null;

  function Root() {
    const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
    setSelectionSnapshot = setSelection;
    return <App selection={selection} clearSelection={() => setSelection(null)} />;
  }

  createRoot(appRoot).render(<Root />);
  injectPageHighlightStyles();
  installNoteTooltipHandlers();

  document.addEventListener("mouseup", (event) => {
    if (shouldIgnoreSelectionRefresh(event, host)) {
      return;
    }
    window.setTimeout(() => {
      setSelectionSnapshot?.(readSelectionSnapshot());
    }, 0);
  });

  document.addEventListener("keyup", (event) => {
    if (shouldIgnoreSelectionRefresh(event, host)) {
      return;
    }
    setSelectionSnapshot?.(readSelectionSnapshot());
  });
}

mount();
