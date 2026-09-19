import { useState, type FormEvent } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase, isVtEmail } from "@/services/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Mode = "login" | "signup" | "setup" | "forgot" | "reset"

export default function Auth({ mode, user, initialError = "" }: { mode: Mode; user: User | null; initialError?: string }) {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [error, setError] = useState(initialError)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const settingPassword = mode === "setup" || mode === "reset"
    const title = { login: "Welcome back", signup: "Create your account", setup: "Finish setting up your account", forgot: "Reset your password", reset: "Choose a new password" }[mode]

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!supabase || busy) return
        setError("")
        setMessage("")
        const normalizedEmail = email.trim().toLowerCase()
        if (!settingPassword && !isVtEmail(normalizedEmail)) {
            setError("Use your Virginia Tech @vt.edu email address.")
            return
        }
        if (settingPassword && (password.length < 8 || password !== confirm)) {
            setError("Use at least 8 characters and make sure both passwords match.")
            return
        }
        setBusy(true)
        try {
            if (settingPassword) {
                if (!user?.email_confirmed_at || !isVtEmail(user.email ?? "")) throw new Error("Open the verification link from your VT email first.")
                const result = await supabase.auth.updateUser({ password })
                if (result.error) throw result.error
                const refreshed = await supabase.auth.refreshSession()
                if (refreshed.error) throw refreshed.error
                window.location.assign("/")
            } else if (mode === "login") {
                const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
                if (result.error) throw result.error
                window.location.assign(result.data.user.app_metadata.password_setup_complete ? "/" : "/auth/setup")
            } else if (mode === "signup") {
                const result = await supabase.auth.signInWithOtp({ email: normalizedEmail, options: { emailRedirectTo: `${window.location.origin}/auth/setup` } })
                if (result.error) throw result.error
                setMessage(`Check ${normalizedEmail} for your verification link. Click it to create your password. You can resend using the button below.`)
            } else {
                const result = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${window.location.origin}/auth/reset` })
                if (result.error) throw result.error
                setMessage("If an account exists for that email, a password reset link has been sent.")
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Something went wrong. Please try again.")
        } finally {
            setBusy(false)
        }
    }

    return <main className="min-h-screen bg-background p-4 sm:p-8">
        <div className="mx-auto max-w-md space-y-6 rounded-xl border p-6">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-sm text-muted-foreground">HokiePlagueTracker accounts are for verified Virginia Tech email addresses.</p>
            {settingPassword && !user ? <p role="alert">Open a valid email link to continue. <a className="underline" href={mode === "reset" ? "/forgot-password" : "/signup"}>Request a new link</a>.</p> :
                <form onSubmit={submit} className="space-y-4">
                    <fieldset disabled={busy} className="space-y-4">
                        {settingPassword ? <p>{user?.email} - Verified</p> : <div className="space-y-2">
                            <label htmlFor="email">Virginia Tech email</label>
                            <Input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="abc123@vt.edu" />
                        </div>}
                        {(settingPassword || mode === "login") && <div className="space-y-2">
                            <label htmlFor="password">{settingPassword ? "Create password" : "Password"}</label>
                            <Input id="password" type="password" autoComplete={settingPassword ? "new-password" : "current-password"} required minLength={settingPassword ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} />
                        </div>}
                        {settingPassword && <div className="space-y-2">
                            <label htmlFor="confirm">Confirm password</label>
                            <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
                        </div>}
                        <Button type="submit" disabled={busy}>{busy ? "Please wait..." : settingPassword ? "Save password" : mode === "login" ? "Sign in" : mode === "signup" ? message ? "Resend verification email" : "Verify email" : "Send reset link"}</Button>
                    </fieldset>
                </form>}
            {message && <p role="status" className="text-sm">{message}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <nav className="flex flex-wrap gap-4 text-sm underline">
                <a href="/login">Sign in</a><a href="/signup">Create account</a><a href="/forgot-password">Forgot password?</a>
            </nav>
        </div>
    </main>
}
