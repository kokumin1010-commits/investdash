import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { adoptTokenFromUrl, getStoredToken } from "./lib/passcodeSession";
import { DisplayCurrencyProvider } from "@/contexts/DisplayCurrencyContext";
import "./index.css";

// 開発時のみ: ?devToken=... が付いていればトークンとして取り込む（描画前に実行）
adoptTokenFromUrl();

const queryClient = new QueryClient();

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Query Error]", event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Mutation Error]", event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // パスコード認証で得たトークンを全リクエストに付与する
        const token = getStoredToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      {/* 表示通貨は trpc の設定取得に依存するため Provider の内側に置く */}
      <DisplayCurrencyProvider>
        <App />
      </DisplayCurrencyProvider>
    </trpc.Provider>
  </QueryClientProvider>
);
