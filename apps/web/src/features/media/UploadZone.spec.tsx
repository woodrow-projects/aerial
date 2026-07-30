import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrackDto } from "./api";

// Isolate the zone from the query layer; the mutation itself is covered in hooks.spec.
const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("./hooks", () => ({
  useUploadTrack: () => ({ mutateAsync, isPending: false }),
}));

import { UploadZone } from "./UploadZone";

const track = { id: "t1", title: "ok" } as unknown as TrackDto;
const audio = (name: string) => new File(["x"], name, { type: "audio/mpeg" });

beforeEach(() => vi.clearAllMocks());

describe("UploadZone", () => {
  it("uploads selected files one at a time, in order, and marks each done", async () => {
    mutateAsync.mockResolvedValue(track);
    render(<UploadZone />);

    await userEvent.upload(screen.getByLabelText(/add tracks/i), [audio("a.mp3"), audio("b.mp3")]);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    // sequential: the two files are forwarded in selection order
    expect((mutateAsync.mock.calls[0][0] as File).name).toBe("a.mp3");
    expect((mutateAsync.mock.calls[1][0] as File).name).toBe("b.mp3");

    expect(await screen.findByText("a.mp3")).toBeInTheDocument();
    expect(screen.getByText("b.mp3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/uploaded/i)).toHaveLength(2));
  });

  it("surfaces a per-file error (415 unsupported / 422 ffprobe) without stopping the queue", async () => {
    mutateAsync.mockImplementation((file: File) =>
      file.name === "bad.txt"
        ? Promise.reject(Object.assign(new Error('unsupported media type ".txt"'), { status: 415 }))
        : Promise.resolve(track),
    );
    render(<UploadZone />);

    await userEvent.upload(screen.getByLabelText(/add tracks/i), [audio("good.mp3"), audio("bad.txt")]);

    // the good file still uploads; the bad one shows its server error, inline
    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
    expect(await screen.findByText(/unsupported media type/i)).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });
});
