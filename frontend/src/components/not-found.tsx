import { Link } from "react-router-dom";

// Harbor's __root.tsx NotFoundComponent, rendered by the "*"-path route.
export function NotFoundPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          No route matched. The page doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          cd ~
        </Link>
      </div>
    </div>
  );
}
