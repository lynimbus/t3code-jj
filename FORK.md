# T3 Code (Jujutsu Fork)

This repository is a separately maintained fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) that adds native [Jujutsu (`jj`)](https://martinvonz.github.io/jj/) support, kept rebased on top of upstream `main` until official `jj` support lands upstream (tracked in [Discussion #18468](https://github.com/pingdotgg/t3code/discussions/18468)).

## What's included

The Jujutsu implementation originates from `THEjacob1000/t3code`'s PR stack (`#20749`–`#20756`) and covers:

- `jj` VCS driver, nearest-marker detection, process wrapper, and version check (`>= 0.46.0`)
- `jj`-native turn checkpoints (`refs/t3/*`) and review diffs
- `jj` status, bookmarks, workspaces, and remotes routed by VCS kind
- Shared `ChangeRequestStep` and `jj` commit, push, pull, PR create/checkout, and stacked actions
- Web and mobile `jj` terminology, fallback notices, unsupported-repository handling, and shared VCS actions
- Colocated `jj`-first repository detection

See [docs/internals/jujutsu.md](docs/internals/jujutsu.md) for the full design constraints and invariants.

## Branch / bookmark layout

This checkout is colocated (`jj` + `git`) and uses a `jj` **Megamerge** bookmark layout:

- **`sync`** — clean fast-forward mirror of `upstream/main` (`pingdotgg/t3code`). Never commit fork changes here.
- **Feature bookmarks (`feat/*`)** — isolated, upstream-PR-ready or fork-specific feature branches derived directly from `sync`:
  - `feat/jj-support` → `feat(vcs): add native Jujutsu (jj) support` (pure feature commit, no fork-only files)
  - `feat/disable-all-telemetry` → `feat(telemetry): disable all telemetry uploads at composition boundaries` (minimal boundary overrides + fork-only no-op service/tests)
- **`main`** — the integrated default branch of this fork. Aggregates all active feature bookmarks via a `jj` Megamerge and holds fork-only infrastructure (`FORK.md`, `scripts/fork-sync.sh`, `justfile`, `flake.nix`, `flake.lock`, `nix/package.nix`) at its tip.

Keeping fork maintenance files on `main` (separate from feature bookmarks and upstream-owned files) minimizes rebase conflicts against a fast-moving upstream and keeps every feature bookmark cleanly submittable upstream.

### Minimizing sync friction (`feat/*` guidelines)

To keep `just sync` low-conflict as more `feat/*` bookmarks accumulate:

1. **Swap at composition boundaries instead of rewriting upstream implementations.** Put fork implementations in new files (e.g., `NoopAnalyticsService.ts`) and wire them at the app boundary (`server.ts`, `runtime.ts`) rather than deleting upstream service bodies (`AnalyticsService.ts`).
2. **Prefer new fork-only test files over rewriting upstream tests.** Keeping upstream helpers and their unit tests intact avoids delete/modify conflicts every time upstream adjusts those modules.
3. **Avoid high-churn hub files when a lower-churn leaf/config works.** For example, setting `app.config.ts` and `observe.ts` disables mobile tracing and crash reporting without touching `tracing.ts`, `RenderErrorBoundary.tsx`, or `connection/platform.ts`, and short-circuiting `readClientOwnerParams` avoids touching both web and mobile `platform.ts`.
4. **Use small guards over deleting blocks.** When an upstream file must be modified, keep surrounding upstream code intact so 3-way merge resolves upstream changes cleanly.
5. **Keep each `feat/*` orthogonal and single-purpose.** Independent features off `sync` rarely overlap in the Megamerge and can be dropped cleanly once merged upstream.

### Repo-local `jj` config

Because `main` is a mutable integrated fork branch rather than upstream trunk, point `trunk()` at `main@upstream` so `jj` does not treat `main@origin` as immutable:

```bash
jj config set --repo "revset-aliases.'trunk()'" 'main@upstream'
```

### Adding or dropping a feature in `main`

```bash
# Add a new feature off sync and merge it into main
jj new sync -m "feat(...): ..."
jj bookmark create feat/x -r @
jj rebase -r main -d 'parents(main) | feat/x'

# Drop a feature (e.g. after upstream merges it)
jj rebase -r main -d 'parents(main) ~ feat/x'
jj bookmark delete feat/x
```

## Connecting to your GitHub fork

Once you create your fork of `pingdotgg/t3code` on GitHub (for example `lynimbus/t3code-jj`):

```bash
git remote add origin https://github.com/<owner>/<repo>.git
jj git fetch --remote origin
jj bookmark track main --remote origin
jj git push --remote origin --bookmark sync --bookmark feat/jj-support --bookmark main
```

With `main` as the integrated fork branch, GitHub's default branch already points to the full fork — no branch override needed for clones or Nix flakes.

## Syncing with upstream

Run the bundled `jj`-native sync script (or `just sync`):

```bash
./scripts/fork-sync.sh                             # fetch upstream/main, fast-forward sync, rebase features + main
./scripts/fork-sync.sh --verify                    # also run typecheck + focused jj/vcs tests
./scripts/fork-sync.sh --verify --update-nix --push # full sync (same as `just sync`): verify, refresh Nix pnpmHash, and push
```

If upstream changes conflict with a feature commit or `main`, `jj` records the conflicts in place without losing history:

```bash
jj new <change_id>                     # create a resolution commit on top of the conflicted change
jj resolve --list -r <change_id>       # inspect conflicted files
# edit conflicted files, then:
jj squash                              # fold resolution back into the conflicted change
jj new main                            # return working copy to main
just sync                              # or: ./scripts/fork-sync.sh --verify --update-nix --push
```

## Verifying manually

```bash
pnpm install --frozen-lockfile
pnpm exec vp run \
  --filter @t3tools/contracts \
  --filter @t3tools/shared \
  --filter @t3tools/client-runtime \
  --filter t3 \
  --filter @t3tools/web \
  --filter @t3tools/mobile \
  typecheck

pnpm exec vp test run \
  apps/server/src/jj/ \
  apps/server/src/vcs/ \
  apps/server/src/git/GitManager.test.ts \
  apps/server/src/git/GitWorkflowService.test.ts \
  apps/server/src/checkpointing/CheckpointStore.test.ts \
  apps/server/src/review/ReviewService.test.ts \
  apps/server/src/mcp/toolkits/project/handlers.test.ts \
  apps/web/src/state/vcs.terminology.test.ts \
  apps/mobile/src/features/threads/git/GitBranchesSheet.test.tsx \
  apps/mobile/src/features/threads/git/GitConfirmSheet.test.tsx \
  packages/contracts/src/git.test.ts \
  packages/shared/src/git.test.ts \
  packages/shared/src/vcs.test.ts \
  packages/client-runtime/src/state/gitActions.test.ts \
  packages/client-runtime/src/state/gitActions.matrix.test.ts
```

> Note: if your global Git config sets `fetch.prune = true`, `GitVcsDriverCore.test.ts` (`fetches the selected worktree base for Changes`) needs `GIT_CONFIG_GLOBAL=/dev/null` or `fetch.prune=false`.

## Consuming from Nix (Flake)

This repository ships a self-contained Nix flake (`flake.nix`, `nix/package.nix`) supporting `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, and `x86_64-darwin` (using `nixpkgs-26.05-darwin` for Intel macOS), exporting:

- `packages.<system>.{default,t3code-jj,t3code-resource-monitor}`
- `apps.<system>.{default,t3code-jj,t3}`
- `overlays.default` (provides `pkgs.t3code-jj`)
- `nixosModules.{default,t3code-jj}` (`programs.t3code-jj.enable = true`)
- `darwinModules.{default,t3code-jj}` (`programs.t3code-jj.enable = true`)
- `homeModules.{default,t3code-jj}` (`programs.t3code-jj.enable = true`)
- `devShells.<system>.default`

Add it as a flake input so `nix flake update` updates `t3code-jj` automatically without manual `bump` pins:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    t3code-jj = {
      url = "github:lynimbus/t3code-jj";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, t3code-jj, ... }: {
    # Option A: overlay (exposes pkgs.t3code-jj)
    # overlays = [ t3code-jj.overlays.default ];

    # Option B: NixOS or Home Manager module
    # modules = [ t3code-jj.nixosModules.default ]; # or homeModules.default
    # programs.t3code-jj.enable = true;
  };
}
```

`t3code-resource-monitor` reads `native/resource-monitor/Cargo.lock` directly (no `cargoHash` to maintain). `pnpmDeps` keys its fixed-output derivation name on `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `pnpmWorkspaces`, and `pnpm.version`, so cached store paths cannot mask a stale `pnpmHash`. Run `./scripts/fork-sync.sh --update-nix` (included in `just sync`) to verify and refresh `pnpmHash` automatically, or `--force-update-nix` to force a fresh fetch even when those inputs are unchanged.

## Credits & License

- Upstream: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) (MIT License; see [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md)).
- Jujutsu support authors: Jacob Sanderson (`THEjacob1000`), Лев Федорец, and Omar Shaarawi.
