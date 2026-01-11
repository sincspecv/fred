# Flox Development Environment

Fred includes Flox configuration for consistent, reproducible development environments across all contributors and machines.

## What is Flox?

Flox is a package manager and development environment tool built on Nix that provides:

- **Reproducible environments**: Same tools and versions for everyone
- **Easy onboarding**: New contributors can get started with one command
- **Isolated environments**: No conflicts with system packages
- **Team consistency**: Share environments via FloxHub

## Installation

### Install Flox

Follow the [official Flox installation guide](https://flox.dev/docs/install-flox/install/):

```bash
# macOS (using Homebrew - recommended)
brew install flox

# Linux (using package manager - recommended)
# Check your distribution's package manager or use the official installer

# Linux (manual installation - safer than pipe-to-shell)
# 1. Download the installer script
curl -fsSL https://flox.dev/install -o /tmp/flox-install.sh

# 2. Review the script contents
cat /tmp/flox-install.sh

# 3. If satisfied, execute it
bash /tmp/flox-install.sh

# Or use Nix
nix profile install --experimental-features "nix-command flakes" \
  --accept-flake-config 'github:flox/flox/latest'
```

**Security Note**: Avoid piping downloads directly to shell (`curl | bash`). Always download, review, then execute installation scripts to prevent remote code execution risks from compromised downloads or MITM attacks.

## Using Flox with Fred

### Activating the Development Environment

In the Fred repository root:

```bash
# Activate the Flox environment
flox activate
```

This will:
- Provide Bun (latest version)
- Set up essential development tools
- Configure environment variables
- Display a welcome message with available commands

### Working in the Environment

Once activated, you can use all standard commands:

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Run tests
bun test

# Start dev server
bun run dev

# Run golden trace tests
fred test
```

### Exiting the Environment

To exit the Flox environment:

```bash
exit
```

Or press `Ctrl+D`.

## Flox Configuration

The Fred repository includes a `flox.nix` file that defines the development environment:

```nix
{
  packages.builtins = [
    "bashInteractive"
    "git"
    "curl"
  ];
  
  packages.nixpkgs-flox = {
    bun = "latest";
  };
  
  environmentVariables = {
    NODE_ENV = "development";
  };
  
  shellHook = ''
    echo "🐰 Fred development environment activated"
    echo "Bun version: $(bun --version)"
  '';
}
```

### Customizing the Environment

You can modify `flox.nix` to add additional tools or packages:

```nix
packages.nixpkgs-flox = {
  bun = "latest";
  nodejs = "20";  # Add Node.js if needed
  # Add other packages as needed
};
```

After modifying `flox.nix`, reactivate the environment:

```bash
flox activate
```

## Projects Created with create-fred

Projects generated with `create-fred` automatically include a `flox.nix` file, providing the same consistent development environment for your Fred projects.

### Using Flox in Your Project

```bash
cd my-fred-project

# Activate Flox environment
flox activate

# Install dependencies
bun install

# Start development
bun run dev
```

## Benefits

### For Contributors

- **Consistent setup**: Everyone has the same Bun version
- **Easy onboarding**: New contributors can start immediately
- **No conflicts**: Isolated from system packages
- **Reproducible builds**: Same environment = same results

### For Teams

- **Shared environments**: Use FloxHub to share environments
- **Version control**: Environment is versioned with your code
- **CI/CD ready**: Same environment in CI as locally

## Troubleshooting

### Flox not found

If `flox` command is not found:

1. Verify Flox is installed: `which flox`
2. Check your PATH includes Flox
3. Restart your terminal after installation

### Environment not activating

If `flox activate` doesn't work:

1. Ensure you're in the repository root (where `flox.nix` exists)
2. Check `flox.nix` syntax is valid
3. Try `flox init` to reinitialize if needed

### Bun version mismatch

If you see version issues:

1. The Flox environment provides Bun automatically
2. Don't use system Bun when in Flox environment
3. Verify with `which bun` (should point to Flox-provided Bun)

## Alternatives

Flox is **optional**. You can still:

- Use Bun directly from [bun.sh](https://bun.sh)
- Use system package managers
- Use other environment managers (nvm, asdf, etc.)

Flox simply provides additional consistency and reproducibility.

## Additional Resources

- [Flox Documentation](https://flox.dev/docs/)
- [FloxHub](https://flox.dev/floxhub/) - Share environments with your team
- [Nix Package Manager](https://nixos.org/) - Underlying technology
