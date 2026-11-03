import type { LibraryItems } from "@excalidraw/excalidraw/types"
import { queryOptions } from "@tanstack/react-query"
import { getLibrary } from "./server"

/** A change the server refused; the message says why, for the member. */
export class LibraryChangeRefused extends Error {}

/** Reads a library server fn's raw answer: the library, or a refusal. */
export async function readLibraryResponse(
  response: Response,
): Promise<LibraryItems> {
  if (!response.ok) throw new LibraryChangeRefused(await response.text())
  return response.json()
}

/** Never stale: the lists socket says when it changed. */
export const libraryQueryOptions = () =>
  queryOptions({
    queryKey: ["library"] as const,
    queryFn: async () => readLibraryResponse(await getLibrary()),
    staleTime: Number.POSITIVE_INFINITY,
  })
