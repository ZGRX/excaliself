// PREVIEW_MODE: print where to sign in, so a `docker run` user needs no docs.
// Preview ignores BASE_URL (Coolify may copy in the production value), so the
// URL is the local one.

import { definePlugin } from "nitro"
import { env } from "@/env"

export default definePlugin(() => {
  if (!env.PREVIEW_MODE) return
  console.log(
    `[preview] Sign in at http://localhost:${process.env.PORT || 3000}/preview/login`,
  )
})
