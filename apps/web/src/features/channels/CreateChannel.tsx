import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/error-note";
import { useCreateChannel } from "./hooks";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateChannel() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugValue = slug || slugify(name);
  const create = useCreateChannel();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ name, slug: slugValue, deliveryMode: "both" });
      setName("");
      setSlug("");
    } catch {
      // surfaced via create.error below
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New channel</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <Input
            placeholder="Name (e.g. Main, Talk)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            placeholder="slug"
            value={slugValue}
            onChange={(e) => setSlug(slugify(e.target.value))}
            className="sm:max-w-[220px]"
          />
          <Button type="submit" disabled={!slugValue || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {create.error && <ErrorNote className="mt-3">{(create.error as Error).message}</ErrorNote>}
      </CardContent>
    </Card>
  );
}
