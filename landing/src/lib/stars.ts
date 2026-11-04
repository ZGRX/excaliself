// The repo's GitHub star count, fetched once per build. Null if GitHub does not answer, so buttons show no number.
export const stars: Promise<string | null> = fetch("https://api.github.com/repos/maciekzygmunt/excaliself", {
  headers: { Accept: "application/vnd.github+json" },
  signal: AbortSignal.timeout(5000),
})
  .then((res) => (res.ok ? res.json() : null))
  .then((repo) =>
    typeof repo?.stargazers_count === "number"
      ? new Intl.NumberFormat("en", { notation: "compact" }).format(repo.stargazers_count).toLowerCase()
      : null,
  )
  .catch(() => null)
