{
  description = "T3 Code with native Jujutsu (jj) support";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # nixpkgs unstable no longer supports Intel macOS. Keep using the final
    # Darwin branch that does so for x86_64-darwin outputs.
    nixpkgs-darwin-x64.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-darwin-x64,
    }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      nixpkgsFor = system: if system == "x86_64-darwin" then nixpkgs-darwin-x64 else nixpkgs;
      rev = self.shortRev or self.dirtyShortRev or "dirty";

      mkPackage =
        pkgs:
        pkgs.callPackage ./nix/package.nix {
          src = self;
          inherit rev;
        };

      mkModule =
        target:
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.t3code-jj;
        in
        {
          options.programs.t3code-jj = {
            enable = lib.mkEnableOption "T3 Code (Jujutsu-enabled fork)";
            package = lib.mkOption {
              type = lib.types.package;
              default = mkPackage pkgs;
              defaultText = lib.literalExpression "inputs.t3code-jj.packages.\${pkgs.stdenv.hostPlatform.system}.default";
              description = "The t3code-jj package to install.";
            };
          };

          config = lib.mkIf cfg.enable (
            if target == "home" then
              { home.packages = [ cfg.package ]; }
            else
              { environment.systemPackages = [ cfg.package ]; }
          );
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import (nixpkgsFor system) { inherit system; };
          t3code-jj = mkPackage pkgs;
        in
        {
          inherit t3code-jj;
          default = t3code-jj;
          t3code-resource-monitor = t3code-jj.resourceMonitor;
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/t3code-desktop";
          meta.description = "T3 Code (Jujutsu-enabled fork)";
        };
        t3code-jj = self.apps.${system}.default;
        t3 = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/t3";
          meta.description = "T3 Code server CLI (Jujutsu-enabled fork)";
        };
      });

      overlays.default = final: _prev: {
        t3code-jj = mkPackage final;
      };

      nixosModules = rec {
        t3code-jj = mkModule "nixos";
        default = t3code-jj;
      };

      darwinModules = rec {
        t3code-jj = mkModule "darwin";
        default = t3code-jj;
      };

      homeModules = rec {
        t3code-jj = mkModule "home";
        default = t3code-jj;
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = import (nixpkgsFor system) { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_26
              pnpm_12
              git
              jujutsu
              cargo
              rustc
              pkg-config
              python3
              shellcheck
              nixfmt
            ];
          };
        }
      );

      formatter = forAllSystems (system: (nixpkgsFor system).legacyPackages.${system}.nixfmt-tree);
    };
}
