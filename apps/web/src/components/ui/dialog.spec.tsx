import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent } from "./dialog";

/**
 * Review finding: DialogContent declared aria-modal="true" without trapping
 * focus — Tab escaped the panel onto occluded app-shell controls. These pin
 * the trap: Tab on the last focusable wraps to the first and vice versa.
 */
function Harness() {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showClose={false}>
        <button type="button">first</button>
        <input aria-label="middle" />
        <button type="button">last</button>
      </DialogContent>
    </Dialog>
  );
}

describe("DialogContent focus trap (aria-modal honesty)", () => {
  it("Tab on the last focusable wraps to the first", () => {
    render(<Harness />);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "first" }));
  });

  it("Shift+Tab on the first focusable wraps to the last", () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "last" }));
  });
});
