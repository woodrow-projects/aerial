#!/usr/bin/env bash
# aerial CLI installer — the `curl … | bash` channel (Linux / no-Homebrew).
# Detects OS/arch, downloads the matching release binary, installs it to
# /usr/local/bin (or ~/.local/bin when that isn't writable).
#
# NOTE: `releases/latest` resolves across ALL repo releases — acceptable while
# cli-v* are the only binary releases; revisit if the repo ever publishes
# other release kinds.
set -euo pipefail

REPO="woodrow-projects/aerial"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

os="$(uname -s)"
case "$os" in
	Darwin) os=darwin ;;
	Linux)  os=linux ;;
	*)      die "unsupported OS: $os (aerial ships darwin/linux binaries)" ;;
esac

arch="$(uname -m)"
case "$arch" in
	arm64|aarch64) arch=arm64 ;;
	x86_64)        arch=x64 ;;
	*)             die "unsupported architecture: $arch (aerial ships arm64/x64 binaries)" ;;
esac

url="https://github.com/$REPO/releases/latest/download/aerial-$os-$arch.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s ...\n' "$url"
curl -fsSL "$url" | tar -xz -C "$tmp" || die "download failed: $url"
[[ -f "$tmp/aerial" ]] || die "release asset did not contain an 'aerial' binary"
chmod +x "$tmp/aerial"

if [[ -w /usr/local/bin ]]; then
	dest=/usr/local/bin
else
	dest="$HOME/.local/bin"
	mkdir -p "$dest"
fi
mv "$tmp/aerial" "$dest/aerial"

printf 'Installed %s to %s\n' "$("$dest/aerial" --version)" "$dest/aerial"

case ":$PATH:" in
	*":$dest:"*) ;;
	*)
		printf '\nnote: %s is not on your PATH. Add it to your shell profile:\n' "$dest"
		printf '    export PATH="%s:$PATH"\n' "$dest"
		;;
esac
