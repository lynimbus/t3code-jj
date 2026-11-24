#!/usr/bin/env bash
set -euo pipefail

upstream_remote="upstream"
origin_remote="origin"
upstream_branch="main"
sync_branch="sync"
main_branch="main"
do_verify=0
do_update_nix=0
do_force_update_nix=0
do_push=0

usage() {
	cat <<'EOF'
Usage: scripts/fork-sync.sh [options]

Fetch upstream, fast-forward the local sync bookmark, and atomically rebase all
feature branches and the integrated main (Megamerge) onto the latest upstream
using Jujutsu (jj).

Options:
  --verify                  Run typecheck and focused jj/vcs tests after rebase
  --update-nix              Verify and refresh pnpmHash in nix/package.nix if needed
  --force-update-nix        Force a fresh fetchPnpmDeps hash computation (implies --update-nix)
  --push                    Push sync, feature bookmarks, and main to origin when conflict-free
  --remote <name>           Upstream remote name (default: upstream)
  --origin <name>           Fork remote name for --push (default: origin)
  --upstream-branch <name>  Upstream branch/bookmark name (default: main)
  --sync-branch <name>      Local upstream mirror bookmark name (default: sync)
  --main-branch <name>      Integrated fork bookmark name (default: main)
  -h, --help                Show this help message
EOF
}

die() {
	printf '[fork-sync] error: %s\n' "$*" >&2
	exit 1
}

log() {
	printf '[fork-sync] %s\n' "$*"
}

while (($# > 0)); do
	case "$1" in
	--verify) do_verify=1 ;;
	--update-nix) do_update_nix=1 ;;
	--force-update-nix)
		do_update_nix=1
		do_force_update_nix=1
		;;
	--push) do_push=1 ;;
	--remote)
		shift
		(($# > 0)) || die "--remote requires a value"
		upstream_remote="$1"
		;;
	--origin)
		shift
		(($# > 0)) || die "--origin requires a value"
		origin_remote="$1"
		;;
	--upstream-branch)
		shift
		(($# > 0)) || die "--upstream-branch requires a value"
		upstream_branch="$1"
		;;
	--sync-branch)
		shift
		(($# > 0)) || die "--sync-branch requires a value"
		sync_branch="$1"
		;;
	--main-branch)
		shift
		(($# > 0)) || die "--main-branch requires a value"
		main_branch="$1"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		die "unknown option: $1 (use --help)"
		;;
	esac
	shift
done

command -v jj >/dev/null 2>&1 || die "jj is required on PATH"

repo_root="$(jj workspace root 2>/dev/null)" || die "not inside a jj workspace"
cd "$repo_root"

if [ -n "$(jj diff --name-only)" ]; then
	die "working copy (@) has uncommitted changes; commit, squash, or abandon them first"
fi

if ! jj git remote list | awk '{print $1}' | grep -qx -- "$upstream_remote"; then
	die "remote '$upstream_remote' is not configured (expected https://github.com/pingdotgg/t3code.git)"
fi

if ((do_push)); then
	if ! jj git remote list | awk '{print $1}' | grep -qx -- "$origin_remote"; then
		die "--push requested but remote '$origin_remote' is not configured yet"
	fi
fi

old_base="$(jj log --no-graph -r "$sync_branch" -T 'commit_id' 2>/dev/null || true)"
[ -n "$old_base" ] || die "local bookmark '$sync_branch' does not exist"
main_head="$(jj log --no-graph -r "$main_branch" -T 'commit_id' 2>/dev/null || true)"
[ -n "$main_head" ] || die "local bookmark '$main_branch' does not exist"

mapfile -t stack_roots < <(jj log --no-graph -r "roots(${sync_branch}..${main_branch})" -T 'change_id ++ "\n"')
((${#stack_roots[@]} > 0)) || die "no fork commits found between '$sync_branch' and '$main_branch'"

log "fetching ${upstream_remote}/${upstream_branch}"
jj git fetch --remote "$upstream_remote" --branch "$upstream_branch"

upstream_ref="${upstream_branch}@${upstream_remote}"
upstream_commit="$(jj log --no-graph -r "$upstream_ref" -T 'commit_id' 2>/dev/null || true)"
[ -n "$upstream_commit" ] || die "cannot resolve ${upstream_ref} after fetch"

if [ "$old_base" != "$upstream_commit" ]; then
	log "advancing bookmark '$sync_branch': ${old_base:0:8} -> ${upstream_commit:0:8}"
	jj bookmark set "$sync_branch" -r "$upstream_ref"
fi

needs_rebase=0
if [ -z "$(jj log --no-graph -r "${sync_branch} & ::${main_branch}" -T 'commit_id')" ]; then
	needs_rebase=1
elif [ -n "$(jj log --no-graph -r "parents(roots(${sync_branch}..${main_branch})) ~ ${sync_branch}" -T 'commit_id')" ]; then
	needs_rebase=1
fi

if ((needs_rebase)); then
	log "rebasing ${#stack_roots[@]} feature root(s) and '${main_branch}' onto ${sync_branch} (${upstream_commit:0:8})"
	rebase_args=()
	for root_change in "${stack_roots[@]}"; do
		[ -n "$root_change" ] || continue
		rebase_args+=(-s "$root_change")
	done
	jj rebase "${rebase_args[@]}" -d "$sync_branch"
else
	log "'${main_branch}' is already based on ${upstream_ref} (${upstream_commit:0:8})"
fi

conflicts="$(jj log --no-graph -r "${sync_branch}::${main_branch} & conflicts()" -T 'change_id.shortest(8) ++ " " ++ description.first_line() ++ "\n"')"
if [ -n "$conflicts" ]; then
	printf '\n[fork-sync] rebase completed with conflicts in:\n%s\n' "$conflicts" >&2
	while IFS=' ' read -r change_id _; do
		[ -n "$change_id" ] || continue
		printf '[fork-sync] conflicted files in %s:\n' "$change_id" >&2
		jj resolve --list -r "$change_id" >&2 || true
	done <<<"$conflicts"
	cat >&2 <<EOF

Resolve with:
  jj new <change_id>
  # resolve conflict markers in the listed files
  jj squash
  jj new ${main_branch}
  just sync # or: ./scripts/fork-sync.sh --verify --update-nix --push
EOF
	exit 1
fi

log "megamerge stack is clean on top of ${sync_branch} (${upstream_commit:0:8}):"
jj log -r "${sync_branch}::${main_branch}"

if ((do_verify || do_update_nix)); then
	at_commit="$(jj log --no-graph -r '@' -T 'commit_id')"
	main_commit="$(jj log --no-graph -r "$main_branch" -T 'commit_id')"
	at_parents="$(jj log --no-graph -r 'parents(@)' -T 'commit_id ++ "\n"')"
	if [ "$at_commit" != "$main_commit" ] && [ "$at_parents" != "$main_commit" ]; then
		if [ -n "$(jj log --no-graph -r '@ & empty() & description(exact:"")' -T 'commit_id')" ]; then
			log "moving empty working copy (@) onto '${main_branch}'"
			jj new "$main_branch"
		else
			die "working copy (@) is not on '${main_branch}'; run 'jj new ${main_branch}' before --verify/--update-nix"
		fi
	fi
fi

if ((do_verify)); then
	command -v pnpm >/dev/null 2>&1 || die "--verify requires pnpm on PATH"
	log "running typecheck on affected workspaces"
	pnpm exec vp run \
		--filter @t3tools/contracts \
		--filter @t3tools/shared \
		--filter @t3tools/client-runtime \
		--filter t3 \
		--filter @t3tools/web \
		--filter @t3tools/mobile \
		typecheck

	log "running focused fork test suites (jj/vcs + telemetry)"
	pnpm exec vp test run \
		apps/server/src/jj/ \
		apps/server/src/vcs/JjAvailability.test.ts \
		apps/server/src/vcs/JjCheckpoints.test.ts \
		apps/server/src/vcs/JjProcess.test.ts \
		apps/server/src/vcs/JjRepo.test.ts \
		apps/server/src/vcs/JjReviewDiff.test.ts \
		apps/server/src/vcs/JjRevset.test.ts \
		apps/server/src/vcs/JjVcsDriver.test.ts \
		apps/server/src/vcs/VcsDriverRegistry.test.ts \
		apps/server/src/vcs/VcsDriverRegistry.activation.test.ts \
		apps/server/src/vcs/VcsStatusBroadcaster.test.ts \
		apps/server/src/mcp/toolkits/project/handlers.test.ts \
		apps/server/src/telemetry/NoopAnalyticsService.test.ts \
		apps/server/src/cloud/relayTracing.test.ts \
		apps/server/src/cloud/relayTracing.disabled.test.ts \
		apps/web/src/lib/runtime.test.ts \
		apps/web/src/state/vcs.terminology.test.ts \
		apps/mobile/src/features/observability/observe.test.ts \
		apps/mobile/src/features/threads/git/GitBranchesSheet.test.tsx \
		apps/mobile/src/features/threads/git/GitConfirmSheet.test.tsx \
		packages/contracts/src/git.test.ts \
		packages/shared/src/vcs.test.ts \
		packages/client-runtime/src/authorization/remote.test.ts \
		packages/client-runtime/src/state/gitActions.test.ts \
		packages/client-runtime/src/state/gitActions.matrix.test.ts
fi

if ((do_update_nix)); then
	command -v nix >/dev/null 2>&1 || die "--update-nix requires nix on PATH"
	log "verifying Nix pnpmDeps hash in nix/package.nix"
	nix_log="$(mktemp)"
	trap 'rm -f "$nix_log"' EXIT
	old_hash="$(nix eval --raw .#t3code-jj.passthru.pnpmHash)"
	new_hash=""
	if ((do_force_update_nix)); then
		# Force a fresh fetch with an empty hash via git+file:// (so untracked
		# directories like node_modules are not copied into the Nix store).
		# shellcheck disable=SC2016
		nix build --no-link --impure --expr '((builtins.getFlake ("git+file://" + toString ./.)).packages.${builtins.currentSystem}.t3code-jj.override { pnpmHash = ""; }).pnpmDeps' >"$nix_log" 2>&1 || true
		new_hash="$(sed -nE 's/^[[:space:]]*got:[[:space:]]*(sha256-[A-Za-z0-9+/=]+)[[:space:]]*$/\1/p' "$nix_log" | tail -n 1)"
		if [ -z "$new_hash" ]; then
			cat "$nix_log" >&2
			die "failed to compute pnpmDeps hash"
		fi
	else
		# pnpmDeps includes a hash of pnpm-lock.yaml, pnpm-workspace.yaml,
		# .pnpmfile.cjs, pnpmWorkspaces, and pnpm.version in its FOD name, so
		# unchanged inputs hit the Nix store cache while any change forces a
		# fresh fetch instead of masking a stale pnpmHash.
		if nix build --no-link .#t3code-jj.pnpmDeps >"$nix_log" 2>&1; then
			new_hash="$old_hash"
		else
			new_hash="$(sed -nE 's/^[[:space:]]*got:[[:space:]]*(sha256-[A-Za-z0-9+/=]+)[[:space:]]*$/\1/p' "$nix_log" | tail -n 1)"
			if [ -z "$new_hash" ]; then
				cat "$nix_log" >&2
				die "failed to verify pnpmDeps hash"
			fi
		fi
	fi
	if [ "$new_hash" = "$old_hash" ]; then
		log "nix/package.nix pnpmHash is up to date"
	else
		log "updating pnpmHash in nix/package.nix: ${old_hash} -> ${new_hash}"
		OLD="$old_hash" NEW="$new_hash" perl -pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/g' nix/package.nix
		nix build --no-link .#t3code-jj.pnpmDeps
		if [ "$(jj log --no-graph -r '@' -T 'commit_id')" = "$(jj log --no-graph -r "$main_branch" -T 'commit_id')" ]; then
			log "updated pnpmHash directly in bookmark '${main_branch}'"
		else
			jj squash --into "$main_branch"
			log "squashed updated pnpmHash into bookmark '${main_branch}'"
		fi
	fi
	rm -f "$nix_log"
	trap - EXIT
fi

if ((do_push)); then
	mapfile -t push_bookmarks < <(jj bookmark list -r "${sync_branch}::${main_branch}" -T 'if(!remote, name ++ "\n")')
	((${#push_bookmarks[@]} > 0)) || die "no local bookmarks found in ${sync_branch}::${main_branch}"
	push_args=()
	for bm in "${push_bookmarks[@]}"; do
		[ -n "$bm" ] || continue
		push_args+=(--bookmark "$bm")
	done
	log "pushing bookmarks (${push_bookmarks[*]}) to '${origin_remote}'"
	jj git push --remote "$origin_remote" "${push_args[@]}"
fi
