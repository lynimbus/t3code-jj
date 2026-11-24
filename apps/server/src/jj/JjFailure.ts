import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { GitCommandError, VcsUnsupportedOperationError } from "@t3tools/contracts";
import type { JjProcessExitError } from "../vcs/JjProcess.ts";

const isUnsupportedOperationError = Schema.is(VcsUnsupportedOperationError);
const isGitCommandError = Schema.is(GitCommandError);
// `extend` keeps the parent tag, and the child adds `reason`. Importing the class value
// here would also create a cycle through the process layer.
const isJjProcessExitError = (value: unknown): value is JjProcessExitError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "VcsProcessExitError" &&
  "reason" in value;

/** Read the typed refusal before Schema.Defect flattens nested errors on the wire. */
export const jjUnsupportedDetail = (cause: unknown): string | undefined => {
  const seen = new Set<object>();
  while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
    if (isUnsupportedOperationError(cause)) {
      return cause.detail;
    }
    seen.add(cause);
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return undefined;
};

export const jjFailure = (operation: string, cwd: string, detail: string, cause?: unknown) => {
  const unsupportedDetail = jjUnsupportedDetail(cause);
  const reason = isGitCommandError(cause)
    ? cause.reason
    : isJjProcessExitError(cause)
      ? cause.reason
      : undefined;
  return new GitCommandError({
    operation,
    command: "jj",
    cwd,
    detail: unsupportedDetail ?? detail,
    ...(unsupportedDetail !== undefined
      ? { reason: "unsupported_repository" as const }
      : reason !== undefined
        ? { reason }
        : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
};

export const mapJjFailure = (operation: string, cwd: string, detail: string) =>
  Effect.mapError((cause: unknown) => jjFailure(operation, cwd, detail, cause));
