import { getEncoding } from "js-tiktoken";

// cl100k_base covers GPT-4, Claude, and most modern models closely enough
// for budget tracking purposes (±5% accuracy vs native tokenizers)
const enc = getEncoding("cl100k_base");

/**
 * Count tokens in a string or any serialisable value.
 * Returns 0 for null/undefined rather than throwing.
 */
export function countTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 0);

  try {
    return enc.encode(text).length;
  } catch {
    // Fallback: rough estimate (1 token ≈ 4 chars)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens for a tool call: name + stringified arguments.
 * Adds ~4 tokens of MCP envelope overhead per call.
 */
export function countToolCallInputTokens(
  toolName: string,
  args: unknown
): number {
  const MCP_ENVELOPE_OVERHEAD = 4;
  return countTokens(toolName) + countTokens(args) + MCP_ENVELOPE_OVERHEAD;
}

/**
 * Count tokens for a tool call result output.
 */
export function countToolCallOutputTokens(output: unknown): number {
  return countTokens(output);
}
