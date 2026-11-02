import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { GitHubMark, REPO_URL } from "@/components/github-mark"

const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MIN_DRAWINGS = 10

const storageKey = (userId: string) => `excaliself:github-star:${userId}`

// Ask only people who have used the app for a while.
export function shouldAskForStar(
  createdAt: Date,
  drawingCount: number,
  now: number,
) {
  return (
    now - createdAt.getTime() >= MIN_ACCOUNT_AGE_MS &&
    drawingCount >= MIN_DRAWINGS
  )
}

// localStorage can throw (privacy modes). Then the prompt does not show,
// as it could not stay closed.
function isDismissed(userId: string) {
  try {
    return localStorage.getItem(storageKey(userId)) !== null
  } catch {
    return true
  }
}

/**
 * A one-time ask for a GitHub star in the sidebar footer, for admins only.
 * Closing it or following the link hides it for good in this browser.
 */
export function GitHubStarPrompt({
  userId,
  createdAt,
  drawingCount,
}: {
  userId: string
  createdAt: Date
  drawingCount: number
}) {
  // Decided after hydration: the server cannot read localStorage.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(
      !isDismissed(userId) &&
        shouldAskForStar(createdAt, drawingCount, Date.now()),
    )
  }, [userId, createdAt, drawingCount])

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey(userId), "dismissed")
    } catch {}
    setVisible(false)
  }

  return (
    <div className="relative mb-1.5 rounded-md border border-sidebar-border px-2.5 py-2">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-none"
      >
        <X className="h-3 w-3" />
      </button>
      <p className="pr-4 text-[12px] font-medium text-foreground">
        Enjoying Excaliself?
      </p>
      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
        A star on GitHub helps other people find it.
      </p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        onClick={dismiss}
        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-iris transition-colors hover:text-iris-strong"
      >
        <GitHubMark className="h-3 w-3" />
        Star on GitHub
      </a>
    </div>
  )
}
