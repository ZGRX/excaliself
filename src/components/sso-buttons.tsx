import { KeyRound } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { SsoProvider } from "@/features/auth/sso"
import { authClient } from "@/lib/auth-client"

type Props = {
  providers: SsoProvider[]
  /** Where a successful sign-in lands. */
  callbackURL: string
  /** Where a failed one lands, with Better Auth's ?error= code added. */
  errorCallbackURL: string
}

/** "Continue with …" buttons above the password form, with an "or" rule. */
export function SsoButtons({
  providers,
  callbackURL,
  errorCallbackURL,
}: Props) {
  // The page navigates away on success, so pending never resets.
  const [pending, setPending] = useState<SsoProvider["id"] | null>(null)
  if (providers.length === 0) return null

  const signIn = async (provider: SsoProvider["id"]) => {
    setPending(provider)
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL,
      errorCallbackURL,
    })
    if (error) {
      setPending(null)
      toast.error(error.message ?? "Couldn't start sign-in")
    }
  }

  return (
    <div className="mb-4 space-y-4">
      <div className="space-y-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            className="w-full"
            disabled={pending !== null}
            onClick={() => signIn(provider.id)}
          >
            <ProviderIcon id={provider.id} />
            {pending === provider.id
              ? "Redirecting..."
              : `Continue with ${provider.name}`}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

function ProviderIcon({ id }: { id: SsoProvider["id"] }) {
  if (id === "google")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.65"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95h-4v3.1A12 12 0 0 0 12 24"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75"
        />
      </svg>
    )
  if (id === "microsoft")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    )
  return <KeyRound aria-hidden="true" />
}
