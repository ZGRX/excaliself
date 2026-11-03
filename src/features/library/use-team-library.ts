import { useHandleLibrary } from "@excalidraw/excalidraw"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { toast } from "sonner"
import {
  LibraryChangeRefused,
  libraryQueryOptions,
  readLibraryResponse,
} from "./queries"
import { changeLibrary } from "./server"
import { createLibrarySync } from "./sync"

/**
 * Shows the team library in the editor's Library panel and saves its edits.
 * Returns the `onLibraryChange` handler.
 */
export function useTeamLibrary(excalidrawAPI: ExcalidrawImperativeAPI | null) {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery(libraryQueryOptions())

  const sync = useMemo(
    () =>
      excalidrawAPI &&
      createLibrarySync({
        save: async (change) =>
          readLibraryResponse(await changeLibrary({ data: change })),
        load: () =>
          queryClient.fetchQuery({ ...libraryQueryOptions(), staleTime: 0 }),
        show: (libraryItems) => {
          void excalidrawAPI.updateLibrary({ libraryItems })
        },
        onSaveError: (error) =>
          toast.error("Couldn't save the library change", {
            id: "library-save-error",
            description:
              error instanceof LibraryChangeRefused ? error.message : undefined,
          }),
      }),
    [excalidrawAPI, queryClient],
  )
  useEffect(() => {
    if (sync && data) sync.receive(data)
  }, [sync, data])

  // Installs from "Browse libraries": the site sends a tab back with an
  // `#addLibrary` link, Excalidraw adds the items, and the change saves them.
  // Held until the team library is shown, which would replace the install;
  // declared after the effect above so it runs second in the same commit.
  useHandleLibrary({ excalidrawAPI: isPending ? null : excalidrawAPI })

  return sync?.change
}
