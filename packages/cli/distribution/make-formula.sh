#!/usr/bin/env bash
# Render the Homebrew formula from aerial.rb.tmpl: compute the sha256 of the
# four release tarballs and substitute the @@VERSION@@ / @@SHA_*@@ placeholders.
#
# Usage:  make-formula.sh <version> <tarball-dir>
# Writes <tarball-dir>/aerial.rb.
set -euo pipefail

usage() { echo "usage: $0 <version> <tarball-dir>" >&2; exit 2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 2 ]] || usage
version="$1"
dir="$2"
tmpl="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/aerial.rb.tmpl"

[[ -d "$dir" ]] || die "not a directory: $dir"
[[ -f "$tmpl" ]] || die "template not found: $tmpl"

# Portable sha256 (macOS ships shasum, linux sha256sum).
sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

tarball_sha() {
	local f="$dir/aerial-$1.tar.gz"
	[[ -f "$f" ]] || die "missing tarball: $f"
	sha256_of "$f"
}

sha_darwin_arm64="$(tarball_sha darwin-arm64)"
sha_darwin_x64="$(tarball_sha darwin-x64)"
sha_linux_arm64="$(tarball_sha linux-arm64)"
sha_linux_x64="$(tarball_sha linux-x64)"

sed \
	-e "s|@@VERSION@@|$version|g" \
	-e "s|@@SHA_DARWIN_ARM64@@|$sha_darwin_arm64|g" \
	-e "s|@@SHA_DARWIN_X64@@|$sha_darwin_x64|g" \
	-e "s|@@SHA_LINUX_ARM64@@|$sha_linux_arm64|g" \
	-e "s|@@SHA_LINUX_X64@@|$sha_linux_x64|g" \
	"$tmpl" > "$dir/aerial.rb"

echo "wrote $dir/aerial.rb (version $version)"
