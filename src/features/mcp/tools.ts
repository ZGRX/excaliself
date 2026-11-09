// The MCP server one member's AI client talks to: find, read, create, and
// export drawings, propose changes to them, create folders, move drawings between
// folders, move drawings and folders to the trash and back, and read and
// write comments, under the same Space rule as that member's browser. A
// proposed change waits for the member's Apply in their own tab, which writes
// it like any edit (ADR 0003). Comments are not scene data, so they write
// directly, marked with the client's name.
// Delete forever is left out: only a member empties the trash.

import { McpServer } from "@modelcontextprotocol/server"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@/db"
import { drawings, type Space, spaces } from "@/db/schema"
import { userDisplayName } from "@/features/account/display-name"
import { MAX_DRAWING_IMAGE_BYTES } from "@/features/collab/room-files"
import { endTrashedRooms, rooms } from "@/features/collab/room-registry"
import {
  MAX_ROOM_ELEMENTS,
  MAX_ROOM_SCENE_BYTES,
  roomElements,
} from "@/features/collab/room-session"
import { parseStoredScene } from "@/features/collab/scene-store"
import {
  addReply,
  countOpenThreads,
  createThread,
  listThreads,
  setResolved,
} from "@/features/comments/store"
import { type DrawingEdit, drawingEdits } from "@/features/drawing-edits/store"
import { insertDrawing } from "@/features/drawings/create"
import { listDrawings } from "@/features/drawings/list"
import { importDrawing } from "@/features/drawings/scene-import"
import { matchDrawing, parseSceneElements } from "@/features/drawings/search"
import { updateDrawingFields } from "@/features/drawings/update"
import { insertFolder } from "@/features/folders/create"
import { listFolders } from "@/features/folders/list"
import { folderPaths } from "@/features/folders/subtree"
import { listUpdates } from "@/features/list-updates/hub"
import {
  COMMENTS_CHANGED,
  EDITS_CHANGED,
} from "@/features/list-updates/protocol"
import { accessibleTo } from "@/features/spaces/access"
import { restoreDrawingUnit, restoreFolderUnit } from "@/features/trash/restore"
import { purgeDeadline, TRASH_RETENTION_DAYS } from "@/features/trash/retention"
import { trashDrawingUnit, trashFolderUnit } from "@/features/trash/trash"
import packageJson from "../../../package.json"
import { anchorForTool, describeAnchor } from "./comments"
import { exportImage } from "./export/image"
import {
  loadImageFiles,
  sceneBackgroundColor,
  storedAppState,
} from "./export/scene-data"
import { MAX_SCENE_BYTES, toExcalidrawFile } from "./export/scene-file"
import { buildScene } from "./scene/build"
import { elementChange, planEdit } from "./scene/edit"
import { parseImportedScene } from "./scene/import"
import { parseMermaid } from "./scene/mermaid"
import {
  directions,
  elementSkeleton,
  MAX_ELEMENTS,
  type SceneGraph,
} from "./scene/skeleton"
import { summarizeScene } from "./summary"

export type Member = {
  id: string
  name: string
  email: string
  /** The connected app's or access token's name, shown on proposed edits. */
  client: string
}

/** How long edit_drawing and get_drawing_edit wait for the member to decide. */
export const EDIT_WAIT_MS = 25_000

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
      instructions: `Excaliself is a self-hosted Excalidraw. You act as ${userDisplayName(member)}. Every drawing and folder lives in a Space: "private" (only this member sees it) or "team" (every member sees it). You can find, read, create, and export drawings (as images or .excalidraw files), import .excalidraw files as new drawings, create folders, move drawings between folders of one Space, move drawings and folders to the trash or back, and read, start, reply to, and resolve comment threads pinned to a drawing. Members can restore trashed items from Trash for ${TRASH_RETENTION_DAYS} days. You can't delete anything for good.

To change what is in an existing drawing, read it with read_drawing, then propose the change with edit_drawing. Nothing changes until the member clicks Apply on the drawing in Excaliself. Give them the drawing's link, and never say a change is done until a tool reports "applied".

Comments you write show as written by this member via ${member.client}, and appear at once.`,
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

  /** A drawing the member can see and that is not trashed. */
  const findDrawing = async (id: string) => {
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
    return drawing
  }

  /** The scene now: a live Room holds newer edits than the stored scene. */
  const currentElements = async (id: string, data: string) => {
    const elements = (await roomElements(rooms, id)) ?? parseSceneElements(data)
    if (!elements)
      throw new Error("This drawing's data is damaged and can't be read.")
    return elements as Record<string, unknown>[]
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
        "Describes a drawing: its shapes and their labels, text, which shapes arrows connect, and what sits inside what, with positions and element ids (for edit_drawing). Not the raw Excalidraw JSON.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const drawing = await findDrawing(id)
      const elements = await currentElements(id, drawing.data)
      const openThreads = await countOpenThreads(db, id)

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
          ...(openThreads > 0
            ? [
                `${openThreads} open comment ${openThreads === 1 ? "thread" : "threads"} (see list_comments).`,
              ]
            : []),
        ].join("\n\n"),
      )
    },
  )

  server.registerTool(
    "export_drawing",
    {
      title: "Export drawing as image",
      description: `Exports a drawing as an image file, as Excalidraw's "Export image" does, for documentation, a README, or slides. The file comes back attached: PNG as image content, SVG as an embedded resource. Clients that save attachments give you a file path to copy from.

"png" (default) is a bitmap that every client can show. "svg" stays sharp at any size and embeds the drawing's fonts, so it looks the same anywhere, even in an <img>.`,
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        format: z
          .enum(["png", "svg"])
          .default("png")
          .describe('Default "png".'),
        darkMode: z
          .boolean()
          .default(false)
          .describe("Dark mode, as the canvas shows it. Default false."),
        background: z
          .boolean()
          .default(true)
          .describe(
            "Fill the canvas color behind the drawing. false gives a transparent background. Default true.",
          ),
        padding: z
          .number()
          .int()
          .min(0)
          .max(200)
          .default(10)
          .describe("Space around the drawing, in pixels. Default 10."),
        scale: z
          .number()
          .min(0.25)
          .max(4)
          .optional()
          .describe(
            "Size multiplier. Default 2 for PNG (sharp on high-density screens), 1 for SVG.",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, format, darkMode, background, padding, scale }) => {
      const drawing = await findDrawing(id)
      // A live Room holds newer edits than the stored scene.
      const elements =
        (await roomElements(rooms, id)) ?? parseSceneElements(drawing.data)
      if (!elements)
        throw new Error("This drawing's data is damaged and can't be read.")
      const image = await exportImage(
        elements,
        await loadImageFiles(db, id, elements),
        {
          format,
          darkMode,
          background,
          backgroundColor: sceneBackgroundColor(drawing.data),
          padding,
          scale: scale ?? (format === "png" ? 2 : 1),
        },
      )
      if (!image)
        throw new Error("The drawing is empty: there is nothing to export.")
      const data = image.data.toString("base64")
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              name: drawing.name,
              format,
              width: image.width,
              height: image.height,
              bytes: image.data.length,
              url: drawingUrl(id),
            }),
          },
          image.mimeType === "image/png"
            ? { type: "image" as const, data, mimeType: image.mimeType }
            : {
                type: "resource" as const,
                resource: {
                  uri: `excaliself://export/${id}.svg`,
                  mimeType: image.mimeType,
                  blob: data,
                },
              },
        ],
      }
    },
  )

  server.registerTool(
    "export_scene",
    {
      title: "Export drawing as .excalidraw file",
      description: `Exports a drawing as an .excalidraw file: the raw scene JSON that Excalidraw's "Save to file" writes, which Excalidraw and excalidraw.com open. The file comes back attached as an embedded resource; clients that save attachments give you a file path to copy from. To understand a drawing, use read_drawing instead.

Images are left out by default: their elements stay, but show as missing images. With includeImages they are embedded as base64, which can be large. Files over ${MAX_SCENE_BYTES / 1024 / 1024} MB are refused.`,
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        includeImages: z
          .boolean()
          .default(false)
          .describe("Embed the drawing's images. Default false."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, includeImages }) => {
      const drawing = await findDrawing(id)
      // A live Room holds newer edits than the stored scene.
      const elements =
        (await roomElements(rooms, id)) ?? parseSceneElements(drawing.data)
      if (!elements)
        throw new Error("This drawing's data is damaged and can't be read.")
      const files = includeImages
        ? await loadImageFiles(db, id, elements)
        : new Map()
      const file = Buffer.from(
        toExcalidrawFile({
          elements,
          appState: storedAppState(drawing.data),
          files,
          source: origin,
        }),
      )
      if (file.length > MAX_SCENE_BYTES) {
        const size = `${(file.length / 1024 / 1024).toFixed(1)} MB`
        throw new Error(
          includeImages
            ? `The file would be ${size}, over the ${MAX_SCENE_BYTES / 1024 / 1024} MB limit. Leave out images (includeImages: false).`
            : `The file would be ${size}, over the ${MAX_SCENE_BYTES / 1024 / 1024} MB limit.`,
        )
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              name: drawing.name,
              elements: elements.filter((element) => !element.isDeleted).length,
              images: files.size,
              bytes: file.length,
              url: drawingUrl(id),
            }),
          },
          {
            type: "resource" as const,
            resource: {
              uri: `excaliself://export/${id}.excalidraw`,
              mimeType: "application/vnd.excalidraw+json",
              blob: file.toString("base64"),
            },
          },
        ],
      }
    },
  )

  server.registerTool(
    "create_drawing",
    {
      title: "Create drawing",
      description: `Creates a NEW drawing from simple elements and/or a Mermaid flowchart, and returns its link. To change an existing drawing, use edit_drawing.

Elements: shapes ("rectangle", "ellipse", "diamond") with an optional label; "text"; and "arrow" or "line" connectors that join shapes by id ("from", "to") or run between points ("start", "end"). Shapes and text without x/y are laid out automatically, in "direction", with arrows routed between them; labels wrap and shapes grow to fit. Auto-layout gives the cleanest diagrams: give x/y (top-left, pixels, y grows down) only for layouts a graph can't express, such as grids or timelines. Keep arrow labels to a few words; put detail in shape labels or a text note.

Mermaid: a "flowchart"/"graph" diagram, with node shapes, edge labels, dotted and thick edges, subgraphs (drawn as titled boxes), and node colors from "style id fill:#a5d8ff,stroke:#1971c2" lines (hex or named colors) (classDef and class are ignored). Other Mermaid diagram types are not supported. Both can be sent at once: they are laid out together, and arrows may join flowchart nodes by their Mermaid ids. Up to ${MAX_ELEMENTS} elements in all, Mermaid nodes and edges included.

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
    "import_scene",
    {
      title: "Import scene",
      description: `Creates a NEW drawing from an Excalidraw scene: the JSON of a .excalidraw file, as Excalidraw's "Save to file" writes it, with images inline in "files". Returns its link. To draw from a description instead, use create_drawing.

Up to ${MAX_ROOM_ELEMENTS.toLocaleString("en")} elements and ${MAX_ROOM_SCENE_BYTES / 1024 / 1024} MB of element JSON; images up to ${MAX_DRAWING_IMAGE_BYTES / 1024 / 1024} MB in all. The whole call must stay under 4 MB; send a large scene as JSON text, not an object. Images with no entry in "files" open as placeholders.`,
      inputSchema: z.object({
        // Some clients send JSON-looking text as an object. The meta makes
        // the schema say `additionalProperties: true`, not a bare `{}`.
        scene: z
          .union([
            z.string().min(1),
            z.looseObject({}).meta({ additionalProperties: true }),
          ])
          .describe(
            'The .excalidraw file: its JSON text, or that JSON as an object, with "elements", and "files" for images.',
          ),
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe('Default "Untitled".'),
        space: space
          .default("private")
          .describe(
            'Default "private". Ignored with folderId: a drawing takes its folder\'s Space.',
          ),
        folderId: z
          .string()
          .optional()
          .describe("Put it in this folder (see list_folders)."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => {
      const { content, missingImages } = parseImportedScene(input.scene)
      const name = input.name ?? "Untitled"
      const created = await importDrawing(db, member.id, {
        name,
        folderId: input.folderId ?? null,
        space: input.space,
        lastModified: Date.now(),
        content,
      })
      listUpdates.notify()
      const folder = input.folderId
        ? folderPaths(await listFolders(db, member.id)).get(input.folderId)
        : undefined
      return json({
        id: created.id,
        name,
        space: created.space,
        folder: folder ?? null,
        elements: content.elements.length,
        images: Object.keys(content.files).length,
        ...(missingImages > 0
          ? {
              missingImages,
              note: `${missingImages} image(s) had no data in "files" and open as placeholders.`,
            }
          : {}),
        url: drawingUrl(created.id),
      })
    },
  )

  const editMessages: Record<DrawingEdit["status"], string> = {
    pending: `Nothing has changed yet. ${userDisplayName(member)} must click Apply on the drawing in Excaliself. Give them the link, then call get_drawing_edit for the result.`,
    applying:
      "The member clicked Apply and it is being applied. Call get_drawing_edit for the result.",
    applied:
      "Applied. Everyone with the drawing open sees the change, and the member can undo it.",
    discarded: "The member discarded it. Nothing changed.",
    stale:
      "Not applied: the drawing changed before the member clicked Apply. Read it again, and propose the change again if it is still wanted.",
    replaced:
      "A newer proposal for this drawing took its place. Nothing changed from this one.",
    expired: "It expired before the member decided. Nothing changed.",
    unconfirmed:
      "The member clicked Apply, but their tab never confirmed the outcome. Read the drawing to see whether the change is there before proposing it again.",
  }
  const editResult = (edit: DrawingEdit) =>
    json({
      editId: edit.id,
      status: edit.status,
      message: editMessages[edit.status],
      changes: edit.changes,
      url: drawingUrl(edit.drawingId),
    })

  server.registerTool(
    "edit_drawing",
    {
      title: "Propose a drawing edit",
      description: `Proposes a change to an existing drawing. Nothing changes until the member clicks Apply on the drawing in Excaliself, where they see a preview; this tool then reports "applied", "discarded", or "stale". It waits up to ${EDIT_WAIT_MS / 1000} seconds for that, then returns "pending": tell the member to open the link, and call get_drawing_edit later.

Read the drawing with read_drawing first, and refer to its elements by the [id …] it shows.
- add: new elements, in create_drawing's format. Arrows may join existing shapes by element id ("from", "to"). Give new shapes x/y next to the shapes they relate to (read_drawing gives positions); without x/y they are laid out beside the drawing.
- change: by element id. Shapes take label, x/y (move), width/height, colors, and strokeStyle; text takes text, x/y, and strokeColor; arrows take label, strokeColor, and strokeStyle. Arrows bound to a moved shape follow it. To attach an arrow to other shapes, remove it and add a new one.
- remove: element ids. A shape's label goes with it; arrows bound to it stay, unattached.`,
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'One line the member reads before Apply, e.g. "Add a CDN in front of the API".',
          ),
        add: z.array(elementSkeleton).max(MAX_ELEMENTS).default([]),
        change: z.array(elementChange).max(MAX_ELEMENTS).default([]),
        remove: z
          .array(z.string())
          .max(MAX_ELEMENTS)
          .default([])
          .describe("Element ids from read_drawing."),
      }),
      annotations: {
        readOnlyHint: false,
        // It writes nothing: only the member's Apply in Excaliself does.
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ id, summary, add, change, remove }) => {
      if (add.length + change.length + remove.length === 0)
        throw new Error("Nothing to change: give add, change, or remove.")
      const drawing = await findDrawing(id)
      // A live Room holds newer edits than the stored scene.
      const live = await roomElements(rooms, id)
      const stored = live ? null : parseStoredScene(drawing.data)
      if (stored && !stored.readable)
        throw new Error("This drawing's data is damaged and can't be changed.")
      const plan = planEdit(live ?? stored?.elements ?? [], {
        add,
        change,
        remove,
      })
      const edit = drawingEdits.propose({
        drawingId: id,
        userId: member.id,
        client: member.client,
        summary,
        ...plan,
      })
      listUpdates.notify(EDITS_CHANGED)
      const decided = await drawingEdits.wait(edit.id, member.id, EDIT_WAIT_MS)
      return editResult(decided ?? edit)
    },
  )

  server.registerTool(
    "get_drawing_edit",
    {
      title: "Check a drawing edit",
      description: `Reports whether the member applied an edit from edit_drawing. While it is still pending, waits up to ${EDIT_WAIT_MS / 1000} seconds for their decision.`,
      inputSchema: z.object({
        editId: z.string().describe("The editId edit_drawing returned."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ editId }) => {
      const edit = await drawingEdits.wait(editId, member.id, EDIT_WAIT_MS)
      if (!edit) throw new Error("No edit has that id.")
      return editResult(edit)
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

  const trasher = { userId: member.id, name: userDisplayName(member) }
  const trashed = (id: string) => ({
    id,
    restorableUntil: purgeDeadline(new Date()).toISOString(),
  })

  server.registerTool(
    "trash_drawing",
    {
      title: "Move drawing to trash",
      description: `Moves one drawing to the trash. Members can restore it from Trash for ${TRASH_RETENTION_DAYS} days; after that it is deleted for good. In Team, every member loses it.`,
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      await trashDrawingUnit(db, member.id, id)
      await endTrashedRooms([id], trasher)
      listUpdates.notify()
      return json(trashed(id))
    },
  )

  server.registerTool(
    "trash_folder",
    {
      title: "Move folder to trash",
      description: `Moves one folder to the trash, with its subfolders and every drawing in them. Members can restore it from Trash for ${TRASH_RETENTION_DAYS} days, as one unit; after that it is deleted for good. In Team, every member loses it.`,
      inputSchema: z.object({
        id: z.string().describe("A folder id from list_folders."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      const swept = await trashFolderUnit(db, member.id, id)
      await endTrashedRooms(swept, trasher)
      listUpdates.notify()
      return json({ ...trashed(id), drawings: swept.length })
    },
  )

  server.registerTool(
    "restore_drawing",
    {
      title: "Restore drawing",
      description:
        "Takes a drawing out of the trash, back to its folder. If that folder is gone, it lands in the nearest folder above it, or at the top level.",
      inputSchema: z.object({
        id: z.string().describe("The id of a trashed drawing."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      const { originalFolderGone } = await restoreDrawingUnit(db, member.id, id)
      listUpdates.notify()
      return json({ id, originalFolderGone, url: drawingUrl(id) })
    },
  )

  server.registerTool(
    "restore_folder",
    {
      title: "Restore folder",
      description:
        "Takes a folder out of the trash, with everything that was trashed with it. If its parent folder is gone, it lands in the nearest folder above it, or at the top level.",
      inputSchema: z.object({
        id: z.string().describe("The id of a trashed folder."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      const { originalParentGone } = await restoreFolderUnit(db, member.id, id)
      listUpdates.notify()
      return json({ id, originalParentGone })
    },
  )

  const commentBodyInput = z
    .string()
    .describe("Plain text, up to 2000 characters. No Markdown.")

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "Lists the comment threads pinned to a drawing, oldest first, with their comments. Each thread is pinned to an element (with its label, or deleted: true once the element is gone) or to a canvas point.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        includeResolved: z
          .boolean()
          .default(false)
          .describe("Also list resolved threads. Default false."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, includeResolved }) => {
      const drawing = await findDrawing(id)
      const elements = await currentElements(id, drawing.data)
      const threads = (await listThreads(db, member.id, id)).filter(
        (thread) => includeResolved || thread.resolvedAt === null,
      )
      return json({
        total: threads.length,
        threads: threads.map((thread) => ({
          threadId: thread.id,
          status: thread.resolvedAt ? "resolved" : "open",
          ...(thread.resolvedAt && {
            resolvedBy: thread.resolvedBy?.name ?? "Former member",
          }),
          pinnedTo: describeAnchor(thread, elements),
          comments: thread.comments.map((comment) => ({
            author: comment.author?.name ?? "Former member",
            ...(comment.via && { via: comment.via }),
            body: comment.body,
            at: comment.createdAt.toISOString(),
            ...(comment.editedAt && { edited: true }),
          })),
        })),
        url: drawingUrl(id),
      })
    },
  )

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description:
        "Starts a comment thread on a drawing, pinned to an element (see read_drawing for ids) or, without one, to the top-left of the drawing. Every member who can see the drawing sees it at once.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("A drawing id from list_drawings or search_drawings."),
        body: commentBodyInput,
        elementId: z
          .string()
          .optional()
          .describe("Pin the thread to this element."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, body, elementId }) => {
      const drawing = await findDrawing(id)
      const anchor = anchorForTool(
        await currentElements(id, drawing.data),
        elementId,
      )
      const threadId = await createThread(db, member.id, {
        drawingId: id,
        anchor,
        body,
        via: member.client,
      })
      listUpdates.notify(COMMENTS_CHANGED)
      return json({ threadId, url: drawingUrl(id) })
    },
  )

  server.registerTool(
    "reply_to_comment",
    {
      title: "Reply to comment",
      description:
        "Adds a comment to an open thread. A resolved thread must be reopened first (resolve_comment with resolved: false).",
      inputSchema: z.object({
        threadId: z.string().describe("A threadId from list_comments."),
        body: commentBodyInput,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ threadId, body }) => {
      await addReply(db, member.id, { threadId, body, via: member.client })
      listUpdates.notify(COMMENTS_CHANGED)
      return json({ threadId })
    },
  )

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve comment",
      description:
        "Resolves a comment thread when what it asks for is done, or reopens it. Resolved threads are hidden on the canvas by default.",
      inputSchema: z.object({
        threadId: z.string().describe("A threadId from list_comments."),
        resolved: z
          .boolean()
          .default(true)
          .describe("false reopens the thread. Default true."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ threadId, resolved }) => {
      await setResolved(db, member.id, threadId, resolved)
      listUpdates.notify(COMMENTS_CHANGED)
      return json({ threadId, status: resolved ? "resolved" : "open" })
    },
  )

  return server
}
