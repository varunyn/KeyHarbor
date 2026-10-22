import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export type ToolCall = (
  action: string,
  data: Record<string, unknown>
) => Promise<unknown>;

export const optionalVault = z
  .string()
  .min(1)
  .optional()
  .describe("Vault name. Omit to use the System vault.");
export const optionalEnvironment = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u)
  .optional()
  .describe(
    "Environment name. Omit to use the Project's fixed default Environment. Never inferred from the desktop selection or NODE_ENV."
  );
export const projectName = z
  .string()
  .min(1)
  .describe("KeyHarbor project name.");
export const secretKey = z.string().min(1).describe("Secret key.");

export const toolError = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

export const toolResult = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ text: JSON.stringify(data), type: "text" }],
  structuredContent: data,
});

export const isToolError = (value: unknown): value is CallToolResult =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { isError?: unknown }).isError === true
  );
