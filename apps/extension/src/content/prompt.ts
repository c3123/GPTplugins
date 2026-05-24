import type { SelectionSnapshot } from "../types";

function trimForPrompt(value: string, max = 1200): string {
  const text = value.trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

export function buildAskPrompt(snapshot: SelectionSnapshot): string {
  return [
    "请基于下面 ChatGPT 对话中的划线内容和上下文回答我的问题。",
    "",
    "要求：",
    "1. 先判断划线内容在当前语境中的含义。",
    "2. 如果上下文不足，请明确说明缺少什么信息。",
    "3. 回答要直接、具体。",
    "",
    "【划线原文】",
    trimForPrompt(snapshot.selected_text),
    "",
    "【所在消息角色】",
    snapshot.message_role,
    "",
    "【所在消息上下文】",
    trimForPrompt(snapshot.message_text),
    "",
    "【上一条消息】",
    trimForPrompt(snapshot.previous_message_text || "无"),
    "",
    "【下一条消息】",
    trimForPrompt(snapshot.next_message_text || "无"),
    "",
    "我的问题：请解释这段划线内容，并说明它在上下文里应该如何理解。"
  ].join("\n");
}
