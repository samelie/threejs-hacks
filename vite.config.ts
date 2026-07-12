import { join, parse } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { load } from "@adddog/env";

import { defineAppConfig } from "@adddog/vite";
import tailwindcss from "@tailwindcss/vite";
import { packageUpSync } from "package-up";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

load(__dirname);

export const pkgRootDir = parse(packageUpSync({ cwd: join(__dirname, "..") }) || "").dir;

const host = process.env.VITE_SERVER_HOST;
const port = process.env.VITE_DEV_SERVER_PORT;
const apiPort = process.env.VITE_DEV_SERVER_PORT;
console.log(host);
if (!port)
    throw new Error("Missing VITE_DEV_SERVER_PORT");
if (!apiPort)
    throw new Error("Missing VITE_SERVER_PORT");

export default defineAppConfig({
    root: __dirname,
    server: {
        port: Number.parseInt(port, 10),
        host,
        hmr: { overlay: false, clientPort: Number.parseInt(apiPort, 10),

        } },
    plugins: [
        tailwindcss(),
    ],
});
