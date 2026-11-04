import { createFileRoute } from "@tanstack/react-router"
import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/lib/document-title"
import { AccessTokensSection } from "./-components/AccessTokensSection"
import { ConnectedAppsSection } from "./-components/ConnectedAppsSection"

// Open to every member: each one connects their own AI client.
export const Route = createFileRoute("/_app/settings/mcp")({
  component: McpPage,
})

function McpPage() {
  useDocumentTitle("MCP", { chrome: true })
  return (
    <div className="flex flex-col gap-8">
      <AccessTokensSection />
      <Separator />
      <ConnectedAppsSection />
    </div>
  )
}
