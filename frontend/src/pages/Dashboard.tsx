import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function Dashboard() {
    return (
        <main className="min-h-screen bg-background p-8">
            <div className="mx-auto max-w-7xl space-y-8">

                <div>
                    <h1 className="text-3xl font-bold">
                        Campus Health
                    </h1>

                    <p className="text-muted-foreground">
                        View recent illness trends around campus.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-3">

                    <Card>
                        <CardHeader>
                            <CardTitle>
                                Reports Today
                            </CardTitle>
                        </CardHeader>

                        <CardContent>
                            <p className="text-4xl font-bold">
                                0
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>
                                Reports This Week
                            </CardTitle>
                        </CardHeader>

                        <CardContent>
                            <p className="text-4xl font-bold">
                                0
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>
                                Weekly Trend
                            </CardTitle>
                        </CardHeader>

                        <CardContent>
                            <p className="text-4xl font-bold">
                                0%
                            </p>
                        </CardContent>
                    </Card>

                </div>

            </div>
        </main>
    )
}