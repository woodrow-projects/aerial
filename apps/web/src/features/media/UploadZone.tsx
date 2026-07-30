import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildQueue,
  setItemStatus,
  describeUploadError,
  type UploadItem,
  type UploadStatus,
} from "./lib";
import { useUploadTrack } from "./hooks";

const ACCEPT = ".mp3,.m4a,.aac,.flac,.ogg,.wav,audio/*";

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Queued",
  uploading: "Uploading…",
  done: "Uploaded",
  error: "Failed",
};

function statusBadge(status: UploadStatus) {
  if (status === "done") return "live" as const;
  if (status === "error") return "off" as const;
  if (status === "uploading") return "on" as const;
  return "default" as const;
}

/**
 * Upload zone: a multi-file picker that uploads sequentially (one request at a
 * time) so per-file 415/422 errors from ffprobe/extension checks surface against
 * the exact file that failed, without aborting the rest of the batch.
 */
export function UploadZone() {
  const upload = useUploadTrack();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runQueue(queue: UploadItem[]) {
    setBusy(true);
    for (const item of queue) {
      setItems((prev) => setItemStatus(prev, item.id, "uploading"));
      try {
        await upload.mutateAsync(item.file);
        setItems((prev) => setItemStatus(prev, item.id, "done"));
      } catch (err) {
        setItems((prev) => setItemStatus(prev, item.id, "error", describeUploadError(err)));
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = ""; // allow re-selecting the same file
  }

  function onFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const queue = buildQueue(Array.from(fileList));
    setItems(queue);
    void runQueue(queue);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload tracks</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="media-upload">Add tracks</Label>
          <input
            ref={inputRef}
            id="media-upload"
            type="file"
            multiple
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => onFiles(e.target.files)}
            className="flex w-full cursor-pointer rounded-md border border-input bg-input-surface px-3 py-2 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium file:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            MP3, M4A, AAC, FLAC, OGG or WAV. Files upload one at a time; duration and tags are read
            on the server.
          </p>
        </div>

        {items.length > 0 && (
          <ul className="grid gap-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <div className="flex items-center gap-2">
                  {item.status === "error" && item.error && (
                    <span className={cn("text-xs text-destructive")}>{item.error}</span>
                  )}
                  <Badge variant={statusBadge(item.status)}>{STATUS_LABEL[item.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
