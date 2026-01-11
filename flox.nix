{
  # Development environment for Fred framework
  # Provides a consistent, reproducible development environment for all contributors
  
  packages.builtins = [
    "bashInteractive"
    "git"
    "curl"
  ];
  
  packages.nixpkgs-flox = {
    bun = "1.3.5";
  };
  
  # Environment variables
  environmentVariables = {
    NODE_ENV = "development";
  };
  
  # Shell hook (runs when environment is activated)
  shellHook = ''
    echo "🐰 Fred development environment activated"
    echo "Bun version: $(bun --version)"
    echo ""
    echo "Available commands:"
    echo "  bun run dev      - Start dev chat"
    echo "  bun run server   - Start HTTP server"
    echo "  bun run build    - Build the project"
    echo "  bun test         - Run tests"
    echo "  fred test        - Run golden trace tests"
  '';
}
