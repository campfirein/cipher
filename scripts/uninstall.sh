#!/bin/sh
# uninstall.sh — ByteRover CLI uninstaller
# Usage: curl -fsSL https://storage.googleapis.com/brv-releases/uninstall.sh | sh
#
# Flags:
#   --yes, -y   Skip confirmation prompt
#   --help, -h  Show usage information
#
# Environment variables:
#   BRV_INSTALL_DIR  Override install location (default: ~/.brv-cli)
#   BRV_DATA_DIR     Override data directory

set -eu

# ─── Constants ────────────────────────────────────────────────────────────────

BRV_INSTALL_DIR="${BRV_INSTALL_DIR:-$HOME/.brv-cli}"
SKIP_CONFIRM=false

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

# ─── Usage ────────────────────────────────────────────────────────────────────

usage() {
  printf "ByteRover CLI Uninstaller\n"
  printf "\n"
  printf "Usage:\n"
  printf "  curl -fsSL https://storage.googleapis.com/brv-releases/uninstall.sh | sh\n"
  printf "  curl -fsSL https://storage.googleapis.com/brv-releases/uninstall.sh | sh -s -- --yes\n"
  printf "\n"
  printf "Flags:\n"
  printf "  --yes, -y   Skip confirmation prompt\n"
  printf "  --help, -h  Show this help message\n"
  printf "\n"
  printf "Environment variables:\n"
  printf "  BRV_INSTALL_DIR  Override install location (default: ~/.brv-cli)\n"
  printf "  BRV_DATA_DIR     Override data directory\n"
  exit 0
}

# ─── Argument Parsing ─────────────────────────────────────────────────────────

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --yes|-y)   SKIP_CONFIRM=true ;;
      --help|-h)  usage ;;
      *)          warn "Unknown option: $1" ;;
    esac
    shift
  done
}

# ─── Platform Detection ──────────────────────────────────────────────────────

detect_platform() {
  PLATFORM="$(uname -s)"
  case "$PLATFORM" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    *)      error "Unsupported operating system: $PLATFORM" ;;
  esac
}

# ─── Path Resolution ─────────────────────────────────────────────────────────

resolve_paths() {
  if [ "$PLATFORM" = "darwin" ]; then
    CONFIG_DIR="$HOME/Library/Application Support/brv"
    DATA_DIR="${BRV_DATA_DIR:-$HOME/Library/Application Support/brv}"
    LOGS_DIR="$HOME/Library/Logs/brv"
  else
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/brv"
    DATA_DIR="${BRV_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/brv}"
    LOGS_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/brv/logs"
  fi

  # configstore (used by update-notifier) always uses xdg-basedir, even on macOS
  UPDATE_NOTIFIER_CACHE="${XDG_CONFIG_HOME:-$HOME/.config}/configstore/update-notifier-byterover-cli.json"

  # oclif (plugin-update client cache) always uses xdg-basedir, even on macOS
  OCLIF_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/brv"
}

# ─── Discovery ────────────────────────────────────────────────────────────────

discover() {
  FOUND_ANYTHING=false

  # Installation directory
  FOUND_INSTALL=false
  if [ -d "$BRV_INSTALL_DIR" ]; then
    FOUND_INSTALL=true
    FOUND_ANYTHING=true
  fi

  # Shell config entries
  FOUND_SHELL_CONFIGS=""
  for file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.config/fish/config.fish"; do
    if [ -f "$file" ] && grep -qF ".brv-cli/bin" "$file" 2>/dev/null; then
      FOUND_SHELL_CONFIGS="${FOUND_SHELL_CONFIGS} ${file}"
      FOUND_ANYTHING=true
    fi
  done

  # Global config directory
  FOUND_CONFIG=false
  if [ -d "$CONFIG_DIR" ]; then
    FOUND_CONFIG=true
    FOUND_ANYTHING=true
  fi

  # Global data directory (may be same as config on macOS)
  FOUND_DATA=false
  if [ -d "$DATA_DIR" ] && [ "$DATA_DIR" != "$CONFIG_DIR" ]; then
    FOUND_DATA=true
    FOUND_ANYTHING=true
  fi

  # oclif data directory (plugin-update client cache; may overlap DATA_DIR on Linux)
  FOUND_OCLIF_DATA=false
  if [ -d "$OCLIF_DATA_DIR" ] && [ "$OCLIF_DATA_DIR" != "$DATA_DIR" ]; then
    FOUND_OCLIF_DATA=true
    FOUND_ANYTHING=true
  fi

  # Global logs directory
  FOUND_LOGS=false
  if [ -d "$LOGS_DIR" ]; then
    FOUND_LOGS=true
    FOUND_ANYTHING=true
  fi

  # Keychain entries (check existence)
  FOUND_KEYCHAIN=false
  if [ "$PLATFORM" = "darwin" ]; then
    if security find-generic-password -s "byterover-cli" >/dev/null 2>&1; then
      FOUND_KEYCHAIN=true
      FOUND_ANYTHING=true
    elif security find-generic-password -s "byterover-cli-providers" >/dev/null 2>&1; then
      FOUND_KEYCHAIN=true
      FOUND_ANYTHING=true
    elif security find-generic-password -s "byterover-cli-hub-registries" >/dev/null 2>&1; then
      FOUND_KEYCHAIN=true
      FOUND_ANYTHING=true
    fi
  fi

  # update-notifier cache
  FOUND_NOTIFIER_CACHE=false
  if [ -f "$UPDATE_NOTIFIER_CACHE" ]; then
    FOUND_NOTIFIER_CACHE=true
    FOUND_ANYTHING=true
  fi
}

# ─── Display Removal Plan ────────────────────────────────────────────────────

# Shortens a path for display (replaces $HOME with ~)
display_path() {
  printf "%s" "$1" | sed "s|^$HOME|~|"
}

show_plan() {
  printf "\n"
  info "ByteRover CLI Uninstaller"
  printf "\n"

  if [ "$FOUND_ANYTHING" = false ]; then
    printf "ByteRover CLI does not appear to be installed.\n"
    exit 0
  fi

  printf "The following will be removed:\n"
  printf "\n"

  # Installation
  if [ "$FOUND_INSTALL" = true ]; then
    printf "  ${BOLD}Installation:${RESET}\n"
    printf "    %s\n" "$(display_path "$BRV_INSTALL_DIR")"
    printf "\n"
  fi

  # Shell configs
  if [ -n "$FOUND_SHELL_CONFIGS" ]; then
    printf "  ${BOLD}Shell config entries:${RESET}\n"
    for file in $FOUND_SHELL_CONFIGS; do
      printf "    %s\n" "$(display_path "$file")"
    done
    printf "\n"
  fi

  # Config & data directories
  if [ "$FOUND_CONFIG" = true ] || [ "$FOUND_DATA" = true ] || [ "$FOUND_OCLIF_DATA" = true ]; then
    printf "  ${BOLD}Global config & data:${RESET}\n"
    if [ "$FOUND_CONFIG" = true ]; then
      printf "    %s\n" "$(display_path "$CONFIG_DIR")"
    fi
    if [ "$FOUND_DATA" = true ]; then
      printf "    %s\n" "$(display_path "$DATA_DIR")"
    fi
    if [ "$FOUND_OCLIF_DATA" = true ]; then
      printf "    %s\n" "$(display_path "$OCLIF_DATA_DIR")"
    fi
    printf "\n"
  fi

  # Logs
  if [ "$FOUND_LOGS" = true ]; then
    printf "  ${BOLD}Logs:${RESET}\n"
    printf "    %s\n" "$(display_path "$LOGS_DIR")"
    printf "\n"
  fi

  # Keychain
  if [ "$FOUND_KEYCHAIN" = true ]; then
    printf "  ${BOLD}Keychain entries:${RESET}\n"
    printf "    byterover-cli (auth token)\n"
    printf "    byterover-cli-providers\n"
    printf "    byterover-cli-hub-registries\n"
    printf "\n"
  fi

  # update-notifier cache
  if [ "$FOUND_NOTIFIER_CACHE" = true ]; then
    printf "  ${BOLD}Other:${RESET}\n"
    printf "    %s\n" "$(display_path "$UPDATE_NOTIFIER_CACHE")"
    printf "\n"
  fi

  printf "${DIM}  Note: Project-level .brv/ directories are not removed.${RESET}\n"
  printf "\n"
}

# ─── Confirmation ─────────────────────────────────────────────────────────────

confirm() {
  if [ "$SKIP_CONFIRM" = true ]; then
    return
  fi

  printf "Are you sure you want to uninstall ByteRover CLI? [y/N] "
  read -r answer </dev/tty 2>/dev/null || read -r answer
  case "$answer" in
    [yY]|[yY][eE][sS]) ;;
    *) printf "Aborted.\n"; exit 0 ;;
  esac
  printf "\n"
}

# ─── Shell Config Cleanup ────────────────────────────────────────────────────

clean_shell_config() {
  file="$1"

  if [ ! -f "$file" ]; then
    return
  fi

  if ! grep -qF ".brv-cli/bin" "$file" 2>/dev/null; then
    return
  fi

  # Create backup before modifying
  cp "$file" "${file}.brv-uninstall-backup"

  # Use temp file for POSIX portability (avoids BSD vs GNU sed -i differences)
  tmp="$(mktemp)"
  grep -v -F ".brv-cli/bin" "$file" | grep -v "^# ByteRover CLI$" | cat -s > "$tmp"
  cp "$tmp" "$file"
  rm -f "$tmp"

  printf "  Cleaned %s ${DIM}(backup: %s)${RESET}\n" "$(display_path "$file")" "$(display_path "${file}.brv-uninstall-backup")"
}

remove_shell_config_entries() {
  if [ -z "$FOUND_SHELL_CONFIGS" ]; then
    return
  fi

  info "Cleaning shell config files..."
  for file in $FOUND_SHELL_CONFIGS; do
    clean_shell_config "$file"
  done
  printf "\n"
}

# ─── Keychain Cleanup ────────────────────────────────────────────────────────

remove_keychain_entries() {
  if [ "$FOUND_KEYCHAIN" = false ]; then
    return
  fi

  info "Removing keychain entries..."

  if [ "$PLATFORM" = "darwin" ]; then
    # Auth token
    if security delete-generic-password -s "byterover-cli" -a "auth-token" >/dev/null 2>&1; then
      printf "  Removed byterover-cli auth token\n"
    fi

    # Provider API keys (may have multiple accounts)
    removed_providers=0
    while security delete-generic-password -s "byterover-cli-providers" >/dev/null 2>&1; do
      removed_providers=$((removed_providers + 1))
    done
    if [ "$removed_providers" -gt 0 ]; then
      printf "  Removed %d provider keychain entry/entries\n" "$removed_providers"
    fi

    # Hub registry tokens (may have multiple accounts)
    removed_registries=0
    while security delete-generic-password -s "byterover-cli-hub-registries" >/dev/null 2>&1; do
      removed_registries=$((removed_registries + 1))
    done
    if [ "$removed_registries" -gt 0 ]; then
      printf "  Removed %d hub registry keychain entry/entries\n" "$removed_registries"
    fi
  fi

  printf "\n"
}

# ─── Directory Removal ────────────────────────────────────────────────────────

remove_directories() {
  has_dirs=false

  if [ "$FOUND_CONFIG" = true ] || [ "$FOUND_DATA" = true ] || [ "$FOUND_OCLIF_DATA" = true ] || [ "$FOUND_LOGS" = true ]; then
    has_dirs=true
  fi

  if [ "$has_dirs" = false ] && [ "$FOUND_INSTALL" = false ]; then
    return
  fi

  info "Removing directories..."

  # Config directory
  if [ "$FOUND_CONFIG" = true ]; then
    if rm -rf "$CONFIG_DIR" 2>/dev/null; then
      printf "  Removed %s\n" "$(display_path "$CONFIG_DIR")"
    else
      warn "Could not remove $(display_path "$CONFIG_DIR"). You may need to remove it manually."
    fi
  fi

  # Data directory (skip if same as config, already removed)
  if [ "$FOUND_DATA" = true ]; then
    if rm -rf "$DATA_DIR" 2>/dev/null; then
      printf "  Removed %s\n" "$(display_path "$DATA_DIR")"
    else
      warn "Could not remove $(display_path "$DATA_DIR"). You may need to remove it manually."
    fi
  fi

  # oclif data directory (plugin-update client cache)
  if [ "$FOUND_OCLIF_DATA" = true ]; then
    if rm -rf "$OCLIF_DATA_DIR" 2>/dev/null; then
      printf "  Removed %s\n" "$(display_path "$OCLIF_DATA_DIR")"
    else
      warn "Could not remove $(display_path "$OCLIF_DATA_DIR"). You may need to remove it manually."
    fi
  fi

  # Logs directory
  if [ "$FOUND_LOGS" = true ]; then
    if rm -rf "$LOGS_DIR" 2>/dev/null; then
      printf "  Removed %s\n" "$(display_path "$LOGS_DIR")"
    else
      warn "Could not remove $(display_path "$LOGS_DIR"). You may need to remove it manually."
    fi
  fi

  # Installation directory (last, so brv binary is available until this point)
  if [ "$FOUND_INSTALL" = true ]; then
    if rm -rf "$BRV_INSTALL_DIR" 2>/dev/null; then
      printf "  Removed %s\n" "$(display_path "$BRV_INSTALL_DIR")"
    else
      warn "Could not remove $(display_path "$BRV_INSTALL_DIR"). You may need to remove it manually."
    fi
  fi

  printf "\n"
}

# ─── Misc Cleanup ────────────────────────────────────────────────────────────

remove_misc() {
  if [ "$FOUND_NOTIFIER_CACHE" = false ]; then
    return
  fi

  if rm -f "$UPDATE_NOTIFIER_CACHE" 2>/dev/null; then
    printf "  Removed %s\n" "$(display_path "$UPDATE_NOTIFIER_CACHE")"
  fi
}

# ─── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
  printf "\n"
  success "ByteRover CLI has been uninstalled."
  printf "\n"
  printf "Restart your shell or run: ${BOLD}exec -l \$SHELL${RESET}\n"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"
  detect_platform
  resolve_paths
  discover
  show_plan
  confirm
  remove_shell_config_entries
  remove_keychain_entries
  remove_directories
  remove_misc
  print_summary
}

main "$@"
