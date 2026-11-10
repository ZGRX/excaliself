export function logPreviewSignIn(baseUrl: string | undefined, port: number) {
  const configured = URL.parse(baseUrl ?? "")
  const origin =
    configured?.protocol === "http:" || configured?.protocol === "https:"
      ? configured.origin
      : `http://localhost:${port}`
  console.log(`[preview] Sign in at ${new URL("/preview/login", origin)}`)
}
