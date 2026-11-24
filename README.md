# t3code-jj

An **unofficial**, independently maintained fork based on the [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) source code. This project is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

## Differences from upstream

- **Native Jujutsu (`jj`) support (`>= 0.46.0`)** — colocated `jj`-first detection, `jj` workspaces, bookmarks, turn checkpoints, review diffs, and commit/push/PR workflows (`feat/jj-support`).
- **Telemetry disabled** — all telemetry uploads disabled across server, desktop, web, and mobile (`feat/disable-all-telemetry`).
- **Nix flake included** — packages, apps, overlay, NixOS / nix-darwin / Home Manager modules (`programs.t3code-jj.enable = true`), and dev shell for `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, and `x86_64-darwin`.

## Quick start

### Nix (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, `x86_64-darwin`)

Run directly:

```bash
nix run github:lynimbus/t3code-jj
```

Or add to your `flake.nix`:

```nix
{
  inputs.t3code-jj = {
    url = "github:lynimbus/t3code-jj";
    inputs.nixpkgs.follows = "nixpkgs";
  };
}
```

Then enable `t3code-jj.nixosModules.default`, `t3code-jj.darwinModules.default`, or `t3code-jj.homeModules.default` with `programs.t3code-jj.enable = true;`, or use `t3code-jj.overlays.default` (`pkgs.t3code-jj`).

### From source

```bash
pnpm install --frozen-lockfile
pnpm exec vp run dev
```

## Syncing with upstream

This repository uses a `jj` Megamerge layout (`sync` + `feat/*` → `main`). To rebase onto upstream `main`, verify, refresh Nix hashes, and push:

```bash
just sync
# or: ./scripts/fork-sync.sh --verify --update-nix --push
```

See [`FORK.md`](./FORK.md) for the full branch layout, conflict resolution, and test commands, and [`docs/README.md`](./docs/README.md) for upstream documentation.

## License & Trademarks

Source code is licensed under the [MIT License](./LICENSE). Upstream names, logos, and brand assets belong to T3 Tools, Inc. and are governed by [`TRADEMARK.md`](./TRADEMARK.md).
