import type { AnchorSelector } from "../types";

const HIGHLIGHT_CLASS = "gptplugins-highlight-mark";
const SKIP_SELECTOR = [
  "button",
  "svg",
  "img",
  "textarea",
  "input",
  "select",
  "[contenteditable='true']",
  "[aria-hidden='true']",
  "[data-testid*='copy']",
  "[data-testid*='share']",
  "[data-testid*='feedback']",
  "[data-testid*='sources']",
  `.${HIGHLIGHT_CLASS}`
].join(",");

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface TextIndex {
  text: string;
  segments: TextSegment[];
}

function shouldSkipNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(SKIP_SELECTOR));
}

export function buildTextIndex(root: HTMLElement): TextIndex {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node) || !node.textContent) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const value = node.textContent || "";
    segments.push({
      node,
      start: text.length,
      end: text.length + value.length
    });
    text += value;
    current = walker.nextNode();
  }

  return { text, segments };
}

function pathFromRoot(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) {
      return null;
    }
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function nodeFromPath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;
  for (const index of path) {
    current = current?.childNodes[index] || null;
    if (!current) {
      return null;
    }
  }
  return current;
}

function positionFromDom(index: TextIndex, container: Node, offset: number, root: HTMLElement): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const segment = index.segments.find((item) => item.node === container);
    return segment ? segment.start + offset : null;
  }

  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(container, offset);
  return probe.toString().length;
}

function domPointFromPosition(index: TextIndex, position: number): { node: Text; offset: number } | null {
  for (const segment of index.segments) {
    if (position >= segment.start && position <= segment.end) {
      return {
        node: segment.node,
        offset: Math.min(segment.node.textContent?.length || 0, Math.max(0, position - segment.start))
      };
    }
  }

  const last = index.segments[index.segments.length - 1];
  if (last && position === index.text.length) {
    return { node: last.node, offset: last.node.textContent?.length || 0 };
  }
  return null;
}

export function createAnchor(root: HTMLElement, range: Range): AnchorSelector | null {
  const index = buildTextIndex(root);
  if (!index.segments.length || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const rawSelected = range.toString();
  const leadingWhitespace = rawSelected.length - rawSelected.trimStart().length;
  const trailingWhitespace = rawSelected.length - rawSelected.trimEnd().length;
  const exact = rawSelected.trim();
  if (!exact) {
    return null;
  }

  const rawStart = positionFromDom(index, range.startContainer, range.startOffset, root);
  if (rawStart === null) {
    return null;
  }

  const start = rawStart + leadingWhitespace;
  const end = rawStart + rawSelected.length - trailingWhitespace;
  const startPoint = domPointFromPosition(index, start);
  const endPoint = domPointFromPosition(index, end);
  if (!startPoint || !endPoint) {
    return null;
  }

  return {
    exact,
    prefix: index.text.slice(Math.max(0, start - 160), start),
    suffix: index.text.slice(end, end + 160),
    start,
    end,
    start_path: pathFromRoot(root, startPoint.node),
    start_offset: startPoint.offset,
    end_path: pathFromRoot(root, endPoint.node),
    end_offset: endPoint.offset,
    text_hash: hashText(index.text)
  };
}

export function restoreAnchor(root: HTMLElement, anchor: AnchorSelector): Range | null {
  return restoreByDomPath(root, anchor) || restoreByPosition(root, anchor) || restoreByQuote(root, anchor);
}

function restoreByDomPath(root: HTMLElement, anchor: AnchorSelector): Range | null {
  if (!anchor.start_path || !anchor.end_path || anchor.start_offset === null || anchor.end_offset === null) {
    return null;
  }

  const startNode = nodeFromPath(root, anchor.start_path);
  const endNode = nodeFromPath(root, anchor.end_path);
  if (!startNode || !endNode || startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, Math.min(anchor.start_offset, startNode.textContent?.length || 0));
  range.setEnd(endNode, Math.min(anchor.end_offset, endNode.textContent?.length || 0));
  return range.toString().trim() === anchor.exact ? range : null;
}

function restoreByPosition(root: HTMLElement, anchor: AnchorSelector): Range | null {
  if (anchor.start === null || anchor.end === null || anchor.end <= anchor.start) {
    return null;
  }

  const index = buildTextIndex(root);
  if (index.text.slice(anchor.start, anchor.end) !== anchor.exact) {
    return null;
  }

  return rangeFromOffsets(index, anchor.start, anchor.end);
}

function restoreByQuote(root: HTMLElement, anchor: AnchorSelector): Range | null {
  const index = buildTextIndex(root);
  const candidates: number[] = [];
  let cursor = index.text.indexOf(anchor.exact);
  while (cursor >= 0) {
    candidates.push(cursor);
    cursor = index.text.indexOf(anchor.exact, cursor + Math.max(1, anchor.exact.length));
  }

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates
    .map((candidate) => ({
      start: candidate,
      score: quoteScore(index.text, candidate, anchor)
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 0.55) {
    return null;
  }
  return rangeFromOffsets(index, best.start, best.start + anchor.exact.length);
}

function quoteScore(text: string, start: number, anchor: AnchorSelector): number {
  const before = text.slice(Math.max(0, start - (anchor.prefix?.length || 0)), start);
  const after = text.slice(start + anchor.exact.length, start + anchor.exact.length + (anchor.suffix?.length || 0));
  const prefixScore = anchor.prefix ? commonSuffixRatio(before, anchor.prefix) : 0.5;
  const suffixScore = anchor.suffix ? commonPrefixRatio(after, anchor.suffix) : 0.5;
  return (prefixScore + suffixScore) / 2;
}

function commonPrefixRatio(left: string, right: string): number {
  const length = Math.max(1, right.length);
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count / length;
}

function commonSuffixRatio(left: string, right: string): number {
  const length = Math.max(1, right.length);
  let count = 0;
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) {
    count += 1;
  }
  return count / length;
}

function rangeFromOffsets(index: TextIndex, start: number, end: number): Range | null {
  const startPoint = domPointFromPosition(index, start);
  const endPoint = domPointFromPosition(index, end);
  if (!startPoint || !endPoint) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

export function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
