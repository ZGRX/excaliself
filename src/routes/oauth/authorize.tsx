import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AuthPage } from "@/components/auth-page"
import { Button } from "@/components/ui/button"
import {
  approveAuthorize,
  denyAuthorize,
  getAuthorizeRequest,
} from "@/features/oauth/server"
import { useDocumentTitle } from "@/lib/document-title"
import { authMiddleware } from "@/middleware/auth"
import { setupMiddleware } from "@/middleware/setup"

// OAuth consent: an MCP client such as Claude.ai sends the member here to
// connect. Signed-out members go through /login (password or SSO) and come
// back. Never in a frame, so another site can't trick a click on Allow.
export const Route = createFileRoute("/oauth/authorize")({
  server: { middleware: [setupMiddleware, authMiddleware] },
  headers: () => ({
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
  }),
  // The raw query: the router's parsed search would turn a state of "123"
  // into a number.
  loader: async ({ location }) => {
    const params = Object.fromEntries(new URLSearchParams(location.searchStr))
    return { params, view: await getAuthorizeRequest({ data: params }) }
  },
  component: AuthorizePage,
})

function AuthorizePage() {
  const { params, view } = Route.useLoaderData()
  useDocumentTitle("Connect an app")

  if (view.kind === "error") return <Returning to={view.redirectTo} />
  if (view.kind === "invalid") {
    return (
      <AuthPage title="Can't connect this app" subtitle={view.message}>
        <Button
          render={<Link to="/draw" />}
          nativeButton={false}
          className="w-full"
        >
          Go to Excaliself
        </Button>
      </AuthPage>
    )
  }
  return <Consent params={params} view={view} />
}

type ConsentView = Extract<
  ReturnType<typeof Route.useLoaderData>["view"],
  { kind: "consent" }
>

function Consent({
  params,
  view,
}: {
  params: Record<string, string>
  view: ConsentView
}) {
  // Set once the browser is on its way back to the client.
  const [leaving, setLeaving] = useState(false)
  const respond = useMutation({
    mutationFn: (allow: boolean) =>
      (allow ? approveAuthorize : denyAuthorize)({ data: params }),
    onSuccess: ({ redirectTo }) => {
      setLeaving(true)
      window.location.assign(redirectTo)
    },
    onError: (error) => toast.error(error.message || "Couldn't connect"),
  })
  const busy = respond.isPending || leaving
  const { clientName, redirectHost, member } = view

  return (
    <AuthPage
      title={`Connect ${clientName}`}
      subtitle="to your Excaliself account"
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-border/60 px-4 py-3 text-sm">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate font-medium text-foreground">
            {member.name || member.email}
          </p>
          {member.name && (
            <p className="truncate text-xs text-muted-foreground">
              {member.email}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {clientName} will act as you. It can:
          </p>
          <ul className="space-y-2 text-sm text-foreground">
            <Permission>See the drawings and folders you see</Permission>
            <Permission>Create new drawings and folders</Permission>
            <Permission>Move drawings between folders</Permission>
          </ul>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <X aria-hidden className="h-4 w-4 shrink-0" />
            It can't change what is in a drawing or delete anything
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => respond.mutate(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => respond.mutate(true)}
          >
            {respond.isPending && respond.variables ? "Allowing…" : "Allow"}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Then you go back to{" "}
          <span className="font-medium text-foreground">{redirectHost}</span>.
          Disconnect it at any time in Settings, under MCP.
        </p>
      </div>
    </AuthPage>
  )
}

function Permission({ children }: { children: string }) {
  return (
    <li className="flex items-center gap-2">
      <Check aria-hidden className="h-4 w-4 shrink-0 text-iris" />
      {children}
    </li>
  )
}

// A request the client got wrong: the error goes back to it.
function Returning({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to])
  return (
    <AuthPage title="Returning to the app" subtitle="One moment">
      {null}
    </AuthPage>
  )
}
