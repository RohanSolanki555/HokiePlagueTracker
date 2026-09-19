import { defineConfig } from "@playwright/test"

export default defineConfig({
    testDir: "./tests",
    fullyParallel: true,
    use: { browserName: "chromium", trace: "retain-on-failure" },
    projects: [
        { name: "without-key", testMatch: "dashboard.spec.ts", use: { baseURL: "http://127.0.0.1:4173" } },
        { name: "map", testMatch: "map.spec.ts", use: { baseURL: "http://127.0.0.1:4174" } },
    ],
    webServer: [
        {
            command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort",
            url: "http://127.0.0.1:4173",
            env: { VITE_GOOGLE_MAPS_API_KEY: "", VITE_API_URL: "http://127.0.0.1:5000/api" },
        },
        {
            command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174 --strictPort",
            url: "http://127.0.0.1:4174",
            env: { VITE_GOOGLE_MAPS_API_KEY: "browser-test-key", VITE_API_URL: "http://127.0.0.1:5000/api" },
        },
    ],
})
