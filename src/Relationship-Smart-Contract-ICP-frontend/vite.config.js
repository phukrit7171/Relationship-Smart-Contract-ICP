import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import { icpBindgen } from "@icp-sdk/bindgen/plugins/vite";
import { defineConfig } from "vite";

const environment = process.env.ICP_ENVIRONMENT || "local";
const backendCanister = "relationship_backend";

function icEnvCookie({ backendId, rootKey, apiUrl }) {
  return {
    headers: {
      "Set-Cookie": `ic_env=${encodeURIComponent(
        `PUBLIC_CANISTER_ID:${backendCanister}=${backendId}&ic_root_key=${rootKey}`,
      )}; SameSite=Lax;`,
    },
    proxy: {
      "/api": { target: apiUrl, changeOrigin: true },
    },
  };
}

function fromReplica() {
  const networkStatus = JSON.parse(
    execSync(`icp network status -e ${environment} --json`, {
      encoding: "utf-8",
    }),
  );
  const backendId = execSync(
    `icp canister status ${backendCanister} -e ${environment} -i`,
    { encoding: "utf-8", stdio: "pipe" },
  ).trim();
  return icEnvCookie({
    backendId,
    rootKey: networkStatus.root_key,
    apiUrl: networkStatus.api_url,
  });
}

/**
 * Both `icp` calls above throw when the replica is down or the backend has
 * never been deployed, which would otherwise make `vite dev` impossible to
 * start at all. Fall back to environment variables, and failing that, serve
 * the app without `ic_env` so at least the UI shell is workable.
 */
function getDevServerConfig() {
  try {
    return fromReplica();
  } catch (error) {
    const backendId = process.env.ICP_BACKEND_CANISTER_ID;
    if (backendId) {
      console.warn(
        `[icp] replica unavailable (${error.message.split("\n")[0]}); using ICP_BACKEND_CANISTER_ID`,
      );
      return icEnvCookie({
        backendId,
        rootKey: process.env.ICP_ROOT_KEY ?? "",
        apiUrl: process.env.ICP_API_URL ?? "http://127.0.0.1:8000",
      });
    }
    console.warn(
      "[icp] replica unavailable and ICP_BACKEND_CANISTER_ID is unset — " +
        "starting Vite without ic_env. Canister calls will fail until you run " +
        "`icp network start -d && icp deploy`.",
    );
    return {};
  }
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
