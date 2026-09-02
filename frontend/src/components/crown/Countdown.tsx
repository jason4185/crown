import { useEffect, useState } from "react";
import { countdown } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

export function Countdown({
  targetISO,
  className,
}: {
  targetISO: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className={cn("tabular font-medium", className)}>
      {now === null ? "--:--:--" : countdown(targetISO, now)}
    </span>
  );
}
