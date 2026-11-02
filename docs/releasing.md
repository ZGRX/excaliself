# Releasing

The `Docker` workflow (`.github/workflows/docker.yml`) builds the image and
boots both deploy compose files against it on every PR and push. Pushes then
publish to `ghcr.io/maciekzygmunt/excaliself`:

- push to `main` → `:main`
- tag `v1.2.3` → `:1.2.3`, `:1.2` and `:latest`

To cut a release, first set `version` in `package.json` to `1.2.3` and merge
that to `main`. The app shows this version under **Settings → Instance**. Then
tag `main` and push the tag:

```bash
git checkout main && git pull
git tag v1.2.3
git push origin v1.2.3
```

The workflow fails if the tag and `package.json` do not match.

Then write release notes on the GitHub release for that tag.

## One-time setup

The first publish creates the package as private. Make it public once under
the package's **Settings → Danger Zone → Change visibility**, or anonymous
pulls (and Coolify) fail. Check with `docker logout ghcr.io && docker pull
ghcr.io/maciekzygmunt/excaliself:main`.
