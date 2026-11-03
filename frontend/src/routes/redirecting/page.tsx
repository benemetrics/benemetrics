import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Btn } from "../../components/ui-kit";

export default function RedirectingPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = window.setTimeout(() => navigate("/", { replace: true }), 2500);
    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <section className="mx-auto flex min-h-[65vh] max-w-lg flex-col items-center justify-center gap-4 text-center">
      <LoaderCircle className="h-10 w-10 animate-spin text-primary motion-reduce:animate-none" />
      <span className="font-mono text-xs uppercase text-muted-foreground">
        Glitchlog
      </span>
      <h1 className="text-3xl font-bold">We’re redirecting you</h1>
      <p className="text-sm text-muted-foreground">
        Taking you to your projects.
      </p>
      <Btn
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Continue to projects<ArrowRight className="h-4 w-4" />
      </Btn>
    </section>
  );
}
