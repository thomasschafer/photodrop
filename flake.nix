{
  description = "PhotoDrop - Progressive Web App for privately sharing photos with a trusted group";

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
          jq
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

        # Create wrapper scripts for dev shell
        devScript = pkgs.writeShellScriptBin "dev" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          set -e

          cleanup() {
            echo ""
            echo "Shutting down dev servers..."
            kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
            wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
            exit 0
          }

          trap cleanup INT TERM

          echo "Starting PhotoDrop development servers..."
          echo ""

          echo "Checking backend dependencies..."
          cd backend
          if [ ! -d "node_modules" ]; then
            npm install
          fi
          cd ..

          echo "Checking frontend dependencies..."
          cd frontend
          if [ ! -d "node_modules" ]; then
            npm install
          fi
          cd ..

          echo ""
          echo "Starting backend (wrangler dev --remote)..."
          cd backend
          npm run dev &
          BACKEND_PID=$!
          cd ..

          echo "Starting frontend (vite)..."
          cd frontend
          npm run dev &
          FRONTEND_PID=$!
          cd ..

          echo ""
          echo "Both servers are running!"
          echo "Press Ctrl+C to stop both servers"
          echo ""

          wait $BACKEND_PID $FRONTEND_PID
        '';

        secrets-scan = pkgs.writeShellScriptBin "secrets-scan" ''
          export PATH="${pkgs.lib.makeBinPath securityDeps}:$PATH"
          echo "🔍 Running secrets scan with gitleaks..."
          gitleaks detect --verbose --config .gitleaks.toml
        '';

        test-backend = pkgs.writeShellScriptBin "test-backend" ''
          export PATH="${pkgs.lib.makeBinPath testDeps}:$PATH"
          set -e
          echo "🧪 Running backend tests..."
          cd backend
          npm ci
          npm run test:run
        '';

        test-frontend = pkgs.writeShellScriptBin "test-frontend" ''
          export PATH="${pkgs.lib.makeBinPath testDeps}:$PATH"
          set -e
          echo "🧪 Running frontend tests..."
          cd frontend
          npm ci
          npm run test:run
        '';

        test = pkgs.writeShellScriptBin "test" ''
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

        lint-backend = pkgs.writeShellScriptBin "lint-backend" ''
          export PATH="${pkgs.lib.makeBinPath coreDeps}:$PATH"
          set -e
          echo "🔍 Running backend linting..."
          cd backend
          npm ci
          npm run lint
        '';

        lint-frontend = pkgs.writeShellScriptBin "lint-frontend" ''
          export PATH="${pkgs.lib.makeBinPath coreDeps}:$PATH"
          set -e
          echo "🔍 Running frontend linting..."
          cd frontend
          npm ci
          npm run lint
        '';

        format-backend = pkgs.writeShellScriptBin "format-backend" ''
          export PATH="${pkgs.lib.makeBinPath coreDeps}:$PATH"
          set -e
          echo "🎨 Checking backend formatting..."
          cd backend
          npm ci
          npm run format
        '';

        format-frontend = pkgs.writeShellScriptBin "format-frontend" ''
          export PATH="${pkgs.lib.makeBinPath coreDeps}:$PATH"
          set -e
          echo "🎨 Checking frontend formatting..."
          cd frontend
          npm ci
          npm run format
        '';

        lint-and-format = pkgs.writeShellScriptBin "lint-and-format" ''
          export PATH="${pkgs.lib.makeBinPath coreDeps}:$PATH"
          set -e

          echo "🔍 Running lint and format checks..."
          echo ""

          echo "Backend formatting:"
          cd backend
          npm ci
          npm run format
          cd ..

          echo ""
          echo "Backend linting:"
          cd backend
          npm run lint
          cd ..

          echo ""
          echo "Frontend formatting:"
          cd frontend
          npm ci
          npm run format
          cd ..

          echo ""
          echo "Frontend linting:"
          cd frontend
          npm run lint
          cd ..

          echo ""
          echo "✅ All lint and format checks passed!"
        '';

        setup-dev = pkgs.writeShellScriptBin "setup-dev" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/setup.sh dev
        '';

        setup-prod = pkgs.writeShellScriptBin "setup-prod" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/setup.sh prod
        '';

        deploy = pkgs.writeShellScriptBin "deploy" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/deploy.sh
        '';

        dev-kill = pkgs.writeShellScriptBin "dev-kill" ''
          echo "Stopping all dev servers..."
          pkill -f "wrangler dev" 2>/dev/null || true
          pkill -f "vite" 2>/dev/null || true
          echo "✅ All dev servers stopped"
        '';

        teardown-dev = pkgs.writeShellScriptBin "teardown-dev" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/teardown.sh dev
        '';

        teardown-prod = pkgs.writeShellScriptBin "teardown-prod" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/teardown.sh prod
        '';

        teardown = pkgs.writeShellScriptBin "teardown" ''
          export PATH="${pkgs.lib.makeBinPath (coreDeps ++ deployDeps)}:$PATH"
          ./scripts/teardown.sh all
        '';
      in
      {
        # Security scanning
        apps.secrets-scan = flake-utils.lib.mkApp {
          drv = secrets-scan;
        };

        # Run backend tests
        apps.test-backend = flake-utils.lib.mkApp {
          drv = test-backend;
        };

        # Run frontend tests
        apps.test-frontend = flake-utils.lib.mkApp {
          drv = test-frontend;
        };

        # Run all tests
        apps.test = flake-utils.lib.mkApp {
          drv = test;
        };

        # Lint and format checks
        apps.lint-backend = flake-utils.lib.mkApp {
          drv = lint-backend;
        };

        apps.lint-frontend = flake-utils.lib.mkApp {
          drv = lint-frontend;
        };

        apps.format-backend = flake-utils.lib.mkApp {
          drv = format-backend;
        };

        apps.format-frontend = flake-utils.lib.mkApp {
          drv = format-frontend;
        };

        apps.lint-and-format = flake-utils.lib.mkApp {
          drv = lint-and-format;
        };

        # Setup development environment
        apps.setup-dev = flake-utils.lib.mkApp {
          drv = setup-dev;
        };

        # Setup production environment
        apps.setup-prod = flake-utils.lib.mkApp {
          drv = setup-prod;
        };

        # Deploy to production
        apps.deploy = flake-utils.lib.mkApp {
          drv = deploy;
        };

        # Stop all dev servers
        apps.dev-kill = flake-utils.lib.mkApp {
          drv = dev-kill;
        };

        # Teardown environments
        apps.teardown-dev = flake-utils.lib.mkApp {
          drv = teardown-dev;
        };

        apps.teardown-prod = flake-utils.lib.mkApp {
          drv = teardown-prod;
        };

        apps.teardown = flake-utils.lib.mkApp {
          drv = teardown;
        };

        # Run both frontend and backend dev servers
        apps.dev = flake-utils.lib.mkApp {
          drv = devScript;
        };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = shellDeps ++ [
            devScript
            secrets-scan
            test-backend
            test-frontend
            test
            lint-backend
            lint-frontend
            format-backend
            format-frontend
            lint-and-format
            setup-dev
            setup-prod
            deploy
            dev-kill
            teardown-dev
            teardown-prod
            teardown
          ];
        };
      }
    );
}
