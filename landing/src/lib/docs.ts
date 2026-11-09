import { getCollection } from "astro:content"

// The docs sidebar, in reading order. An id is a markdown file name without the extension.
const sidebar = [
  { label: "Get started", pages: ["index"] },
  { label: "Deploy", pages: ["docker-compose", "coolify", "backup-restore"] },
  { label: "Configure", pages: ["environment", "single-sign-on"] },
  { label: "Use", pages: ["team-space", "sharing", "comments", "team-library", "organize", "import", "mcp"] },
  { label: "Administer", pages: ["members", "admin-recovery"] },
  { label: "Develop", pages: ["local-development"] },
]

export const docHref = (id: string) => `${import.meta.env.BASE_URL}docs/${id === "index" ? "" : `${id}/`}`

// The sidebar with its entries. Fails the build if it and the markdown files disagree.
export async function getDocsNav() {
  const docs = await getCollection("docs")
  const listed = sidebar.flatMap((s) => s.pages)
  const orphan = docs.find((d) => !listed.includes(d.id))
  if (orphan) throw new Error(`Docs page missing from the sidebar: ${orphan.id}`)
  return sidebar.map((section) => ({
    label: section.label,
    pages: section.pages.map((id) => {
      const doc = docs.find((d) => d.id === id)
      if (!doc) throw new Error(`Sidebar lists a missing docs page: ${id}`)
      return doc
    }),
  }))
}
