import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./hooks", () => ({ useCreateChannel: vi.fn() }));

import { useCreateChannel } from "./hooks";
import { CreateChannel } from "./CreateChannel";

const mockUseCreateChannel = vi.mocked(useCreateChannel);

function stubMutation(overrides: Record<string, unknown> = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseCreateChannel.mockReturnValue({
    mutateAsync,
    isPending: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useCreateChannel>);
  return mutateAsync;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateChannel", () => {
  it("submits the name, the slug derived from it, and deliveryMode 'both'", async () => {
    const mutateAsync = stubMutation();
    render(<CreateChannel />);

    await userEvent.type(screen.getByPlaceholderText(/name/i), "Talk Radio");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "Talk Radio",
      slug: "talk-radio",
      deliveryMode: "both",
    });
  });

  it("clears the inputs after a successful create", async () => {
    stubMutation();
    render(<CreateChannel />);

    const nameInput = screen.getByPlaceholderText(/name/i);
    await userEvent.type(nameInput, "Main");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(nameInput).toHaveValue("");
  });

  it("disables submit until there is a slug to submit", () => {
    stubMutation();
    render(<CreateChannel />);
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});
