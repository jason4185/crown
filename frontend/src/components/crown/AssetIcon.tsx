import { ASSET_META, type AssetSymbol } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

export function AssetIcon({
  asset,
  size = "md",
  className,
}: {
  asset: AssetSymbol;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const meta = ASSET_META[asset];
  const dim =
    size === "sm"
      ? "h-6 w-6 text-[11px]"
      : size === "lg"
        ? "h-11 w-11 text-lg"
        : "h-8 w-8 text-sm";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold",
        dim,
        className,
      )}
      style={{
        color: meta.colorVar,
        borderColor: `color-mix(in oklch, ${meta.colorVar} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${meta.colorVar} 12%, transparent)`,
      }}
    >
      {meta.glyph}
    </span>
  );
}
