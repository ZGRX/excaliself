import {
  CaptureUpdateAction,
  getCommonBounds,
  getNonDeletedElements,
  hashString,
  restore,
  serializeAsJSON,
  zoomToFitBounds,
} from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { parseFileUpload } from "@/features/collab/room-files"
import { drawingShareQueryOptions } from "@/features/shares/queries"
import { drawingQueryOptions, drawingsQueryOptions } from "./queries"
import { extractSceneText } from "./search"
import { saveDrawingScene } from "./server"

export type SceneData = {
  elements: readonly ExcalidrawElement[]
  appState: AppState
  files: BinaryFiles
}

export type PersistedFile = {
  fileId: string
  mimeType: string
  dataUrl: string
  createdAt?: Date | string | null
}

/** Exactly what gets sent to the server and stored. */
export type ScenePayload = {
  data: string
  files: PersistedFile[]
}

function toPersistedFiles(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): PersistedFile[] {
  // Excalidraw keeps file bytes in `files` even after the referencing image
  // element is deleted (for undo). Persist only files still referenced by a
  // live image element so removals on the canvas actually drop the row.
  const referenced = new Set<string>()
  for (const element of elements) {
    if (
      element.type === "image" &&
      !element.isDeleted &&
      element.status !== "error" &&
      element.fileId
    ) {
      referenced.add(element.fileId)
    }
  }
  return Object.entries(files ?? {})
    .filter(([fileId]) => referenced.has(fileId))
    .map(([fileId, file]) => ({
      fileId,
      mimeType: file.mimeType || "image/png",
      dataUrl: file.dataURL || "",
    }))
}

/**
 * Unstored images over the upload cap. The server would refuse them, so the
 * canvas flags them `error` as a room does. Stored ones load `pending` too,
 * hence `stored`.
 */
export function selectOversizedImages(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
  stored: ReadonlySet<string>,
): string[] {
  return elements.flatMap((element) => {
    if (element.type !== "image" || element.isDeleted) return []
    const { fileId, status } = element
    if (!fileId || status === "error" || stored.has(fileId)) return []
    const dataUrl = files[fileId]?.dataURL
    if (!dataUrl) return []
    return parseFileUpload(fileId, { dataUrl }).status === "too-large"
      ? [fileId]
      : []
  })
}

export function buildScenePayload(scene: SceneData): ScenePayload {
  return {
    data: serializeAsJSON(
      scene.elements,
      scene.appState,
      scene.files ?? {},
      "database",
    ),
    files: toPersistedFiles(scene.elements, scene.files ?? {}),
  }
}

/**
 * Fingerprint of the persisted payload itself, so dedup compares exactly what
 * would be stored and can't drift from Excalidraw's persistence rules.
 */
export function getScenePayloadSignature(payload: ScenePayload) {
  const filesSignature = payload.files
    .map(
      (file) => `${file.fileId}:${file.mimeType}:${hashString(file.dataUrl)}`,
    )
    .join(",")
  return `${hashString(payload.data)}|${filesSignature}`
}

function toBinaryFiles(
  persistedFiles: PersistedFile[] | null | undefined,
): BinaryFiles {
  const files: BinaryFiles = {}
  for (const file of persistedFiles ?? []) {
    const createdMs = file.createdAt ? new Date(file.createdAt).getTime() : 0
    files[file.fileId] = {
      id: file.fileId,
      mimeType: file.mimeType,
      dataURL: file.dataUrl,
      created: Number.isFinite(createdMs) ? createdMs : 0,
    } as BinaryFiles[string]
  }
  return files
}

function parseSceneData(raw: string | undefined | null): {
  parsed: ExcalidrawInitialDataState | null
  isCorrupt: boolean
} {
  if (!raw) return { parsed: null, isCorrupt: false }
  try {
    return {
      parsed: JSON.parse(raw) as ExcalidrawInitialDataState,
      isCorrupt: false,
    }
  } catch {
    return { parsed: null, isCorrupt: true }
  }
}

/** A canvas to open content in; `offsets` keep it clear of the UI on top. */
export type FitTo = {
  width: number
  height: number
  offsets?: { top: number; right: number; bottom: number; left: number }
}

/**
 * `fitTo` opens the view centered on the content, zoomed out to fit that
 * canvas, but never past 100%. Saved scenes carry no scroll or zoom, so
 * without it the view opens at the origin.
 */
export function buildInitialSceneData(
  drawing: { data: string; files?: PersistedFile[] | null } | null | undefined,
  fitTo?: FitTo,
): { initialData: ExcalidrawInitialDataState; isDataCorrupt: boolean } {
  const files = toBinaryFiles(drawing?.files)
  const { parsed, isCorrupt } = parseSceneData(drawing?.data)
  const restored = restore(
    parsed
      ? { elements: parsed.elements, appState: parsed.appState, files }
      : null,
    null,
    null,
  )
  // JSON persistence flattens collaborators to a plain object; Excalidraw
  // requires a Map.
  restored.appState.collaborators = new Map()
  const elements = fitTo ? getNonDeletedElements(restored.elements) : []
  if (fitTo && elements.length > 0) {
    const { width, height, offsets } = fitTo
    // Without fitToViewport it never zooms in past 100%.
    const { scrollX, scrollY, zoom } = zoomToFitBounds({
      appState: {
        ...restored.appState,
        width,
        height,
        offsetTop: 0,
        offsetLeft: 0,
      },
      bounds: getCommonBounds(elements),
      canvasOffsets: offsets,
      fitToViewport: false,
      viewportZoomFactor: 0.9,
    }).appState
    // Snap to whole screen pixels: centering in an odd-sized canvas lands on
    // a half pixel, where Excalidraw's unsmoothed element bitmaps render
    // ragged on 1x screens until the next pan or zoom.
    const snap = (scroll: number) =>
      Math.round(scroll * zoom.value) / zoom.value
    restored.appState = {
      ...restored.appState,
      scrollX: snap(scrollX),
      scrollY: snap(scrollY),
      zoom,
    }
  }
  return { initialData: { ...restored, files }, isDataCorrupt: isCorrupt }
}

export function useDrawingScene(id: string, fitTo?: FitTo) {
  const { data: drawing } = useQuery(drawingQueryOptions(id))
  const scene = useMemo(
    () => (drawing ? buildInitialSceneData(drawing, fitTo) : null),
    [drawing, fitTo],
  )
  return {
    drawing,
    initialData: scene?.initialData ?? null,
    isDataCorrupt: scene?.isDataCorrupt ?? false,
  }
}

/**
 * After a room ends (link stopped, dead, or gone on reconnect), this tab's
 * scene may be stale: guests drew while it slept. Loads the stored scene into
 * the canvas. True from the render the share goes away until that lands;
 * autosave must stay paused meanwhile, or the stale scene overwrites theirs.
 */
export function useReloadSceneAfterRoom(
  drawingId: string,
  isShared: boolean,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
) {
  const queryClient = useQueryClient()
  const [wasShared, setWasShared] = useState(isShared)
  const [reloading, setReloading] = useState(false)
  // Set during render, so the same commit already holds autosave.
  if (wasShared !== isShared) {
    setWasShared(isShared)
    if (!isShared) setReloading(true)
  }

  useEffect(() => {
    if (!reloading || !excalidrawAPI) return
    let cancelled = false
    queryClient
      .fetchQuery({ ...drawingQueryOptions(drawingId), staleTime: 0 })
      .then(
        (drawing) => {
          // Gone: nothing to load, and nothing may be saved.
          if (cancelled || !drawing) return
          const { initialData, isDataCorrupt } = buildInitialSceneData(drawing)
          // The corrupt-scene pause guards that case; don't blank the canvas.
          if (!isDataCorrupt) {
            excalidrawAPI.addFiles(Object.values(initialData.files ?? {}))
            excalidrawAPI.updateScene({
              elements: initialData.elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            })
          }
          setReloading(false)
        },
        () => {
          if (cancelled) return
          toast.error("Couldn't load the latest version of this drawing", {
            id: `scene-reload:${drawingId}`,
            duration: Number.POSITIVE_INFINITY,
            description:
              "Your changes aren't being saved. Reload the page to continue.",
          })
        },
      )
    return () => {
      cancelled = true
    }
  }, [reloading, excalidrawAPI, drawingId, queryClient])

  return reloading
}

/** `onOverCap` gets images the server refused: the drawing's image cap is full. */
export function useSaveScenePayload(
  id: string,
  onOverCap: (fileIds: string[]) => void,
) {
  const queryClient = useQueryClient()
  return useCallback(
    async (payload: ScenePayload) => {
      const send = (files: PersistedFile[]) =>
        saveDrawingScene({
          data: {
            id,
            data: payload.data,
            files: files.map(({ fileId, dataUrl }) => ({ fileId, dataUrl })),
          },
        })
      // Image bytes go up once: skip what the last committed save stored.
      const stored = new Set(
        queryClient
          .getQueryData(drawingQueryOptions(id).queryKey)
          ?.files.map((file) => file.fileId),
      )
      let result = await send(
        payload.files.filter((file) => !stored.has(file.fileId)),
      )
      const overCap = new Set<string>()
      if (result.status === "saved") {
        for (const fileId of result.overCapFileIds) overCap.add(fileId)
        // The server lost some (another tab removed them): send those too.
        const missing = new Set(result.missingFileIds)
        const resend = payload.files.filter((file) => missing.has(file.fileId))
        if (resend.length > 0) result = await send(resend)
        if (result.status === "saved")
          for (const fileId of result.overCapFileIds) overCap.add(fileId)
      }
      // Shared or moved to Team elsewhere: refetching the share and the
      // drawing flips this canvas to a Room, and joining it reconciles the
      // local scene.
      if (result.status === "shared") {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: drawingShareQueryOptions(id).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: drawingQueryOptions(id).queryKey,
            exact: true,
          }),
        ])
        return "skipped"
      }
      if (overCap.size > 0) onOverCap([...overCap])
      // Mirror the committed payload into the caches instead of invalidating:
      // refetching the detail query would re-download every base64 blob the
      // client just uploaded.
      const updatedAt = new Date()
      queryClient.setQueryData(drawingQueryOptions(id).queryKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          data: payload.data,
          updatedAt,
          files: payload.files.flatMap((file) => {
            if (overCap.has(file.fileId)) return []
            const existing = prev.files.find((f) => f.fileId === file.fileId)
            return [existing ?? { ...file, createdAt: updatedAt }]
          }),
        }
      })
      queryClient.setQueryData(drawingsQueryOptions().queryKey, (drawings) =>
        drawings?.map((drawing) =>
          drawing.id === id
            ? {
                ...drawing,
                searchText: extractSceneText(payload.data),
                updatedAt,
              }
            : drawing,
        ),
      )
      return "saved"
    },
    [id, queryClient, onOverCap],
  )
}
