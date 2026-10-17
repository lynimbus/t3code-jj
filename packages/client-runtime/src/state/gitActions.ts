import type {
  GitRunStackedActionInput,
  GitStackedAction,
  VcsStatusResult,
} from "@t3tools/contracts";
import { type ChangeRequestTerminology, sourceControlClients } from "../sourceControlClients.ts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";
import {
  GIT_VCS_TERMINOLOGY,
  resolveVcsTerminology,
  resolveVcsUnsupportedReason,
  type VcsTerminology,
} from "@t3tools/shared/vcs";

export type GitActionSurface = "web" | "mobile";
export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export type GitActionRequestInput = Pick<
  GitRunStackedActionInput,
  "action" | "commitMessage" | "featureBranch" | "filePaths"
>;

export function changeRequestTerminologyFor(
  gitStatus: VcsStatusResult | null,
): ChangeRequestTerminology {
  return sourceControlClients.get(gitStatus?.sourceControlProvider?.kind).changeRequest;
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
  resolve: MFunctionType = mFallback,
  surface: GitActionSurface = "mobile",
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const terminology = changeRequestTerminologyFor(gitStatus);
  const blocked = isBusy || resolveVcsUnsupportedReason(gitStatus) !== null;

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCommit = !blocked && hasChanges;
  const canPush =
    !blocked &&
    hasBranch &&
    (surface === "web" || !hasChanges) &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !blocked &&
    hasBranch &&
    !hasOpenPr &&
    !(surface === "mobile" && gitStatus.vcs?.kind === "jj" && hasChanges) &&
    (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0 &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);

  const items: GitActionMenuItem[] = [
    {
      id: "commit",
      label: resolve(msg("Commit", { $context: "verb, git action" })),
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
  ];
  if (surface === "web" && !hasOriginRemote) return items;
  items.push({
    id: "push",
    label: resolve(msg("Push", { $context: "verb, git action" })),
    disabled: !canPush,
    icon: "push",
    kind: "open_dialog",
    dialogAction: "push",
  });
  if (surface === "web" && hasOpenPr) return items;
  items.push(
    hasOpenPr
      ? {
          id: "pr",
          label: resolve(msg("View {shortLabel}", { shortLabel: terminology.shortLabel })),
          disabled: blocked,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: resolve(msg("Create {shortLabel}", { shortLabel: terminology.shortLabel })),
          disabled: !canCreatePr,
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
        },
  );
  return items;
}

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultBranch = false,
  hasOriginRemote = true,
  resolve: MFunctionType = mFallback,
  surface: GitActionSurface = "mobile",
): GitQuickAction {
  const vcs = resolveVcsTerminology(gitStatus);
  if (isBusy) {
    return {
      label: resolve(msg("Commit", { $context: "verb, git action" })),
      disabled: true,
      kind: "show_hint",
      hint: resolve(msg("{system} action in progress.", { system: vcs.systemName })),
    };
  }

  if (!gitStatus) {
    return {
      label: resolve(msg("Commit", { $context: "verb, git action" })),
      disabled: true,
      kind: "show_hint",
      hint: resolve(msg("{system} status is unavailable.", { system: vcs.systemName })),
    };
  }

  const unsupportedReason = resolveVcsUnsupportedReason(gitStatus);
  if (unsupportedReason !== null) {
    return {
      label: resolve(msg("Commit", { $context: "verb, git action" })),
      disabled: true,
      kind: "show_hint",
      hint: unsupportedReason,
    };
  }

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = changeRequestTerminologyFor(gitStatus);
  const resting: GitQuickAction = {
    label: resolve(msg("Commit", { $context: "verb, git action" })),
    disabled: true,
    kind: "show_hint",
    hint: resolve(msg("{ref} is up to date. No action needed.", { ref: vcs.refNounTitle })),
  };

  if (!hasBranch) {
    return {
      label: resolve(msg("Commit", { $context: "verb, git action" })),
      disabled: true,
      kind: "show_hint",
      hint: vcs.quickNoRefHint(
        surface === "web" ? `a ${terminology.singular}` : terminology.shortLabelWithArticle,
        surface,
      ),
    };
  }

  if (hasChanges) {
    if (isBehind || (!gitStatus.hasUpstream && !hasOriginRemote)) {
      return {
        label: resolve(msg("Commit", { $context: "verb, git action" })),
        disabled: false,
        kind: "run_action",
        action: "commit",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: resolve(msg("Commit & push")),
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: resolve(msg("Commit, push & {shortLabel}", { shortLabel: terminology.shortLabel })),
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (surface === "web") {
        return {
          label: resolve(msg("Publish repository")),
          disabled: false,
          kind: "open_publish",
        };
      }
      if (hasOpenPr && !isAhead) {
        return {
          label: resolve(msg("View {shortLabel}", { shortLabel: terminology.shortLabel })),
          disabled: false,
          kind: "open_pr",
        };
      }
      return {
        label: resolve(msg("Push", { $context: "verb, git action" })),
        disabled: true,
        kind: "show_hint",
        hint: resolve(
          msg(
            '{kind, select, pr {Add an "origin" remote before pushing or creating a PR.} mr {Add an "origin" remote before pushing or creating an MR.} generic {Add an "origin" remote before pushing or creating a change request.} other {Add an "origin" remote before pushing or creating {changeRequest}.}}',
            {
              kind: changeRequestKind(terminology),
              changeRequest: terminology.shortLabelWithArticle,
            },
          ),
        ),
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return surface === "web"
          ? resting
          : {
              label: resolve(msg("View {shortLabel}", { shortLabel: terminology.shortLabel })),
              disabled: false,
              kind: "open_pr",
            };
      }
      return {
        label: resolve(msg("Push", { $context: "verb, git action" })),
        disabled: true,
        kind: "show_hint",
        hint: resolve(msg("No local {change}s to push.", { change: vcs.changeNoun })),
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: resolve(msg("Push", { $context: "verb, git action" })),
        disabled: false,
        kind: "run_action",
        action: "push",
      };
    }
    return {
      label: resolve(msg("Push & create {shortLabel}", { shortLabel: terminology.shortLabel })),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: resolve(
        msg("Sync {ref}", { ref: surface === "web" ? vcs.genericRefNoun : vcs.refNoun }),
      ),
      disabled: true,
      kind: "show_hint",
      hint: resolve(
        msg("{ref} has diverged from upstream. Rebase/merge first.", { ref: vcs.refNounTitle }),
      ),
    };
  }

  if (isBehind) {
    return {
      label: resolve(msg("Pull", { $context: "verb, git action" })),
      disabled: false,
      kind: "run_pull",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: resolve(msg("Push", { $context: "verb, git action" })),
        disabled: false,
        kind: "run_action",
        action: "push",
      };
    }
    return {
      label: resolve(msg("Push & create {shortLabel}", { shortLabel: terminology.shortLabel })),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return surface === "web"
      ? resting
      : {
          label: resolve(msg("View {shortLabel}", { shortLabel: terminology.shortLabel })),
          disabled: false,
          kind: "open_pr",
        };
  }

  if (surface === "web" && hasDefaultBranchDelta && !isDefaultBranch) {
    return {
      label: resolve(msg("Create {shortLabel}", { shortLabel: terminology.shortLabel })),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  return resting;
}

export function getGitActionDisabledReason(
  input: {
    item: GitActionMenuItem;
    gitStatus: VcsStatusResult | null;
    isBusy: boolean;
    hasOriginRemote: boolean;
    surface?: GitActionSurface;
  },
  resolve: MFunctionType = mFallback,
): string | null {
  const { item, gitStatus, isBusy, hasOriginRemote, surface = "mobile" } = input;
  const vcs = resolveVcsTerminology(gitStatus);
  if (!item.disabled) return null;
  if (isBusy) return resolve(msg("{system} action in progress.", { system: vcs.systemName }));
  if (!gitStatus)
    return resolve(msg("{system} status is unavailable.", { system: vcs.systemName }));
  const unsupportedReason = resolveVcsUnsupportedReason(gitStatus);
  if (unsupportedReason !== null) return unsupportedReason;

  const isJj = gitStatus.vcs?.kind === "jj";
  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const terminology = changeRequestTerminologyFor(gitStatus);

  if (item.id === "commit") {
    if (!hasChanges) {
      return surface === "web"
        ? vcs.cleanCommitHint
        : resolve(
            msg("{workspace} is clean. Make changes before committing.", {
              workspace: vcs.workspaceNounTitle,
            }),
          );
    }
    return resolve(msg("Commit is currently unavailable."));
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return vcs.noRefHint("pushing", surface);
    }
    if (hasChanges) {
      return isJj
        ? vcs.dirtyPushHint
        : resolve(msg("Commit or stash local changes before pushing."));
    }
    if (isBehind) {
      return resolve(
        msg("{ref} is behind upstream. Pull/rebase before pushing.", { ref: vcs.refNounTitle }),
      );
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return resolve(msg('Add an "origin" remote before pushing.'));
    }
    if (!isAhead) {
      return resolve(msg("No local {change}s to push.", { change: vcs.changeNoun }));
    }
    return resolve(msg("Push is currently unavailable."));
  }

  if (surface === "mobile" && hasOpenPr) {
    return resolve(
      msg("View {shortLabel} is currently unavailable.", { shortLabel: terminology.shortLabel }),
    );
  }
  if (!hasBranch) {
    return vcs.noRefHint(
      `creating ${surface === "web" ? `a ${terminology.singular}` : terminology.shortLabelWithArticle}`,
      surface,
    );
  }
  if (surface === "mobile" && isJj && hasChanges) {
    return vcs.dirtyPushHint;
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return resolve(
      msg(
        '{kind, select, pr {Add an "origin" remote before creating a PR.} mr {Add an "origin" remote before creating an MR.} generic {Add an "origin" remote before creating a change request.} other {Add an "origin" remote before creating {changeRequest}.}}',
        { kind: changeRequestKind(terminology), changeRequest: terminology.shortLabelWithArticle },
      ),
    );
  }
  if ((gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) <= 0) {
    return resolve(
      msg(
        "{kind, select, pr {No local commits to include in a PR.} mr {No local commits to include in an MR.} generic {No local commits to include in a change request.} other {No local commits to include in {changeRequest}.}}",
        { kind: changeRequestKind(terminology), changeRequest: terminology.shortLabelWithArticle },
      ),
    );
  }
  if (isBehind) {
    return resolve(
      msg("{ref} is behind upstream. Pull/rebase before creating {changeRequest}.", {
        ref: vcs.refNounTitle,
        changeRequest: terminology.shortLabelWithArticle,
      }),
    );
  }
  return resolve(
    msg("Create {shortLabel} is currently unavailable.", { shortLabel: terminology.shortLabel }),
  );
}

/** Picks the whole sentence for the provider's term; English keeps `shortLabelWithArticle`. */
function changeRequestKind(
  terminology: ChangeRequestTerminology,
): "pr" | "mr" | "generic" | "other" {
  switch (terminology.shortLabelWithArticle) {
    case "a PR":
      return "pr";
    case "an MR":
      return "mr";
    case "a change request":
      return "generic";
    default:
      return "other";
  }
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean,
): boolean {
  if (!isDefaultBranch) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(
  input: {
    action: DefaultBranchConfirmableAction;
    branchName: string;
    includesCommit: boolean;
    terminology: ChangeRequestTerminology;
    vcsTerminology?: VcsTerminology;
    surface?: GitActionSurface;
  },
  resolve: MFunctionType = mFallback,
): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const { shortLabel, shortLabelWithArticle } = input.terminology;
  const vcs = input.vcsTerminology ?? GIT_VCS_TERMINOLOGY;
  const ref = input.surface === "web" ? vcs.genericRefNoun : vcs.refNoun;

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: resolve(msg("Commit & push to default {ref}?", { ref })),
        description: resolve(
          msg(
            'This action will commit and push changes on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.',
            { branch: branchLabel, ref },
          ),
        ),
        continueLabel: resolve(msg("Commit & push to {branch}", { branch: branchLabel })),
      };
    }
    return {
      title: resolve(msg("Push to default {ref}?", { ref })),
      description: resolve(
        msg(
          'This action will push local {change}s on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.',
          { branch: branchLabel, ref, change: vcs.changeNoun },
        ),
      ),
      continueLabel: resolve(msg("Push to {branch}", { branch: branchLabel })),
    };
  }

  if (input.includesCommit) {
    return {
      title: resolve(
        msg("Commit, push & create {shortLabel} from default {ref}?", { shortLabel, ref }),
      ),
      description: resolve(
        msg(
          '{kind, select, pr {This action will commit, push, and create a PR on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} mr {This action will commit, push, and create an MR on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} generic {This action will commit, push, and create a change request on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} other {This action will commit, push, and create {changeRequest} on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.}}',
          {
            kind: changeRequestKind(input.terminology),
            changeRequest: shortLabelWithArticle,
            branch: branchLabel,
            ref,
          },
        ),
      ),
      continueLabel: resolve(msg("Commit, push & create {shortLabel}", { shortLabel })),
    };
  }
  return {
    title: resolve(msg("Push & create {shortLabel} from default {ref}?", { shortLabel, ref })),
    description: resolve(
      msg(
        '{kind, select, pr {This action will push local {change}s and create a PR on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} mr {This action will push local {change}s and create an MR on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} generic {This action will push local {change}s and create a change request on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.} other {This action will push local {change}s and create {changeRequest} on "{branch}". You can continue on this {ref} or create a feature {ref} and run the same action there.}}',
        {
          kind: changeRequestKind(input.terminology),
          changeRequest: shortLabelWithArticle,
          branch: branchLabel,
          ref,
          change: vcs.changeNoun,
        },
      ),
    ),
    continueLabel: resolve(msg("Push & create {shortLabel}", { shortLabel })),
  };
}
