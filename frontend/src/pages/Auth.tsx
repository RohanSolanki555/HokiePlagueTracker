import { useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react"
import logo from "@/assets/HokiePlagueTrackerIcon.svg"
import "./Auth.css"
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
    const [showPassword, setShowPassword] = useState(false)
    const settingPassword = mode === "setup" || mode === "reset"
    const title = { login: "Welcome back", signup: "Create your account", setup: "Finish setting up your account", forgot: "Reset your password", reset: "Choose a new password" }[mode]

    const description = {
        login: "Sign in to see what's going around campus.",
        signup: "Join your campus community. Start with your Virginia Tech email.",
        setup: "Your email is verified. Create a password to get started.",
        forgot: "Enter your VT email and we'll send you a link to reset your password.",
        reset: "Set a new password and get back to your campus community.",
    }[mode]

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

    return (
        <main className={`auth-page${mode === "login" ? " auth-page-login" : ""}`}>
            <div className="auth-shell">
                <aside className="auth-story" aria-label="Hokie Plague Tracker">
                    <a className="auth-brand" href="/" aria-label="Hokie Plague Tracker home">
                        <span className="auth-brand-logo"><img src={logo} alt="" width="72" height="72" /></span>
                        <span className="auth-brand-name">Hokie<span>Plague Tracker</span></span>
                    </a>
                    <div className="auth-story-copy">
                        <p className="auth-eyebrow">Hokies helping Hokies</p>
                        <h2>Stay Aware. <span>Stay Connected.</span></h2>
                        <p className="auth-story-description">
                            Check campus health trends, report how you’re feeling, and help others stay ahead.
                        </p>
                    </div>
                    <p className="auth-story-footer">Virginia Tech community &middot; Blacksburg, VA</p>
                </aside>

                <section className="auth-content" aria-labelledby="auth-title">
                    <div className="auth-form-wrap">
                        <span className="auth-section-label">Your campus. Your community.</span>
                        <h1 className="auth-title" id="auth-title">{title}</h1>
                        <p className="auth-description" id="auth-description">{description}</p>

                        {settingPassword && !user ? (
                            <div role="alert" className="auth-feedback">
                                <CircleAlert aria-hidden="true" />
                                <p>Open a valid email link to continue. <a className="auth-link" href={mode === "reset" ? "/forgot-password" : "/signup"}>Request a new link</a>.</p>
                            </div>
                        ) : (
                            <form onSubmit={submit} aria-describedby="auth-description" aria-busy={busy}>
                                <fieldset disabled={busy} className="auth-fields">
                                    {settingPassword ? (
                                        <p className="auth-verified"><ShieldCheck aria-hidden="true" /><span>{user?.email} &middot; Verified</span></p>
                                    ) : (
                                        <div>
                                            <div className="auth-field-label"><label htmlFor="email">Virginia Tech email</label></div>
                                            <div className="auth-input-wrap">
                                                <Mail className="auth-input-icon" aria-hidden="true" />
                                                <Input className="auth-input" id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@vt.edu" />
                                            </div>
                                        </div>
                                    )}
                                    {(settingPassword || mode === "login") && (
                                        <div>
                                            <div className="auth-field-label">
                                                <label htmlFor="password">{settingPassword ? "Create password" : "Password"}</label>
                                                {mode === "login" && <a className="auth-link" href="/forgot-password">Forgot password?</a>}
                                            </div>
                                            <div className="auth-input-wrap">
                                                <LockKeyhole className="auth-input-icon" aria-hidden="true" />
                                                <Input className="auth-input auth-password-input" id="password" type={showPassword ? "text" : "password"} autoComplete={settingPassword ? "new-password" : "current-password"} required minLength={settingPassword ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={settingPassword ? "At least 8 characters" : "Enter your password"} aria-describedby={settingPassword ? "password-help" : undefined} />
                                                <Button type="button" variant="ghost" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(value => !value)}>
                                                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                                                </Button>
                                            </div>
                                            {settingPassword && <p className="auth-help" id="password-help">Use at least 8 characters.</p>}
                                        </div>
                                    )}
                                    {settingPassword && (
                                        <div>
                                            <div className="auth-field-label"><label htmlFor="confirm">Confirm password</label></div>
                                            <div className="auth-input-wrap">
                                                <LockKeyhole className="auth-input-icon" aria-hidden="true" />
                                                <Input className="auth-input" id="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Enter your password again" />
                                            </div>
                                        </div>
                                    )}
                                    <Button type="submit" disabled={busy} className="auth-submit">
                                        <span>{busy ? "Please wait..." : settingPassword ? "Save password" : mode === "login" ? "Sign in" : mode === "signup" ? message ? "Resend verification email" : "Verify email" : "Send reset link"}</span>
                                        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                                    </Button>
                                </fieldset>
                            </form>
                        )}

                        {message && <div role="status" className="auth-feedback auth-feedback-success"><CheckCircle2 aria-hidden="true" /><p>{message}</p></div>}
                        {error && <div role="alert" className="auth-feedback"><CircleAlert aria-hidden="true" /><p>{error}</p></div>}

                        <nav className="auth-account-nav" aria-label="Account options">
                            {mode === "login" ? (
                                <p>New to the tracker? <a className="auth-link" href="/signup">Create account <ArrowRight aria-hidden="true" /></a></p>
                            ) : mode === "signup" ? (
                                <p>Already have an account? <a className="auth-link" href="/login">Sign in <ArrowRight aria-hidden="true" /></a></p>
                            ) : (
                                <a className="auth-link" href="/login"><ArrowLeft aria-hidden="true" /> Back to sign in</a>
                            )}
                        </nav>
                        <p className="auth-access-note"><ShieldCheck aria-hidden="true" /> For verified Virginia Tech @vt.edu accounts</p>
                    </div>
                </section>
            </div>
        </main>
    )
}
