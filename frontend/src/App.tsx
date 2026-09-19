import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import Dashboard from "@/pages/Dashboard"
import Auth from "@/pages/Auth"
import { isVtEmail, supabase } from "@/services/auth"
import { Button } from "@/components/ui/button"

function App() {
    const [session, setSession] = useState<Session | null>(null)
    const [loading, setLoading] = useState(Boolean(supabase))
    const [error, setError] = useState(() =>
        new URLSearchParams(window.location.hash.slice(1)).get("error_description") ?? ""
    )
    const path = window.location.pathname.replace(/\/$/, "")

    useEffect(() => {
        if (!supabase) return
        let active = true
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (active) { setSession(session); setLoading(false) }
        })
        void supabase.auth.getSession().then(({ data, error }) => {
            if (active) {
                setSession(data.session)
                if (error) setError(error.message)
                setLoading(false)
            }
        }).catch(() => { if (active) { setError("Unable to load your session."); setLoading(false) } })
        const params = new URLSearchParams(window.location.hash.slice(1))
        if (params.has("error_description")) {
            window.history.replaceState(null, "", window.location.pathname)
        }
        return () => { active = false; subscription.unsubscribe() }
    }, [])

    if (!supabase) return <main className="p-8"><h1 className="text-2xl font-bold">Login setup required</h1><p>Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env, then restart Vite.</p></main>
    if (loading) return <p role="status" className="p-8">Loading your session...</p>
    const user = session?.user ?? null
    const verified = user && isVtEmail(user.email ?? "") && user.email_confirmed_at
    if (["/login", "/signup", "/forgot-password", "/auth/setup", "/auth/reset"].includes(path)) {
        const mode = path === "/signup" ? "signup" : path === "/forgot-password" ? "forgot" : path === "/auth/setup" ? "setup" : path === "/auth/reset" ? "reset" : "login"
        return <Auth key={mode + error} mode={mode} user={verified ? user : null} initialError={error} />
    }
    if (!verified) return <Auth key={error} mode="login" user={null} initialError={error || (user ? "Sign in with a verified @vt.edu account." : "")} />
    if (!user.app_metadata.password_setup_complete) return <Auth mode="setup" user={user} />

    async function logout() {
        const result = await supabase!.auth.signOut()
        if (result.error) setError(result.error.message)
        else window.location.assign("/login")
    }
    return <>
        <header className="flex flex-wrap items-center justify-end gap-4 border-b px-8 py-3">
            <span className="text-sm">{user.email}</span><Button variant="outline" onClick={logout}>Sign out</Button>
            {error && <p role="alert">{error}</p>}
        </header>
        <Dashboard />
    </>
}

export default App
