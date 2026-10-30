import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

/*
 * A production build ships #root already filled in by scripts/prerender.js, so
 * crawlers and ad reviewers read the real copy instead of an empty div. That
 * markup is a snapshot for them; the app still mounts normally and replaces it.
 *
 * Hydrating it would be nicer, but several demo panels seed state from
 * Math.random() and Date.now() (see DemoVolatility, DemoNews, DemoAlerts), so
 * the client's first render can never equal a build-time snapshot. React would
 * throw away the markup and log a hydration error on every visit, which is
 * worse than the clean mount we do here.
 */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
