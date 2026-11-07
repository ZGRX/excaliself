import { useQuery } from "@tanstack/react-query"
import { GitHubMark, REPO_URL } from "@/components/github-mark"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/features/instance/format-bytes"
import { instanceStatsQueryOptions } from "@/features/instance/queries"
import { useDelayedVisible } from "@/hooks/use-delayed-visible"

const RELEASES_URL = `${REPO_URL}/releases`
const X_URL = "https://x.com/0xzygmunt"

// Read-only About page (spec §5.15): zero settings — instance behavior is
// deliberately hardcoded, so this page only answers "what version am I on,
// how big is this instance".
export function InstanceSection() {
  const { data: stats, isPending } = useQuery(instanceStatsQueryOptions())
  const showSkeleton = useDelayedVisible(isPending)

  if (isPending) return showSkeleton ? <InstanceSkeleton /> : null
  if (!stats) return null

  const rows = [
    { label: "Version", value: `v${stats.version}` },
    { label: "Users", value: String(stats.userCount) },
    { label: "Drawings", value: String(stats.drawingCount) },
    { label: "Storage used", value: formatBytes(stats.storageBytes) },
  ]

  return (
    <section className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">About</h2>
        <p className="text-xs text-muted-foreground">
          This instance at a glance.
        </p>
      </div>

      <dl>
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={`flex items-center justify-between gap-3 py-2.5 ${
              index !== 0 ? "border-t border-border/60" : ""
            }`}
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-sm tabular-nums text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Release notes on GitHub
        </a>
        <span aria-hidden>·</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
        >
          <GitHubMark className="h-3 w-3" />
          Star on GitHub
        </a>
        <span aria-hidden>·</span>
        <a
          href={X_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className="h-3 w-3"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Follow on X
        </a>
      </p>
    </section>
  )
}

// Mirrors the loaded layout: section header plus the four stat rows.
function InstanceSkeleton() {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div>
        {[0, 1, 2, 3].map((rowIndex) => (
          <div
            key={rowIndex}
            className={`flex items-center justify-between py-2.5 ${
              rowIndex !== 0 ? "border-t border-border/60" : ""
            }`}
          >
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
