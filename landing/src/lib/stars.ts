// The repo's GitHub star count. Null if GitHub does not answer. Runs at build time and in the browser.
export const fetchStars = (): Promise<number | null> =>
  fetch("https://api.github.com/repos/maciekzygmunt/excaliself", {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((repo) => (typeof repo?.stargazers_count === "number" ? repo.stargazers_count : null))
    .catch(() => null)

// Compact form for the buttons, such as "1.2k".
export const formatStars = (count: number) =>
  new Intl.NumberFormat("en", { notation: "compact" }).format(count).toLowerCase()

// Fetched once per build and shared by every page, so the HTML ships a number before the browser asks.
export const buildStars: Promise<number | null> = import.meta.env.SSR ? fetchStars() : Promise.resolve(null)
