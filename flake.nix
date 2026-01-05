{
  description = "photodrop";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        securityDeps = with pkgs; [
          gitleaks
        ];

        shellDeps =
          with pkgs;
          [
            nodejs_22
            nodePackages.npm
          ]
          ++ securityDeps;
      in
      {
        apps.secrets-scan = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-secrets-scan" ''
            export PATH="${pkgs.lib.makeBinPath securityDeps}:$PATH"
            echo "Running secrets scan with gitleaks..."
            gitleaks detect --verbose --config .gitleaks.toml
          '';
        };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = shellDeps;

          shellHook = ''
            echo "PhotoDrop development environment"
            echo "  Node: $(node --version)"
            echo "  npm: $(npm --version)"
            echo "  gitleaks: $(gitleaks version)"
            echo ""
            echo "Available commands:"
            echo "  nix run .#secrets-scan - Run secrets scanning"
          '';
        };
      }
    );
}
