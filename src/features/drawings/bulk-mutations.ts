import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { drawingShareQueryOptions } from "@/features/shares/queries"
import { useOptimisticListMutation } from "@/hooks/use-optimistic-list-mutation"
import {
  moveDrawingsToFolder,
  moveDrawingsToTeam,
  restoreDrawings,
  setDrawingsStarred,
  trashDrawings,
} from "./bulk-server"
import { insertByRecency } from "./mutations"
import { type Drawing, drawingsQueryOptions } from "./queries"

export const countDrawings = (n: number) => `${n} drawing${n === 1 ? "" : "s"}`

// Patches the listed drawings, leaves the rest.
const patchIds = (list: Drawing[], ids: string[], patch: Partial<Drawing>) => {
  const set = new Set(ids)
  return list.map((d) => (set.has(d.id) ? { ...d, ...patch } : d))
}

/** Star or unstar many drawings, optimistically. */
export function useBulkStar() {
  return useOptimisticListMutation<
    Drawing,
    Parameters<typeof setDrawingsStarred>[0]
  >({
    queryKey: drawingsQueryOptions().queryKey,
    mutationFn: setDrawingsStarred,
    optimisticUpdate: (list, { data }) =>
      patchIds(list, data.ids, { starred: data.starred }),
    onRollback: ({ data }) =>
      toast.error(data.starred ? "Failed to star" : "Failed to unstar"),
  })
}

/** Move many drawings into one folder (null: the top of their space). */
export function useBulkMoveToFolder() {
  return useOptimisticListMutation<
    Drawing,
    Parameters<typeof moveDrawingsToFolder>[0]
  >({
    queryKey: drawingsQueryOptions().queryKey,
    mutationFn: moveDrawingsToFolder,
    optimisticUpdate: (list, { data }) =>
      patchIds(list, data.ids, { folderId: data.folderId }),
    onRollback: () => toast.error("Failed to move"),
  })
}

/**
 * Tier-1 destructive, like a single Move to trash: no confirm, the cards go
 * at once, and one undo toast brings them all back.
 */
export function useBulkTrash() {
  const queryClient = useQueryClient()
  const queryKey = drawingsQueryOptions().queryKey
  // Key literal, as in useTrashDrawing: keeps the trash feature out.
  const invalidateTrash = () =>
    queryClient.invalidateQueries({ queryKey: ["trash"] })

  const restoreMutation = useMutation({
    mutationFn: restoreDrawings,
    onError: () => toast.error("Couldn't restore drawings"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
      invalidateTrash()
    },
  })

  const trashMutation = useOptimisticListMutation<
    Drawing,
    Parameters<typeof trashDrawings>[0]
  >({
    queryKey,
    mutationFn: trashDrawings,
    optimisticUpdate: (list, { data: ids }) => {
      const set = new Set(ids)
      return list.filter((d) => !set.has(d.id))
    },
  })

  return (drawings: Drawing[]) => {
    const ids = drawings.map((d) => d.id)
    const trashed = trashMutation.mutateAsync({ data: ids })
    trashed.then(invalidateTrash, () => {})
    const toastId = toast(`Moved ${countDrawings(ids.length)} to trash`, {
      action: {
        label: "Undo",
        onClick: () => {
          // Wait out the trash call so restore can't race it server-side.
          trashed
            .then(() => {
              queryClient.setQueryData<Drawing[]>(queryKey, (list = []) =>
                drawings.reduce(insertByRecency, list),
              )
              restoreMutation.mutate({ data: ids })
            })
            .catch(() => {})
        },
      },
    })
    trashed.catch(() => {
      toast.dismiss(toastId)
      toast.error("Couldn't move to trash")
    })
  }
}

/** Private → Team root, after the confirm. */
export function useBulkMoveToTeam() {
  const queryClient = useQueryClient()
  const queryKey = drawingsQueryOptions().queryKey
  return useMutation({
    mutationFn: moveDrawingsToTeam,
    onSuccess: (_result, { data: ids }) => {
      queryClient.setQueryData<Drawing[]>(
        queryKey,
        (list) =>
          list && patchIds(list, ids, { space: "team", folderId: null }),
      )
      // Members links are gone.
      for (const id of ids)
        void queryClient.invalidateQueries({
          queryKey: drawingShareQueryOptions(id).queryKey,
        })
      void queryClient.invalidateQueries({ queryKey })
      toast(`Moved ${countDrawings(ids.length)} to Team`)
    },
    onError: () => toast.error("Failed to move to Team"),
  })
}
