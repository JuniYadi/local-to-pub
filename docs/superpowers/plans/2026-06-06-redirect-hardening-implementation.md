# Redirect Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept backend HTTP redirects in the client proxy, rewrite local redirect targets back to the public tunnel URL, and preserve trailing-slash/i18n prefixes without false 502 errors.

**Architecture:** Keep the existing proxy design, but stop auto-following backend redirects. Capture raw 30x responses in `packages/client/lib/http-proxy.ts`, normalize and rewrite `Location` in one helper, and return the redirect upstream unchanged except for host/proto/path correction.

**Tech Stack:** Bun, TypeScript, Bun test, fetch API

---

## File Structure

- `packages/client/lib/http-proxy.ts` — request forwarding, redirect interception, redirect rewrite helper
- `packages/client/lib/http-proxy.test.ts` — regression tests for manual redirect handling, i18n, trailing slash, and passthrough behavior

### Task 1: Lock redirect interception with failing tests

**Files:**
- Modify: `packages/client/lib/http-proxy.test.ts`
- Test: `packages/client/lib/http-proxy.test.ts`

- [ ] **Step 1: Write the failing test for trailing-slash redirects**

```ts
test("rewrites trailing-slash redirects without auto-following them", async () => {
  let calls = 0;

  // @ts-expect-error test mock
  global.fetch = async (_input, init) => {
    calls++;
    expect(init?.redirect).toBe("manual");

    return new Response(null, {
      status: 307,
      headers: { Location: "http://localhost:3000/id/" },
    });
  };

  const result = await proxyRequest({
    host: "localhost",
    port: 3000,
    method: "GET",
    path: "/id",
    headers: {
      "x-forwarded-host": "demo.tunnel.example.com",
      "x-forwarded-proto": "https",
    },
    body: "",
  });

  expect(calls).toBe(1);
  expect(result.status).toBe(307);
  expect(result.headers["location"]).toBe("https://demo.tunnel.example.com/id/");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/http-proxy.test.ts -t "rewrites trailing-slash redirects without auto-following them"`
Expected: FAIL because `init.redirect` is not `manual`

- [ ] **Step 3: Write the failing test for relative trailing-slash redirects**

```ts
test("rewrites relative trailing-slash redirects to the public URL", async () => {
  // @ts-expect-error test mock
  global.fetch = async () => new Response(null, {
    status: 308,
    headers: { Location: "/id/" },
  });

  const result = await proxyRequest({
    host: "localhost",
    port: 3000,
    method: "GET",
    path: "/id",
    headers: {
      "x-forwarded-host": "demo.tunnel.example.com",
      "x-forwarded-proto": "https",
    },
    body: "",
  });

  expect(result.status).toBe(308);
  expect(result.headers["location"]).toBe("https://demo.tunnel.example.com/id/");
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test packages/client/lib/http-proxy.test.ts -t "rewrites relative trailing-slash redirects to the public URL"`
Expected: FAIL or reveal redirect handling gap before implementation

### Task 2: Implement manual redirect interception

**Files:**
- Modify: `packages/client/lib/http-proxy.ts`
- Test: `packages/client/lib/http-proxy.test.ts`

- [ ] **Step 1: Add manual redirect handling to fetch**

```ts
const response = await fetch(url, {
  method: req.method,
  headers,
  body: req.body ? Buffer.from(req.body, "base64") : undefined,
  redirect: "manual",
});
```

- [ ] **Step 2: Extract redirect rewrite helper**

```ts
function rewriteRedirectLocation(location: string, req: ProxyRequest): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedProto = req.headers["x-forwarded-proto"] || "http";

  if (!forwardedHost) return location;

  const locUrl = new URL(location, `http://${req.host}:${req.port}`);
  if (locUrl.host !== `${req.host}:${req.port}` && locUrl.host !== req.host) {
    return location;
  }

  let redirectPath = locUrl.pathname + locUrl.search;
  const originalPathname = req.path.split("?")[0];
  const redirectPathname = locUrl.pathname;

  if (originalPathname.endsWith(redirectPathname) && redirectPathname !== originalPathname) {
    const prefix = originalPathname.slice(0, originalPathname.length - redirectPathname.length);
    if (prefix.startsWith("/")) {
      redirectPath = prefix + redirectPath;
    }
  }

  return new URL(redirectPath, `${forwardedProto}://${forwardedHost}`).toString();
}
```

- [ ] **Step 3: Apply the helper to Location headers only when present**

```ts
if (responseHeaders["location"]) {
  try {
    responseHeaders["location"] = rewriteRedirectLocation(responseHeaders["location"], req);
  } catch {
    // leave invalid location unchanged
  }
}
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `bun test packages/client/lib/http-proxy.test.ts`
Expected: PASS for redirect-focused tests

### Task 3: Add regression coverage for i18n and passthrough redirects

**Files:**
- Modify: `packages/client/lib/http-proxy.test.ts`
- Test: `packages/client/lib/http-proxy.test.ts`

- [ ] **Step 1: Add a test that confirms locale prefix is preserved after manual redirects**

```ts
test("preserves locale prefix when backend redirects to a stripped path", async () => {
  // @ts-expect-error test mock
  global.fetch = async () => new Response(null, {
    status: 307,
    headers: { Location: "/login/start?next=%2Fid&provider=github" },
  });

  const result = await proxyRequest({
    host: "localhost",
    port: 3300,
    method: "GET",
    path: "/id/login/start?next=%2Fid&provider=github",
    headers: {
      "x-forwarded-host": "pgreen.tunnel.juniyadi.id",
      "x-forwarded-proto": "https",
    },
    body: "",
  });

  expect(result.headers["location"]).toBe("https://pgreen.tunnel.juniyadi.id/id/login/start?next=%2Fid&provider=github");
});
```

- [ ] **Step 2: Add a test that external redirects are still untouched**

```ts
test("leaves external redirects unchanged", async () => {
  // @ts-expect-error test mock
  global.fetch = async () => new Response(null, {
    status: 302,
    headers: { Location: "https://github.com/login" },
  });

  const result = await proxyRequest({
    host: "localhost",
    port: 3000,
    method: "GET",
    path: "/login",
    headers: {
      "x-forwarded-host": "demo.tunnel.example.com",
      "x-forwarded-proto": "https",
    },
    body: "",
  });

  expect(result.headers["location"]).toBe("https://github.com/login");
});
```

- [ ] **Step 3: Run the proxy test file again**

Run: `bun test packages/client/lib/http-proxy.test.ts`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: none
- Test: full suite

- [ ] **Step 1: Run full tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 2: Run client build**

Run: `bun run build:client`
Expected: compiled `client-bin`

- [ ] **Step 3: Commit**

```bash
git add packages/client/lib/http-proxy.ts packages/client/lib/http-proxy.test.ts docs/superpowers/plans/2026-06-06-redirect-hardening-implementation.md
git commit -m "fix: harden proxy redirect handling"
```
