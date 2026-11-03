import { ArrowLeft, ShieldX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Btn } from "../../components/ui-kit";

export default function NoPermissionsPage() {
  const navigate = useNavigate();
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-lg flex-col items-center justify-center gap-4 text-center">
      <ShieldX className="h-12 w-12 text-destructive" />
      <span className="font-mono text-xs uppercase text-muted-foreground">
        403 · Glitchlog
      </span>
      <h1 className="text-3xl font-bold">No permissions</h1>
      <p className="text-sm text-muted-foreground">
        You don’t have access to this project. Ask your project owner to grant
        you access.
      </p>
      <Btn
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-2 rounded-md border bg-secondary px-4 py-2 text-sm text-secondary-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to projects
      </Btn>
    </section>
  );
}
