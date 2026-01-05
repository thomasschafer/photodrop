{
  description = "PhotoDrop - Progressive Web App for privately sharing baby photos";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
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

        # Core dependencies for development
        coreDeps = with pkgs; [
          nodejs_22
          nodePackages.npm
          openssl
        ];

        # Security scanning tools
        securityDeps = with pkgs; [
          gitleaks
        ];

        # Deployment tools
        deployDeps = with pkgs; [
          nodePackages.wrangler
        ];

        # Test dependencies
        testDeps = coreDeps;

        # All shell dependencies
        shellDeps = coreDeps ++ securityDeps ++ deployDeps;
      in
      {
        # Security scanning
        apps.secrets-scan = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-secrets-scan" ''
            export PATH="${pkgs.lib.makeBinPath securityDeps}:$PATH"
            echo "🔍 Running secrets scan with gitleaks..."
            gitleaks detect --verbose --config .gitleaks.toml
          '';
        };

        # Run backend tests
        apps.test-backend = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-backend-tests" ''
            export PATH="${pkgs.lib.makeBinPath testDeps}:$PATH"
            set -e
            echo "🧪 Running backend tests..."
            cd backend
            npm ci
            npm run test:run
          '';
        };

        # Run frontend tests
        apps.test-frontend = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-frontend-tests" ''
            export PATH="${pkgs.lib.makeBinPath testDeps}:$PATH"
            set -e
            echo "🧪 Running frontend tests..."
            cd frontend
            npm ci
            npm run test:run
          '';
        };

        # Run all tests
        apps.test = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-all-tests" ''
            export PATH="${pkgs.lib.makeBinPath testDeps}:$PATH"
            set -e

            echo "🧪 Running all tests..."
            echo ""

            echo "Backend tests:"
            cd backend
            npm ci
            npm run test:run
            cd ..

            echo ""
            echo "Frontend tests:"
            cd frontend
            npm ci
            npm run test:run
            cd ..

            echo ""
            echo "✅ All tests passed!"
          '';
        };

        # Setup development environment
        apps.setup-dev = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-setup-dev" ''
            export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
            ./scripts/setup.sh dev
          '';
        };

        # Setup production environment
        apps.setup-prod = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-setup-prod" ''
            export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
            ./scripts/setup.sh prod
          '';
        };

        # Deploy to production
        apps.deploy = flake-utils.lib.mkApp {
          drv = pkgs.writeShellScriptBin "run-deploy" ''
            export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
            ./scripts/deploy.sh
          '';
        };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = shellDeps;
        };
      }
    );
}
