import Dashboard from "@/pages/Dashboard"
import Report from "@/pages/Report"

function App() {
    const path = window.location.pathname.replace(/\/$/, "")
    return path === "/report" ? <Report /> : <Dashboard />
}

export default App
