import { useEffect, useState } from "react";
import { subscribeToasts } from "../lib/toast";

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribeToasts(setMessage), []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
