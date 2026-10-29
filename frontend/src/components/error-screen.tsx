export function ErrorScreen({ status }: { status: number | null }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-6xl font-bold text-destructive">
          {status ?? "ERR"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The request failed. Try refining it.
        </p>
      </div>
    </div>
  );
}
