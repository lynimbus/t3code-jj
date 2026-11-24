{
  lib,
  stdenv,
  rustPlatform,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpmBuildHook,
  pnpm_12,
  nodejs_26,
  node-gyp,
  electron_44,
  cctools,
  copyDesktopItems,
  makeDesktopItem,
  makeBinaryWrapper,
  installShellFiles,
  jq,
  libicns,
  pkg-config,
  python3,
  cacert,
  libsecret,
  spdx-license-list-data,
  writeDarwinBundle,
  xcbuild,
  cloudflared,
  codex,
  gh,
  git,
  jujutsu,
  src,
  rev ? "dirty",
  pnpmHash ? "sha256-k2/mj7fwcp3QIdH0VqrI9ubwwGma7+xPjVaTL51aGXo=",
  extraRuntimePackages ? [ ],
}:

let
  baseVersion = (builtins.fromJSON (builtins.readFile "${src}/apps/desktop/package.json")).version;
  version = "${baseVersion}-jj.${rev}";
  appName = "T3 Code (Beta)";
  electron = electron_44;
  nodejs = nodejs_26;
  pnpm = pnpm_12;
  pnpmWorkspaces = [
    "@t3tools/monorepo"
    "t3..."
    "@t3tools/desktop..."
    "@t3tools/scripts..."
  ];
  pnpmFetcherVersion = 5;
  # Key the FOD name on dependency-resolution inputs so Nix never reuses a
  # stale cached t3code-pnpm-deps store path when pnpm-lock.yaml or pnpm changes.
  pnpmDepsInputHash = builtins.substring 0 12 (
    builtins.hashString "sha256" (
      builtins.concatStringsSep "\n" [
        (builtins.hashFile "sha256" "${src}/pnpm-lock.yaml")
        (builtins.hashFile "sha256" "${src}/pnpm-workspace.yaml")
        (builtins.hashFile "sha256" "${src}/.pnpmfile.cjs")
        (builtins.concatStringsSep "," pnpmWorkspaces)
        pnpm.version
        (toString pnpmFetcherVersion)
      ]
    )
  );
  desktopIcon =
    if stdenv.hostPlatform.isDarwin then
      "assets/prod/black-macos-1024.png"
    else
      "assets/prod/black-universal-1024.png";
  supportedPlatforms = [
    "aarch64-darwin"
    "aarch64-linux"
    "x86_64-darwin"
    "x86_64-linux"
  ];

  resourceMonitor = rustPlatform.buildRustPackage {
    pname = "t3code-resource-monitor";
    inherit version;

    src = "${src}/native/resource-monitor";
    cargoLock.lockFile = "${src}/native/resource-monitor/Cargo.lock";

    meta = {
      description = "Native resource diagnostics sidecar for T3 Code";
      homepage = "https://t3.codes";
      changelog = "https://github.com/lynimbus/t3code-jj/commits/jj";
      license = lib.licenses.mit;
      platforms = supportedPlatforms;
      mainProgram = "t3-resource-monitor";
    };
  };

  # t3code-jj requires jj >= 0.46.0; skip older nixpkgs builds (e.g. 26.05-darwin)
  # so a newer user-installed jj on PATH is not shadowed.
  runtimePackages = [
    codex
    gh
    git
  ]
  ++ lib.optionals (lib.versionAtLeast jujutsu.version "0.46.0") [ jujutsu ]
  ++ extraRuntimePackages;

  wrapperArgs = [
    "--prefix"
    "PATH"
    ":"
    (lib.makeBinPath runtimePackages)
    "--set-default"
    "T3CODE_CLOUDFLARED_PATH"
    (lib.getExe cloudflared)
    "--set-default"
    "T3CODE_RESOURCE_MONITOR_PATH"
    (lib.getExe resourceMonitor)
  ];
in
stdenv.mkDerivation {
  pname = "t3code";
  inherit version src;

  strictDeps = true;
  __structuredAttrs = true;

  postPatch = ''
    substituteInPlace apps/web/vite.config.ts \
      --replace-fail 'const host = explicitHost || "localhost";' \
                     'const host = explicitHost || "127.0.0.1";'

    mkdir -p .generated/third-party-licenses/spdx/v3.28.0
    cp ${spdx-license-list-data.json}/json/details/*.json \
      .generated/third-party-licenses/spdx/v3.28.0
  '';

  nativeBuildInputs = [
    cacert
    installShellFiles
    jq
    makeBinaryWrapper
    node-gyp
    nodejs
    pnpm
    pnpmBuildHook
    pnpmConfigHook
    python3
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    copyDesktopItems
    pkg-config
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [
    cctools.libtool
    libicns
    writeDarwinBundle
    xcbuild
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ libsecret ];

  inherit pnpmWorkspaces;

  pnpmDeps = fetchPnpmDeps {
    inherit
      pnpm
      pnpmWorkspaces
      src
      version
      ;
    pname = "t3code-${pnpmDepsInputHash}";
    fetcherVersion = pnpmFetcherVersion;
    hash = pnpmHash;
  };

  preBuild = ''
    export pnpm_config_verify_deps_before_run=false

    node scripts/update-release-package-versions.ts ${version}

    export npm_config_nodedir=${nodejs}
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    pnpm rebuild --pending "''${pnpmInstallFlags[@]}" --filter '!@t3tools/monorepo'
  '';

  pnpmBuildScript = "build:desktop";

  postBuild = ''
    pnpm vp cache clean
  '';

  dontPatchELF = true;
  noAuditTmpdir = true;

  installPhase = ''
    runHook preInstall

    mkdir --parents "$out"/libexec/t3code/apps/desktop "$out"/libexec/t3code/apps/server
    cp --recursive --no-preserve=mode node_modules "$out"/libexec/t3code
    cp --recursive --no-preserve=mode apps/server/{node_modules,dist} "$out"/libexec/t3code/apps/server
    cp --recursive --no-preserve=mode \
      apps/desktop/{node_modules,dist-electron} \
      "$out"/libexec/t3code/apps/desktop

    jq '.name = "t3code" | del(.productName)' apps/desktop/package.json \
      > "$out"/libexec/t3code/apps/desktop/package.json

    mkdir --parents "$out"/libexec/t3code/apps/desktop/prod-resources
    install --mode=444 ${desktopIcon} \
      "$out"/libexec/t3code/apps/desktop/prod-resources/icon.png
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    install -Dm755 \
      native/browser-secret/build/${stdenv.hostPlatform.node.arch}/t3-browser-secret \
      "$out"/libexec/t3code/apps/desktop/prod-resources/browser-secret/t3-browser-secret
  ''
  + ''

    find "$out"/libexec/t3code -xtype l -delete

    makeWrapper ${lib.getExe nodejs} "$out"/bin/t3 \
      --add-flags "$out"/libexec/t3code/apps/server/dist/bin.mjs \
      ${lib.escapeShellArgs wrapperArgs}

    makeWrapper ${lib.getExe electron} "$out"/bin/t3code-desktop \
      --add-flags "$out"/libexec/t3code/apps/desktop \
      --inherit-argv0 \
      ${lib.escapeShellArgs wrapperArgs}
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''

    # node-pty tries to chmod this helper at runtime, but the Nix store is immutable.
    find "$out"/libexec/t3code \
      -path '*/node-pty/prebuilds/darwin-*/spawn-helper' \
      -exec chmod 755 {} +

    mkdir --parents "$out/Applications/${appName}.app/Contents/"{MacOS,Resources}
    png2icns \
      "$out/Applications/${appName}.app/Contents/Resources/t3code.icns" \
      ${desktopIcon}

    # writeDarwinBundle is shebangless; invoke via stdenv.shell to avoid ENOEXEC on Darwin.
    ${stdenv.shell} ${lib.getExe writeDarwinBundle} \
      "$out" "${appName}" t3code-desktop t3code
  ''
  + ''

    mkdir --parents \
      "$out"/share/icons/hicolor/{1024x1024,scalable}/apps
    install --mode=444 ${desktopIcon} \
      "$out"/share/icons/hicolor/1024x1024/apps/t3code.png
    install --mode=444 assets/prod/logo.svg \
      "$out"/share/icons/hicolor/scalable/apps/t3code.svg

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    for shell in bash fish zsh; do
      installShellCompletion --cmd t3 --"$shell" <("$out/bin/t3" --completions "$shell")
    done
  '';

  postFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    for module in "$out"/libexec/t3code/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/linux-${stdenv.hostPlatform.node.arch}/pty.node; do
      patchelf --add-rpath ${lib.makeLibraryPath [ stdenv.cc.cc.lib ]} "$module"
    done
  '';

  desktopItems = lib.optionals stdenv.hostPlatform.isLinux [
    (makeDesktopItem {
      name = "t3code";
      desktopName = appName;
      comment = "Minimal web GUI for coding agents";
      exec = "t3code-desktop %U";
      terminal = false;
      icon = "t3code";
      startupWMClass = "t3code";
      categories = [ "Development" ];
    })
  ];

  passthru = {
    inherit resourceMonitor pnpmHash;
  };

  meta = {
    description = "Minimal web GUI for coding agents (Jujutsu-enabled fork)";
    homepage = "https://github.com/lynimbus/t3code-jj";
    changelog = "https://github.com/lynimbus/t3code-jj/commits/jj";
    license = lib.licenses.mit;
    mainProgram = "t3code-desktop";
    platforms = supportedPlatforms;
  };
}
