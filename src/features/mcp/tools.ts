// The MCP server one member's AI client talks to: find, read, and create
// drawings, create folders, and move drawings between folders, under the same
// Space rule as that member's browser. Editing a drawing's scene is left out:
// shared and Team drawings are written only by their Room (ADR 0002).

import { McpServer } from "@modelcontextprotocol/server"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/db"
import { drawings, type Space, spaces } from "@/db/schema"
import { userDisplayName } from "@/features/account/display-name"
import { rooms } from "@/features/collab/room-registry"
import { roomElements } from "@/features/collab/room-session"
import { insertDrawing } from "@/features/drawings/create"
import { listDrawings } from "@/features/drawings/list"
import { matchDrawing, parseSceneElements } from "@/features/drawings/search"
import { updateDrawingFields } from "@/features/drawings/update"
import { insertFolder } from "@/features/folders/create"
import { listFolders } from "@/features/folders/list"
import { folderPaths } from "@/features/folders/subtree"
import { listUpdates } from "@/features/list-updates/hub"
import { accessibleTo } from "@/features/spaces/access"
import packageJson from "../../../package.json"
import { buildScene } from "./scene/build"
import { parseMermaid } from "./scene/mermaid"
import {
  directions,
  elementSkeleton,
  MAX_ELEMENTS,
  type SceneGraph,
} from "./scene/skeleton"
import { summarizeScene } from "./summary"

export type Member = { id: string; name: string; email: string }

const space = z
  .enum(spaces)
  .describe('"private" (only you) or "team" (every member).')

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
})
const json = (value: unknown) => text(JSON.stringify(value))

/** One per request: the server knows its member and the instance's origin. */
export function createMcpServer(db: Db, member: Member, origin: string) {
  const server = new McpServer(
    {
      name: "excaliself",
      title: "Excaliself",
      version: packageJson.version,
      // Clients show this icon. Without it, they guess from the domain.
      icons: [
        {
          src: `${origin}/favicon.svg`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
        },
        {
          src: `${origin}/logo192.png`,
          mimeType: "image/png",
          sizes: ["192x192"],
        },
        {
          src: `${origin}/logo512.png`,
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
      websiteUrl: origin,
    },
    {
      // Bounds the work one create_drawing call can ask for.
      maxToolInputElements: 20_000,
      instructions: `Excaliself is a self-hosted Excalidraw. You act as ${userDisplayName(member)}. Every drawing and folder lives in a Space: "private" (only this member sees it) or "team" (every member sees it). You can find, read, and create drawings, create folders, and move drawings between folders of one Space. You can't change what is in a drawing, and you can't delete anything.`,
    },
  )
  const drawingUrl = (id: string) => `${origin}/draw/${id}`

  type ListedDrawing = Awaited<ReturnType<typeof listDrawings>>[number]

  /** The drawings the member can see, most recently edited first. */
  const visibleDrawings = async (filter: {
    space?: Space
    folderId?: string
  }) => {
    const [all, folders] = await Promise.all([
      listDrawings(db, member.id),
      listFolders(db, member.id),
    ])
    const list = all
      .filter((drawing) => !filter.space || drawing.space === filter.space)
      .filter(
        (drawing) => !filter.folderId || drawing.folderId === filter.folderId,
      )
    return { list, paths: folderPaths(folders) }
  }

  const toRow = (drawing: ListedDrawing, paths: Map<string, string>) => ({
    id: drawing.id,
    name: drawing.name,
    space: drawing.space,
    folder: drawing.folderId ? (paths.get(drawing.folderId) ?? null) : null,
    folderId: drawing.folderId,
    lastEdited: drawing.updatedAt.toISOString(),
    ...(drawing.space === "team"
      ? { creator: drawing.creator?.name ?? "Former member" }
      : {}),
    url: drawingUrl(drawing.id),
  })

  const limit = (fallback: number) =>
    z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(fallback)
      .describe(`Default ${fallback}.`)

  server.registerTool(
    "list_drawings",
    {
      title: "List drawings",
      description:
        "Lists the drawings you can see, most recently edited first, with their Space and folder.",
      inputSchema: z.object({
        space: space.optional().describe("Only this Space."),
        folderId: z
          .string()
          .optional()
          .describe("Only this folder (see list_folders)."),
        limit: limit(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ space, folderId, limit }) => {
      const { list, paths } = await visibleDrawings({ space, folderId })
      return json({
        total: list.length,
        drawings: list.slice(0, limit).map((drawing) => toRow(drawing, paths)),
      })
    },
  )

  server.registerTool(
    "search_drawings",
    {
      title: "Search drawings",
      description:
        "Finds drawings whose name or text contains every word of the query, case-insensitive. Name matches come first; each result has a snippet of the text around the match.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        space: space.optional().describe("Only this Space."),
        limit: limit(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, space, limit }) => {
      const { list, paths } = await visibleDrawings({ space })
      const results = list.flatMap((drawing) => {
        const found = matchDrawing(drawing, query)
        if (!found) return []
        const { match, snippet } = found
        return [
          { ...toRow(drawing, paths), match, ...(snippet ? { snippet } : {}) },
        ]
      })
      // Stable sort: each group keeps the most recent first.
      results.sort(
        (a, b) => Number(b.match === "name") - Number(a.match === "name"),
      )
      return json({ total: results.length, drawings: results.slice(0, limit) })
    },
  )

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "Lists the folders you can see, with their Space and path.",
      inputSchema: z.object({
        space: space.optional().describe("Only this Space."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ space }) => {
      const folders = await listFolders(db, member.id)
      const paths = folderPaths(folders)
      const rows = folders
        .filter((folder) => !space || folder.space === space)
        .map(({ id, space }) => ({ id, path: paths.get(id) ?? "", space }))
        .sort((a, b) => a.path.localeCompare(b.path))
      return json({ folders: rows })
    },
  )

  server.registerTool(
    "read_drawing",
    {
      title: "Read drawing",
      description:
        "Describes a drawing: its shapes and their labels, text, which shapes arrows connect, and what sits inside what, with positions. Not the raw Excalidraw JSON.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const [drawing] = await db
        .select({
          name: drawings.name,
          data: drawings.data,
          space: drawings.space,
          folderId: drawings.folderId,
          updatedAt: drawings.updatedAt,
        })
        .from(drawings)
        .where(
          and(
            eq(drawings.id, id),
            accessibleTo(drawings, member.id),
            isNull(drawings.deletedAt),
          ),
        )
      // Same answer for a missing drawing and one the member can't see.
      if (!drawing) {
        throw new Error(
          "No drawing has that id. Find one with list_drawings or search_drawings.",
        )
      }
      // A live Room holds newer edits than the stored scene.
      const elements =
        (await roomElements(rooms, id)) ?? parseSceneElements(drawing.data)
      if (!elements)
        throw new Error("This drawing's data is damaged and can't be read.")

      const folder = drawing.folderId
        ? folderPaths(await listFolders(db, member.id)).get(drawing.folderId)
        : undefined
      const where = [
        drawing.space === "team" ? "Team" : "Private",
        folder ? `, folder "${folder}"` : "",
      ].join("")
      return text(
        [
          `${JSON.stringify(drawing.name)} (${where}), last edited ${drawing.updatedAt.toISOString()}. ${drawingUrl(id)}`,
          summarizeScene(elements),
        ].join("\n\n"),
      )
    },
  )

  server.registerTool(
    "create_drawing",
    {
      title: "Create drawing",
      description: `Creates a NEW drawing from simple elements and/or a Mermaid flowchart, and returns its link. What is in an existing drawing can't be changed.

Elements: shapes ("rectangle", "ellipse", "diamond") with an optional label; "text"; and "arrow" or "line" connectors that join shapes by id ("from", "to") or run between points ("start", "end"). Shapes and text without x/y are laid out automatically, in "direction", with arrows routed between them; labels wrap and shapes grow to fit. Auto-layout gives the cleanest diagrams: give x/y (top-left, pixels, y grows down) only for layouts a graph can't express, such as grids or timelines. Keep arrow labels to a few words; put detail in shape labels or a text note.

Mermaid: a "flowchart"/"graph" diagram, with node shapes, edge labels, dotted and thick edges, and subgraphs (drawn as titled boxes). Other Mermaid diagram types are not supported. Both can be sent at once: they are laid out together, and arrows may join flowchart nodes by their Mermaid ids. Up to ${MAX_ELEMENTS} elements in all, Mermaid nodes and edges included.

Colors: Excalidraw's palette reads best, e.g. backgrounds "#a5d8ff" (blue), "#b2f2bb" (green), "#ffec99" (yellow), "#ffc9c9" (red), "#d0bfff" (violet), "#e9ecef" (gray).`,
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        space: space
          .default("private")
          .describe(
            'Default "private". Ignored with folderId: a drawing takes its folder\'s Space.',
          ),
        folderId: z
          .string()
          .optional()
          .describe("Put it in this folder (see list_folders)."),
        elements: z.array(elementSkeleton).max(MAX_ELEMENTS).optional(),
        mermaid: z
          .string()
          .max(50_000)
          .optional()
          .describe("A Mermaid flowchart."),
        direction: z
          .enum(directions)
          .optional()
          .describe(
            'Auto-layout flow: "TB" top to bottom (default), "LR" left to right, "BT", "RL". Default for Mermaid: its own header.',
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => {
      const flowchart: SceneGraph = input.mermaid
        ? parseMermaid(input.mermaid)
        : { elements: [], clusters: [], direction: "TB" }
      const elements = buildScene({
        elements: [...flowchart.elements, ...(input.elements ?? [])],
        clusters: flowchart.clusters,
        direction: input.direction ?? flowchart.direction,
      })
      const created = await insertDrawing(db, member.id, {
        name: input.name,
        folderId: input.folderId ?? null,
        space: input.space,
        elements,
      })
      listUpdates.notify()
      const folder = input.folderId
        ? folderPaths(await listFolders(db, member.id)).get(input.folderId)
        : undefined
      return json({
        id: created.id,
        name: input.name,
        space: created.space,
        folder: folder ?? null,
        elements: elements.length,
        url: drawingUrl(created.id),
      })
    },
  )

  server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description:
        "Creates a folder, at the top of a Space or inside another folder. Put drawings in it with create_drawing or move_drawing.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        space: space
          .default("private")
          .describe(
            'Default "private". Ignored with parentId: a folder takes its parent\'s Space.',
          ),
        parentId: z
          .string()
          .optional()
          .describe("Put it inside this folder (see list_folders)."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, space, parentId }) => {
      const folder = await insertFolder(db, member.id, {
        name,
        parentId: parentId ?? null,
        space,
      })
      listUpdates.notify()
      const paths = folderPaths(await listFolders(db, member.id))
      return json({
        id: folder.id,
        path: paths.get(folder.id) ?? folder.name,
        space: folder.space,
      })
    },
  )

  server.registerTool(
    "move_drawing",
    {
      title: "Move drawing",
      description:
        "Moves a drawing into a folder, or to the top of its Space. The folder must be in the drawing's Space: a drawing can't move between Spaces.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        // Optional, not nullable: some clients reject a ["string", "null"] type.
        folderId: z
          .string()
          .optional()
          .describe(
            "A folder id from list_folders. Leave it out to move the drawing to the top of its Space.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        // Per the MCP spec, false means additive only; a move rewrites folderId.
        destructiveHint: true,
        // A repeat still refreshes updatedAt, so the drawing jumps up the lists.
        idempotentHint: false,
      },
    },
    async ({ id, folderId }) => {
      try {
        await updateDrawingFields(db, member.id, id, {
          folderId: folderId ?? null,
        })
      } catch (error) {
        // The engine can't tell a hidden drawing from a Space mismatch.
        if (error instanceof Error && error.message === "Drawing not found") {
          throw new Error(
            "No drawing has that id, or the folder is in the other Space. Find ids with list_drawings and list_folders.",
          )
        }
        throw error
      }
      listUpdates.notify()
      const folder = folderId
        ? folderPaths(await listFolders(db, member.id)).get(folderId)
        : undefined
      return json({ id, folder: folder ?? null, url: drawingUrl(id) })
    },
  )

  return server
}
