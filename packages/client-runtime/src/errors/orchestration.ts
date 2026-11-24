import { GitCommandError, OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const isGitCommandError = Schema.is(GitCommandError);

export function wasBootstrapThreadDeleted(error: unknown): boolean {
  return (
    isOrchestrationDispatchCommandError(error) && error.bootstrapThreadDisposition === "deleted"
  );
}

export function wasBootstrapThreadNotCreated(error: unknown): boolean {
  return (
    isOrchestrationDispatchCommandError(error) && error.bootstrapThreadDisposition === "not-created"
  );
}

/** The server's unsupported-VCS reason, when the failure carries one. */
export function vcsUnsupportedOperationReason(error: unknown): string | null {
  return isGitCommandError(error) && error.reason === "unsupported_repository"
    ? error.detail
    : null;
}

/** Prefer the server's unsupported-VCS reason without changing ordinary error copy. */
export function vcsOperationErrorMessage(error: unknown, fallback: string): string {
  return (
    vcsUnsupportedOperationReason(error) ?? (error instanceof Error ? error.message : fallback)
  );
}
