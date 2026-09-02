import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CrownErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Retry",
  onSecondary,
  secondaryLabel,
}: {
  title: string;
  message: string;
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  onSecondary?: (() => void) | undefined;
  secondaryLabel?: string | undefined;
}) {
  return (
    <div className="surface p-10 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {message}
      </p>
      {(onRetry || onSecondary) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button
              className="bg-gold text-gold-foreground hover:bg-gold/90"
              onClick={onRetry}
            >
              <RefreshCw className="h-4 w-4" /> {retryLabel}
            </Button>
          )}
          {onSecondary && secondaryLabel && (
            <Button variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
