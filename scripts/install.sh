#!/bin/sh
# install.sh — ByteRover CLI installer
# Usage: curl -fsSL https://storage.googleapis.com/brv-releases/install.sh | sh
#
# Environment variables:
#   BRV_INSTALL_DIR  Override install location (default: ~/.brv-cli)

set -eu

# ─── Constants ────────────────────────────────────────────────────────────────

BRV_INSTALL_DIR="${BRV_INSTALL_DIR:-$HOME/.brv-cli}"
GCS_BASE="https://storage.googleapis.com/brv-releases"
CHANNEL="stable"
BIN_DIR="$BRV_INSTALL_DIR/bin"

# ─── Colors (only when connected to a terminal) ──────────────────────────────

if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[32m'
  YELLOW='\033[33m'
  RED='\033[31m'
  RESET='\033[0m'
else
  BOLD=''
  DIM=''
  GREEN=''
  YELLOW=''
  RED=''
  RESET=''
fi

# ─── Helpers ──────────────────────────────────────────────────────────────────

info() {
  printf "${BOLD}%s${RESET}\n" "$1"
}

success() {
  printf "${GREEN}%s${RESET}\n" "$1"
}

warn() {
  printf "${YELLOW}warning:${RESET} %s\n" "$1" >&2
}

error() {
  printf "${RED}error:${RESET} %s\n" "$1" >&2
  exit 1
}

# ─── Platform Detection ──────────────────────────────────────────────────────

detect_platform() {
  PLATFORM="$(uname -s)"
  case "$PLATFORM" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    *)      error "Unsupported operating system: $PLATFORM. ByteRover CLI supports macOS and Linux." ;;
  esac
}

detect_arch() {
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               error "Unsupported architecture: $ARCH. ByteRover CLI supports x86_64 and arm64." ;;
  esac
}

build_target() {
  TARGET="${PLATFORM}-${ARCH}"

  # Validate against known supported targets
  case "$TARGET" in
    darwin-arm64|linux-x64|linux-arm64) ;;
    darwin-x64)  error "macOS x86_64 (Intel) is not currently supported. ByteRover CLI requires Apple Silicon (arm64)." ;;
    *)           error "Unsupported platform/architecture combination: $TARGET" ;;
  esac
}

# ─── Download Utility ────────────────────────────────────────────────────────

download() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --output "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
  else
    error "Neither curl nor wget found. Please install one and try again."
  fi
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────

check_dependencies() {
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    error "Neither curl nor wget found. Please install one and try again."
  fi

  if ! command -v tar >/dev/null 2>&1; then
    error "tar is required but not found. Please install it and try again."
  fi
}

# ─── npm Cleanup ────────────────────────────────────────────────────────────

remove_npm_installation() {
  # Skip if npm is not installed
  if ! command -v npm >/dev/null 2>&1; then
    return
  fi

  # Skip if byterover-cli is not globally installed via npm
  if ! npm list -g byterover-cli --depth=0 >/dev/null 2>&1; then
    return
  fi

  info "Detected existing npm installation of byterover-cli."

  info "Removing npm global package (byterover-cli)..."
  if npm uninstall -g byterover-cli >/dev/null 2>&1; then
    success "  Removed npm package byterover-cli."
    printf "\n"
  else
    warn "Could not remove npm package byterover-cli."
    warn "You may need to run manually: npm uninstall -g byterover-cli"
    warn "Or with elevated permissions: sudo npm uninstall -g byterover-cli"
    printf "\n"
  fi
}

# ─── Install ─────────────────────────────────────────────────────────────────

install_brv() {
  tarball_url="${GCS_BASE}/channels/${CHANNEL}/brv-${TARGET}.tar.gz"

  info "Installing ByteRover CLI..."
  printf "  Platform:  %s\n" "$TARGET"
  printf "  Location:  %s\n" "$BRV_INSTALL_DIR"
  printf "\n"

  # Create temp directory for download
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  tarball_path="$tmp_dir/brv.tar.gz"

  # Download tarball
  info "Downloading brv-${TARGET}.tar.gz..."
  if ! download "$tarball_url" "$tarball_path"; then
    error "Failed to download tarball from $tarball_url"
  fi

  # Remove existing installation if upgrading
  if [ -d "$BRV_INSTALL_DIR" ]; then
    info "Removing previous installation..."
    rm -rf "$BRV_INSTALL_DIR"
  fi

  # Create install directory and extract
  mkdir -p "$BRV_INSTALL_DIR"
  info "Extracting..."
  tar xzf "$tarball_path" -C "$BRV_INSTALL_DIR" --strip-components=1

  # Verify installation
  if [ ! -x "$BIN_DIR/brv" ]; then
    error "Installation failed: $BIN_DIR/brv not found or not executable after extraction."
  fi

  installed_version="$("$BIN_DIR/brv" --version 2>/dev/null || echo "unknown")"
  printf "  Version:   %s\n" "$installed_version"
  printf "\n"
}

# ─── PATH Setup ──────────────────────────────────────────────────────────────

# Adds a line to a file if it's not already present
add_to_file() {
  file="$1"
  line="$2"

  if [ ! -f "$file" ]; then
    return
  fi

  if grep -qF ".brv-cli/bin" "$file" 2>/dev/null; then
    return
  fi

  printf "\n# ByteRover CLI\n%s\n" "$line" >> "$file"
}

setup_path() {
  path_entry='export PATH="$HOME/.brv-cli/bin:$PATH"'
  fish_entry='fish_add_path "$HOME/.brv-cli/bin"'

  added_to=""

  # ~/.profile (login shell fallback)
  if [ -f "$HOME/.profile" ]; then
    add_to_file "$HOME/.profile" "$path_entry"
    added_to="${added_to} ~/.profile"
  fi

  # ~/.bashrc
  if [ -f "$HOME/.bashrc" ]; then
    add_to_file "$HOME/.bashrc" "$path_entry"
    added_to="${added_to} ~/.bashrc"
  fi

  # ~/.zshrc (also create if zsh is the default shell but .zshrc doesn't exist)
  if [ -f "$HOME/.zshrc" ]; then
    add_to_file "$HOME/.zshrc" "$path_entry"
    added_to="${added_to} ~/.zshrc"
  elif [ "$(basename "${SHELL:-}")" = "zsh" ]; then
    printf "\n# ByteRover CLI\n%s\n" "$path_entry" > "$HOME/.zshrc"
    added_to="${added_to} ~/.zshrc(created)"
  fi

  # Fish shell
  fish_config="$HOME/.config/fish/config.fish"
  if [ -f "$fish_config" ]; then
    add_to_file "$fish_config" "$fish_entry"
    added_to="${added_to} config.fish"
  fi

  if [ -n "$added_to" ]; then
    printf "${DIM}Updated PATH in:%s${RESET}\n" "$added_to"
  fi
}

# ─── Output ──────────────────────────────────────────────────────────────────

print_success() {
  printf "\n"
  success "ByteRover CLI installed successfully!"
  printf "\n"

  # Check if brv is already on PATH
  case ":${PATH}:" in
    *":${BIN_DIR}:"*)
      printf "Run ${BOLD}brv${RESET} to get started.\n"
      ;;
    *)
      printf "To get started, restart your shell or run:\n"
      printf "\n"
      printf "  ${BOLD}export PATH=\"\$HOME/.brv-cli/bin:\$PATH\"${RESET}\n"
      printf "\n"
      printf "Then run ${BOLD}brv${RESET} to begin.\n"
      ;;
  esac
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  detect_platform
  detect_arch
  build_target
  check_dependencies
  remove_npm_installation
  install_brv
  setup_path
  print_success
}

main "$@"
