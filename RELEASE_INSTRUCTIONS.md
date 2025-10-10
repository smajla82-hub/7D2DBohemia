# GitHub Release v0.2.1 - Creation Instructions

## Overview
This document contains all the information needed to create GitHub Release v0.2.1 for the Quest System module.

## Release Details

- **Tag**: v0.2.1
- **Target Commit**: 0f125fe5da361dd03d587ad12aa3f4933dcbf2b2
- **Release Title**: Quest System v0.2.1
- **Pre-release**: No
- **Draft**: No

## Steps to Create Release

### Option 1: Using GitHub Web UI

1. Go to https://github.com/smajla82-hub/7D2DBohemia/releases/new
2. Click "Choose a tag" and type `v0.2.1`
3. Select "Create new tag: v0.2.1 on publish"
4. In the "Target" dropdown, select commit `0f125fe5da361dd03d587ad12aa3f4933dcbf2b2`
5. Set "Release title" to: `Quest System v0.2.1`
6. Copy the contents from `RELEASES/v0.2.1.md` file (from PR #4 branch) into the description box
7. Ensure "Set as the latest release" is checked
8. Click "Publish release"

### Option 2: Using gh CLI

```bash
# First, create and push the tag
git tag v0.2.1 0f125fe5da361dd03d587ad12aa3f4933dcbf2b2
git push origin v0.2.1

# Then create the release
gh release create v0.2.1 \
  --title "Quest System v0.2.1" \
  --notes-file RELEASES/v0.2.1.md \
  --target 0f125fe5da361dd03d587ad12aa3f4933dcbf2b2
```

### Option 3: Using GitHub REST API

```bash
# Get release notes content
RELEASE_NOTES=$(cat RELEASES/v0.2.1.md)

# Create release
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/smajla82-hub/7D2DBohemia/releases \
  -d "{
    \"tag_name\": \"v0.2.1\",
    \"target_commitish\": \"0f125fe5da361dd03d587ad12aa3f4933dcbf2b2\",
    \"name\": \"Quest System v0.2.1\",
    \"body\": $(jq -Rs . < RELEASES/v0.2.1.md),
    \"draft\": false,
    \"prerelease\": false
  }"
```

## Release Notes Source

The release notes should be taken from the file `RELEASES/v0.2.1.md` which exists in PR #4 (branch: copilot/add-quest-system-documentation).

To retrieve the file:
- View on GitHub: https://github.com/smajla82-hub/7D2DBohemia/blob/copilot/add-quest-system-documentation/RELEASES/v0.2.1.md
- Or fetch from the PR branch:
  ```bash
  git fetch origin copilot/add-quest-system-documentation
  git show origin/copilot/add-quest-system-documentation:RELEASES/v0.2.1.md
  ```

## Verification

After creating the release, verify:
1. Tag v0.2.1 exists and points to commit 0f125fe5da361dd03d587ad12aa3f4933dcbf2b2
2. Release appears at https://github.com/smajla82-hub/7D2DBohemia/releases
3. Release is marked as "Latest"
4. Release notes are properly formatted with all sections visible

## Expected Release URL

After creation, the release should be accessible at:
```
https://github.com/smajla82-hub/7D2DBohemia/releases/tag/v0.2.1
```

## Summary for PR Comment

Once the release is created, post this summary:

```
✅ GitHub Release v0.2.1 Created

- **Release URL**: https://github.com/smajla82-hub/7D2DBohemia/releases/tag/v0.2.1
- **Tag**: v0.2.1
- **Target Commit**: 0f125fe5da361dd03d587ad12aa3f4933dcbf2b2 (PR #3 merge)
- **Release Title**: Quest System v0.2.1

The release includes comprehensive documentation from RELEASES/v0.2.1.md covering all v0.2.1 features, configuration options, and deployment instructions.
```
