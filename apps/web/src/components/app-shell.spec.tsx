import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { APP_NAME } from "@/brand";
import { Header } from "./app-shell";

/**
 * Companion to the brand-leak scan: the scan proves the name is absent from
 * non-brand *source*; this proves the shell actually *renders* it by consuming
 * APP_NAME from the brand module (not a hard-coded literal). Together they pin
 * the contract that swapping the brand module swaps what the header shows.
 */
describe("app shell branding", () => {
  it("renders the product name sourced from the brand module", () => {
    render(<Header />);
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
  });
});
