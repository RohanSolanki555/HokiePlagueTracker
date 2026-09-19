import ReportForm from "@/components/ReportForm"
import { buttonVariants } from "@/components/ui/button"

export default function Report() {
    return (
        <main className="min-h-screen bg-background p-4 sm:p-8">
            <div className="mx-auto max-w-2xl space-y-6">
                <a href="/" className={buttonVariants({ variant: "outline" })}>
                    Back to dashboard
                </a>
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold">Share a health report</h1>
                    <p className="text-muted-foreground">
                        Help track illness trends around campus.
                    </p>
                </div>
                <ReportForm />
            </div>
        </main>
    )
}
