import { describe, it, expect } from "vitest";
import { authRedirect } from "./auth-redirect";

describe("authRedirect", () => {
  it("waits while the session is still resolving, regardless of page", () => {
    expect(authRedirect({ isPending: true, hasSession: false, onLoginPage: false })).toEqual({
      kind: "loading",
    });
    expect(authRedirect({ isPending: true, hasSession: true, onLoginPage: true })).toEqual({
      kind: "loading",
    });
  });

  it("redirects an unauthenticated visitor on a protected page to /login", () => {
    expect(authRedirect({ isPending: false, hasSession: false, onLoginPage: false })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("redirects an authenticated visitor away from /login to the dashboard", () => {
    expect(authRedirect({ isPending: false, hasSession: true, onLoginPage: true })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("lets an authenticated visitor stay on a protected page", () => {
    expect(authRedirect({ isPending: false, hasSession: true, onLoginPage: false })).toEqual({
      kind: "allow",
    });
  });

  it("lets an unauthenticated visitor stay on /login", () => {
    expect(authRedirect({ isPending: false, hasSession: false, onLoginPage: true })).toEqual({
      kind: "allow",
    });
  });
});
