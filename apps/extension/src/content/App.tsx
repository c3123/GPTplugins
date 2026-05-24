import { useCallback, useEffect, useState } from "react";

import { createHighlight, deleteHighlight, listHighlights, startEmailAuth, verifyEmailAuth } from "../apiClient";
import { getSettings, saveSettings } from "../storage";
import type { AppSettings, Highlight, SelectionSnapshot } from "../types";
import { getConversationId, getMessageElements } from "./dom";
import { renderHighlights, scrollToHighlight } from "./highlightDom";
import { buildAskPrompt } from "./prompt";

interface AppProps {
  selection: SelectionSnapshot | null;
  clearSelection: () => void;
}

interface RailMark {
  id: string;
  title: string;
  messageIndex: number;
  highlightId: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

interface NativeRailBar {
  top: number;
  left: number;
  width: number;
  height: number;
  isActive: boolean;
}

function isNativeRailCandidate(element: HTMLElement): boolean {
  if (element.closest("#gptplugins-root") || element.closest("#gptplugins-note-tooltip")) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 18 || rect.width > 70 || rect.height < 2 || rect.height > 8) {
    return false;
  }
  if (rect.right < window.innerWidth - 150 || rect.left > window.innerWidth - 8) {
    return false;
  }
  if (rect.top < 40 || rect.bottom > window.innerHeight - 20) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
    return false;
  }
  const color = style.backgroundColor || style.borderTopColor;
  return /rgb|hsl|#/.test(color);
}

function colorLuma(color: string): number {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return 255;
  }
  const [, red, green, blue] = match.map(Number);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function detectNativeRailBars(): NativeRailBar[] {
  const candidates = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
    .filter(isNativeRailCandidate)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const color = style.backgroundColor || style.borderTopColor;
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        isActive: colorLuma(color) < 80
      };
    })
    .sort((left, right) => left.top - right.top);

  const groups = new Map<number, NativeRailBar[]>();
  for (const candidate of candidates) {
    const key = Math.round((candidate.left + candidate.width / 2) / 12) * 12;
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }

  return (
    [...groups.values()]
      .filter((group) => group.length >= 4)
      .map((group) => {
        const sorted = group.sort((left, right) => left.top - right.top);
        const topSpan = sorted[sorted.length - 1].top - sorted[0].top;
        const averageGap =
          sorted.length > 1
            ? sorted.slice(1).reduce((sum, item, index) => sum + item.top - sorted[index].top, 0) / (sorted.length - 1)
            : 0;
        const activeBonus = sorted.some((item) => item.isActive) ? 80 : 0;
        const countScore = sorted.length * 12;
        const spanScore = Math.min(180, topSpan / 2);
        const gapPenalty = averageGap > 32 ? 60 : 0;
        const topPenalty = sorted[0].top < 90 ? 90 : 0;
        return {
          group: sorted,
          score: countScore + spanScore + activeBonus - gapPenalty - topPenalty
        };
      })
      .sort((left, right) => right.score - left.score)[0]?.group || []
  );
}

function fallbackRailBar(order: number): NativeRailBar {
  return {
    top: 120 + order * 10,
    left: window.innerWidth - 70,
    width: 30,
    height: 3,
    isActive: false
  };
}

function barForUserOrdinal(nativeBars: NativeRailBar[], userCount: number, ordinal: number): NativeRailBar {
  if (nativeBars.length === 0) {
    return fallbackRailBar(ordinal);
  }
  if (userCount <= 1) {
    return nativeBars[0];
  }
  const index = Math.min(nativeBars.length - 1, Math.max(0, Math.round((ordinal * (nativeBars.length - 1)) / (userCount - 1))));
  return nativeBars[index];
}

function findPreviousUserOrdinal(userMessageIndexes: number[], messageIndex: number): number {
  for (let index = userMessageIndexes.length - 1; index >= 0; index -= 1) {
    if (userMessageIndexes[index] < messageIndex) {
      return index;
    }
  }
  return -1;
}

function findNextUserOrdinal(userMessageIndexes: number[], messageIndex: number): number {
  for (let index = 0; index < userMessageIndexes.length; index += 1) {
    if (userMessageIndexes[index] > messageIndex) {
      return index;
    }
  }
  return -1;
}

function useNativeHighlightRail(highlights: Highlight[]): RailMark[] {
  const [marks, setMarks] = useState<RailMark[]>([]);

  useEffect(() => {
    const compute = () => {
      const messages = getMessageElements();
      const nativeBars = detectNativeRailBars();
      const userMessageIndexes = messages
        .map((message, index) => (message.getAttribute("data-message-author-role") === "user" ? index : -1))
        .filter((index) => index >= 0);
      const nextMarks: RailMark[] = [];
      const usedTops = new Map<number, number>();

      for (const highlight of highlights) {
        const userOrdinal = userMessageIndexes.indexOf(highlight.message_index);
        let baseBar: NativeRailBar;

        if (userOrdinal >= 0 || highlight.message_role === "user") {
          baseBar = barForUserOrdinal(nativeBars, userMessageIndexes.length, Math.max(0, userOrdinal));
        } else {
          const previousUserOrdinal = findPreviousUserOrdinal(userMessageIndexes, highlight.message_index);
          const nextUserOrdinal = findNextUserOrdinal(userMessageIndexes, highlight.message_index);
          const previousBar = previousUserOrdinal >= 0 ? barForUserOrdinal(nativeBars, userMessageIndexes.length, previousUserOrdinal) : null;
          const nextBar = nextUserOrdinal >= 0 ? barForUserOrdinal(nativeBars, userMessageIndexes.length, nextUserOrdinal) : null;

          if (previousBar && nextBar) {
            baseBar = {
              ...previousBar,
              top: previousBar.top + (nextBar.top - previousBar.top) * 0.5
            };
          } else if (previousBar) {
            baseBar = { ...previousBar, top: previousBar.top + 9 };
          } else if (nextBar) {
            baseBar = { ...nextBar, top: Math.max(48, nextBar.top - 9) };
          } else {
            baseBar = fallbackRailBar(nextMarks.length);
          }
        }

        const roundedTop = Math.round(baseBar.top);
        const collisionCount = usedTops.get(roundedTop) || 0;
        usedTops.set(roundedTop, collisionCount + 1);
        nextMarks.push({
          id: `highlight-${highlight.id}`,
          title: highlight.selected_text,
          messageIndex: highlight.message_index,
          highlightId: highlight.id,
          top: baseBar.top + collisionCount * 7,
          left: baseBar.left,
          width: Math.max(28, baseBar.width),
          height: Math.max(3, baseBar.height)
        });
      }

      setMarks(nextMarks);
    };

    compute();
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [highlights]);

  return marks;
}

function HighlightRail({ highlights }: { highlights: Highlight[] }) {
  const marks = useNativeHighlightRail(highlights);
  const [hovered, setHovered] = useState<RailMark | null>(null);

  if (marks.length === 0) {
    return null;
  }

  const handleClick = (mark: RailMark) => {
    scrollToHighlight(mark.highlightId);
  };

  return (
    <div className="rail" aria-label="Highlighted text index">
      {marks.map((mark) => (
        <button
          key={mark.id}
          className="rail__mark"
          style={{
            top: mark.top,
            left: mark.left,
            width: mark.width,
            height: mark.height
          }}
          title={mark.title}
          onMouseEnter={() => setHovered(mark)}
          onMouseLeave={() => setHovered((current) => (current?.id === mark.id ? null : current))}
          onClick={() => handleClick(mark)}
        />
      ))}
      {hovered && (
        <button
          className="rail-tooltip"
          style={{
            top: Math.min(Math.max(16, hovered.top - 16), window.innerHeight - 150),
            left: Math.max(12, hovered.left - 360)
          }}
          onMouseEnter={() => setHovered(hovered)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => handleClick(hovered)}
        >
          {hovered.title}
        </button>
      )}
    </div>
  );
}

function AuthPanel({
  settings,
  email,
  code,
  status,
  error,
  setEmail,
  setCode,
  onStart,
  onVerify
}: {
  settings: AppSettings | null;
  email: string;
  code: string;
  status: string;
  error: string;
  setEmail: (value: string) => void;
  setCode: (value: string) => void;
  onStart: () => void;
  onVerify: () => void;
}) {
  if (!settings) {
    return null;
  }

  return (
    <aside className="auth-panel">
      <div className="auth-panel__title">GPTplugins</div>
      <label className="field">
        <span>Email</span>
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <button className="button" onClick={onStart}>
        Send code
      </button>
      <label className="field">
        <span>Code</span>
        <input className="input" value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <button className="button button--primary" onClick={onVerify}>
        Sign in
      </button>
      {status && <div className="status">{status}</div>}
      {error && <div className="status status--error">{error}</div>}
    </aside>
  );
}

export function App({ selection, clearSelection }: AppProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [conversationId, setConversationId] = useState(() => getConversationId());
  const authenticated = Boolean(settings?.token);
  const selectionKey = selection
    ? `${selection.conversation_id}:${selection.message_index}:${selection.text_start ?? ""}:${selection.text_end ?? ""}:${selection.selected_text}`
    : "";

  const reloadHighlights = useCallback(async () => {
    if (!settings?.token) {
      setHighlights([]);
      return;
    }
    const rows = await listHighlights(settings, conversationId);
    setHighlights(rows);
    renderHighlights(rows);
  }, [settings, conversationId]);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      setEmail(loaded.email || "");
    });
  }, []);

  useEffect(() => {
    reloadHighlights().catch((err: Error) => setError(err.message));
  }, [reloadHighlights, conversationId]);

  useEffect(() => {
    setNoteEditorOpen(false);
    setNoteDraft("");
  }, [selectionKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextConversationId = getConversationId();
      setConversationId((current) => (current === nextConversationId ? current : nextConversationId));
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let renderTimer: number | null = null;
    let renderingHighlights = false;

    const onRenderStart = () => {
      renderingHighlights = true;
    };
    const onRenderEnd = () => {
      renderingHighlights = false;
    };
    window.addEventListener("gptplugins:render-start", onRenderStart);
    window.addEventListener("gptplugins:render-end", onRenderEnd);
    const onHighlightDeleted = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) {
        setHighlights((current) => current.filter((highlight) => highlight.id !== id));
      }
    };
    window.addEventListener("gptplugins:highlight-deleted", onHighlightDeleted);

    const isOwnMutation = (mutation: MutationRecord) => {
      const nodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      if (nodes.length === 0) {
        return false;
      }
      return nodes.every((node) => {
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        return Boolean(
          element?.closest("#gptplugins-root") ||
            element?.closest("#gptplugins-note-tooltip") ||
            element?.closest(".gptplugins-highlight-mark") ||
            element?.classList.contains("gptplugins-highlight-mark")
        );
      });
    };

    const observer = new MutationObserver((mutations) => {
      if (renderingHighlights || mutations.every(isOwnMutation) || highlights.length === 0) {
        return;
      }
      if (renderTimer) {
        window.clearTimeout(renderTimer);
      }
      renderTimer = window.setTimeout(() => renderHighlights(highlights), 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("gptplugins:render-start", onRenderStart);
      window.removeEventListener("gptplugins:render-end", onRenderEnd);
      window.removeEventListener("gptplugins:highlight-deleted", onHighlightDeleted);
      observer.disconnect();
      if (renderTimer) {
        window.clearTimeout(renderTimer);
      }
    };
  }, [highlights]);

  async function handleStartAuth() {
    if (!settings) return;
    setError("");
    setStatus("Sending code...");
    const response = await startEmailAuth(settings, email);
    setStatus(response.dev_code ? `Development code: ${response.dev_code}` : "Code sent. Check your email.");
  }

  async function handleVerifyAuth() {
    if (!settings) return;
    setError("");
    const response = await verifyEmailAuth(settings, email, code);
    const next = await saveSettings({ token: response.access_token, email: response.email });
    setSettings(next);
    setStatus("Signed in.");
  }

  async function handleCreate(note = "") {
    if (!settings || !selection) return;
    setError("");
    const created = await createHighlight(settings, {
      conversation_id: selection.conversation_id,
      conversation_title: selection.conversation_title,
      selected_text: selection.selected_text,
      prefix: selection.prefix,
      suffix: selection.suffix,
      text_start: selection.text_start,
      text_end: selection.text_end,
      anchor: selection.anchor,
      message_index: selection.message_index,
      message_role: selection.message_role,
      note,
      color: "yellow"
    });
    const next = [...highlights, created];
    setHighlights(next);
    const renderedCount = renderHighlights(next);
    clearSelection();
    setStatus(renderedCount > 0 ? "Saved." : "Saved, but the text is not currently visible or could not be matched.");
  }

  async function handleCreateNote() {
    const note = noteDraft.trim();
    if (!note) {
      setNoteEditorOpen(false);
      setNoteDraft("");
      return;
    }
    await handleCreate(note);
    setNoteEditorOpen(false);
    setNoteDraft("");
  }

  async function handleDeleteHighlight(id: string) {
    if (!settings) return;
    setError("");
    await deleteHighlight(settings, id);
    document.querySelectorAll<HTMLElement>(`.gptplugins-highlight-mark[data-highlight-id="${CSS.escape(id)}"]`).forEach((item) => {
      item.replaceWith(document.createTextNode(item.textContent || ""));
    });
    document.body.normalize();
    setHighlights((current) => current.filter((highlight) => highlight.id !== id));
    clearSelection();
    setStatus("Highlight removed.");
  }

  async function handleAsk() {
    if (!selection) return;
    const prompt = buildAskPrompt(selection);
    await navigator.clipboard.writeText(prompt);
    await chrome.runtime.sendMessage({ type: "OPEN_ASK_WINDOW" });
    clearSelection();
    setStatus("Prompt copied. ChatGPT window opened.");
  }

  const toolbarLeft = selection ? Math.min(selection.rect.left, window.innerWidth - 260) : 0;
  const toolbarTop = selection ? Math.max(selection.rect.top - 48, 8) : 0;
  const editorTop = selection ? Math.min(Math.max(selection.rect.bottom + 8, 8), window.innerHeight - 180) : 0;
  const editorLeft = selection ? Math.min(Math.max(selection.rect.left, 8), window.innerWidth - 300) : 0;

  return (
    <>
      {selection && (
        <div
          className="toolbar"
          onMouseDown={(event) => event.preventDefault()}
          style={{
            left: toolbarLeft,
            top: toolbarTop
          }}
        >
          {selection.overlapping_highlight_id ? (
            <button className="button button--danger" disabled={!authenticated} onClick={() => void handleDeleteHighlight(selection.overlapping_highlight_id!)}>
              取消划线
            </button>
          ) : (
            <>
              <button className="button button--primary" disabled={!authenticated} onClick={() => void handleCreate()}>
                Save
              </button>
              <button
                className="button"
                disabled={!authenticated}
                onClick={() => {
                  setNoteEditorOpen(true);
                  setNoteDraft("");
                }}
              >
                Note
              </button>
              <button className="button" onClick={() => void handleAsk()}>
                Ask
              </button>
            </>
          )}
        </div>
      )}

      {selection && noteEditorOpen && !selection.overlapping_highlight_id && (
        <div className="note-editor" style={{ top: editorTop, left: editorLeft }} onMouseDown={(event) => event.stopPropagation()}>
          <textarea
            className="note-editor__textarea"
            value={noteDraft}
            autoFocus
            placeholder="Write annotation..."
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNoteEditorOpen(false);
                setNoteDraft("");
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                void handleCreateNote();
              }
            }}
          />
          <div className="note-editor__actions">
            <button
              className="button"
              onClick={() => {
                setNoteEditorOpen(false);
                setNoteDraft("");
              }}
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={!noteDraft.trim()} onClick={() => void handleCreateNote()}>
              Save note
            </button>
          </div>
        </div>
      )}

      {!authenticated && (
        <AuthPanel
          settings={settings}
          email={email}
          code={code}
          status={status}
          error={error}
          setEmail={setEmail}
          setCode={setCode}
          onStart={() => void handleStartAuth()}
          onVerify={() => void handleVerifyAuth()}
        />
      )}

      {authenticated && status && <div className="toast">{status}</div>}
      {authenticated && error && <div className="toast toast--error">{error}</div>}
      <HighlightRail highlights={highlights} />
    </>
  );
}
