#!/usr/bin/env bash
# Publish main to the public repository as one release snapshot.
#
# The public repository never receives this repository's history. Each release
# is a single commit whose tree is main's tree and whose parent is the previous
# release, so the public log is a list of releases and nothing else. The
# private commit each release was cut from is tagged here as published/<date>.
#
#   scripts/publish-release.sh [--dry-run] ["one-line release note"]
#
# Needs a `public` remote (git@github.com:dfrdn/lumilex.git) and the untracked
# .brand-terms list at the root of the main checkout.
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; shift; fi
NOTE="${1:-}"

PUBLIC_REMOTE=public
SOURCE_REF=origin/main

git remote get-url "$PUBLIC_REMOTE" >/dev/null 2>&1 || {
  echo "No '$PUBLIC_REMOTE' remote. Add it: git remote add public git@github.com:dfrdn/lumilex.git" >&2
  exit 1
}

git fetch -q origin
git fetch -q "$PUBLIC_REMOTE" 2>/dev/null || true

SOURCE=$(git rev-parse "$SOURCE_REF")
TREE=$(git rev-parse "$SOURCE^{tree}")
PARENT=$(git rev-parse -q --verify "refs/remotes/$PUBLIC_REMOTE/main" || true)

if [[ -n "$PARENT" && "$(git rev-parse "$PARENT^{tree}")" == "$TREE" ]]; then
  echo "The public repository already carries $SOURCE_REF's tree. Nothing to publish."
  exit 0
fi

# The text gates that matter for publishing run against exactly the tree being
# published, in a throwaway worktree, so a dirty checkout can't pass for it.
MAIN_CHECKOUT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
TERMS="$MAIN_CHECKOUT/.brand-terms"
[[ -f "$TERMS" ]] || { echo "Missing $TERMS: verify:brand cannot run without it." >&2; exit 1; }

WORK=$(mktemp -d)
trap 'git worktree remove --force "$WORK/tree" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
git worktree add -q --detach "$WORK/tree" "$SOURCE"
cp "$TERMS" "$WORK/tree/.brand-terms"
ln -s "$MAIN_CHECKOUT/node_modules" "$WORK/tree/node_modules"
(
  cd "$WORK/tree"
  npx tsx scripts/audit-brand.ts --require-terms
  npx tsx scripts/audit-person-shaped.ts
)

DATE=$(date -u +%Y-%m-%d)
MESSAGE="Release $DATE"
[[ -n "$NOTE" ]] && MESSAGE="$MESSAGE"$'\n\n'"$NOTE"

AUTHOR_NAME=$(git config user.name)
AUTHOR_EMAIL=$(git config user.email)
COMMIT=$(
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} -m "$MESSAGE"
)

echo "Release commit $COMMIT (tree of $SOURCE${PARENT:+, after $PARENT})"
if [[ $DRY_RUN == 1 ]]; then
  echo "Dry run: not pushed."
  exit 0
fi

git push "$PUBLIC_REMOTE" "$COMMIT:refs/heads/main"
TAG="published/$DATE"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && TAG="$TAG-$(date -u +%H%M%S)"
git tag "$TAG" "$SOURCE"
echo "Published. Tagged $SOURCE as $TAG here (not pushed anywhere)."
