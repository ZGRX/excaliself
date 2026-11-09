export function logPreviewSignIn(baseUrl: string | undefined, port: number) {
  const origin = baseUrl ?? `http://localhost:${port}`
  console.log(`[preview] Sign in at ${new URL("/preview/login", origin)}`)
}
