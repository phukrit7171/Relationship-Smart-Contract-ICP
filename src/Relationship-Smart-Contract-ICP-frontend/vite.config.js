import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import { icpBindgen } from "@icp-sdk/bindgen/plugins/vite";
import { defineConfig } from "vite";

const environment = process.env.ICP_ENVIRONMENT || "local";
const backendCanister = "relationship_backend";

function getDevServerConfig() {
  const networkStatus = JSON.parse(
    execSync(`icp network status -e ${environment} --json`, {
      encoding: "utf-8",
    }),
  );
  const backendId = execSync(
    `icp canister status ${backendCanister} -e ${environment} -i`,
    { encoding: "utf-8", stdio: "pipe" },
  ).trim();
  const canisterParams = `PUBLIC_CANISTER_ID:${backendCanister}=${backendId}`;

  return {
    headers: {
      "Set-Cookie": `ic_env=${encodeURIComponent(
        `${canisterParams}&ic_root_key=${networkStatus.root_key}`,
      )}; SameSite=Lax;`,
    },
    proxy: {
      "/api": { target: networkStatus.api_url, changeOrigin: true },
    },
  };
}

export default defineConfig(({ command }) => ({
  build: {
    emptyOutDir: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  plugins: [
    react(),
    icpBindgen({
      didFile: "../Relationship-Smart-Contract-ICP-backend/relationship_backend.did",
      outDir: "./src/bindings",
    }),
  ],
  ...(command === "serve" ? { server: getDevServerConfig() } : {}),
  resolve: {
    dedupe: ["@icp-sdk/core"],
  },
}));
