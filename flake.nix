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

        deps = with pkgs; [
          nodejs_22
          nodePackages.npm
          nodePackages.wrangler
          openssl
          jq
          gitleaks
        ];

        dev = pkgs.writeShellScriptBin "dev" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          cleanup() {
            echo ""
            echo "Shutting down..."
            kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
            wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
            exit 0
          }
          trap cleanup INT TERM

          # Auto-setup if needed
          if [ ! -f backend/.dev.vars ]; then
            echo "First run - generating secrets..."
            ./scripts/setup.sh dev
            echo ""
          fi

          # Install dependencies if needed
          [ ! -d "backend/node_modules" ] && (cd backend && npm install)
          [ ! -d "frontend/node_modules" ] && (cd frontend && npm install)

          # Run migrations
          echo "Running migrations..."
          (cd backend && echo "y" | npx wrangler d1 migrations apply photodrop-db --local)
          echo ""

          # Start servers
          echo "Starting servers..."
          (cd backend && npm run dev) &
          BACKEND_PID=$!
          (cd frontend && npm run dev) &
          FRONTEND_PID=$!

          echo ""
          echo "Ready: http://localhost:5173"
          echo "Press Ctrl+C to stop"
          echo ""

          wait $BACKEND_PID $FRONTEND_PID
        '';

        test = pkgs.writeShellScriptBin "test" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          echo "Running unit tests..."
          echo ""

          cd backend
          npm ci
          npm run test:run
          cd ..

          echo ""
          cd frontend
          npm ci
          npm run test:run
          cd ..

          echo ""
          echo "All tests passed!"
        '';

        test-e2e = pkgs.writeShellScriptBin "test-e2e" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          echo "Running E2E tests..."
          echo ""

          [ ! -d "node_modules" ] && npm install
          [ ! -d "backend/node_modules" ] && (cd backend && npm install)
          [ ! -d "frontend/node_modules" ] && (cd frontend && npm install)

          if [ ! -f backend/.dev.vars ]; then
            echo "Generating dev secrets..."
            ./scripts/setup.sh dev
            echo ""
          fi

          echo "Running database migrations..."
          (cd backend && echo "y" | npx wrangler d1 migrations apply photodrop-db --local)
          echo ""

          if [ ! -d "$HOME/.cache/ms-playwright" ]; then
            echo "Installing Playwright browsers..."
            npx playwright install chromium
            echo ""
          fi

          npx playwright test "$@"
        '';

        check = pkgs.writeShellScriptBin "check" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          echo "Running lint and format checks..."
          echo ""

          cd backend
          npm ci
          npm run format
          npm run lint
          cd ..

          echo ""
          cd frontend
          npm ci
          npm run format
          npm run lint
          cd ..

          echo ""
          echo "All checks passed!"
        '';

        fix = pkgs.writeShellScriptBin "fix" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          echo "Fixing lint and format issues..."
          echo ""

          cd backend
          npm ci
          npm run format:fix
          npm run lint:fix
          cd ..

          echo ""
          cd frontend
          npm ci
          npm run format:fix
          npm run lint:fix
          cd ..

          echo ""
          echo "All fixes applied!"
        '';

        build = pkgs.writeShellScriptBin "build" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          echo "Building frontend..."
          cd frontend
          npm ci
          npm run build

          echo ""
          echo "Build successful!"
        '';

        deploy = pkgs.writeShellScriptBin "deploy" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          ./scripts/deploy.sh
        '';

        setup-prod = pkgs.writeShellScriptBin "setup-prod" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          ./scripts/setup.sh prod
        '';

        create-group = pkgs.writeShellScriptBin "create-group" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          if [ "$#" -lt 3 ]; then
            echo "Usage: nix run .#create-group -- <group_name> <owner_name> <owner_email> [--remote]"
            echo "Example: nix run .#create-group -- \"Family Photos\" \"Tom\" \"tom@example.com\""
            exit 1
          fi
          ./scripts/create-group.sh "$@"
        '';

        db-seed = pkgs.writeShellScriptBin "db-seed" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          set -e

          cd backend

          echo "Running migrations..."
          echo "y" | npx wrangler d1 migrations apply photodrop-db --local

          echo "Seeding test data..."
          npx wrangler d1 execute photodrop-db --local --file=scripts/seed-test-data.sql

          echo ""
          echo "Test users created:"
          echo "  owner@test.com (owner)"
          echo "  member@test.com (member)"
        '';

        secrets-scan = pkgs.writeShellScriptBin "secrets-scan" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          echo "Running secrets scan with gitleaks..."
          gitleaks detect --verbose --config .gitleaks.toml
        '';

        dev-kill = pkgs.writeShellScriptBin "dev-kill" ''
          echo "Stopping all dev servers..."
          pkill -f "wrangler dev" 2>/dev/null || true
          pkill -f "vite" 2>/dev/null || true
          echo "All dev servers stopped"
        '';

        teardown-dev = pkgs.writeShellScriptBin "teardown-dev" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          ./scripts/teardown.sh dev
        '';

        teardown-prod = pkgs.writeShellScriptBin "teardown-prod" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          ./scripts/teardown.sh prod
        '';

        teardown = pkgs.writeShellScriptBin "teardown" ''
          export PATH="${pkgs.lib.makeBinPath deps}:$PATH"
          ./scripts/teardown.sh all
        '';
      in
      {
        apps.dev = flake-utils.lib.mkApp { drv = dev; };
        apps.test = flake-utils.lib.mkApp { drv = test; };
        apps.test-e2e = flake-utils.lib.mkApp { drv = test-e2e; };
        apps.check = flake-utils.lib.mkApp { drv = check; };
        apps.fix = flake-utils.lib.mkApp { drv = fix; };
        apps.build = flake-utils.lib.mkApp { drv = build; };
        apps.deploy = flake-utils.lib.mkApp { drv = deploy; };
        apps.setup-prod = flake-utils.lib.mkApp { drv = setup-prod; };
        apps.create-group = flake-utils.lib.mkApp { drv = create-group; };
        apps.db-seed = flake-utils.lib.mkApp { drv = db-seed; };
        apps.secrets-scan = flake-utils.lib.mkApp { drv = secrets-scan; };
        apps.dev-kill = flake-utils.lib.mkApp { drv = dev-kill; };
        apps.teardown-dev = flake-utils.lib.mkApp { drv = teardown-dev; };
        apps.teardown-prod = flake-utils.lib.mkApp { drv = teardown-prod; };
        apps.teardown = flake-utils.lib.mkApp { drv = teardown; };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = deps ++ [
            dev
            test
            test-e2e
            check
            fix
            build
            deploy
            setup-prod
            create-group
            db-seed
            secrets-scan
            dev-kill
            teardown-dev
            teardown-prod
            teardown
          ];
        };
      }
    );
}
