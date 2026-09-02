import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link } from "@tanstack/react-router";
import { Crown, Menu, Search, Wallet, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GENLAYER_NETWORK_NAME } from "@/lib/crown/config";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/activity", label: "Activity" },
  { to: "/create", label: "Create Market" },
  { to: "/how-it-works", label: "How it works" },
] as const;

function NetworkPill({
  chain,
  onClick,
}: {
  chain?: { name?: string; unsupported?: boolean };
  onClick?: () => void;
}) {
  const wrongNetwork = chain?.unsupported;
  const content = (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full shadow-[0_0_8px_var(--success)]",
          wrongNetwork ? "bg-warning" : "bg-success",
        )}
      />
      {wrongNetwork ? "Switch to GenLayer Bradbury" : GENLAYER_NETWORK_NAME}
    </span>
  );
  return wrongNetwork && onClick ? (
    <button type="button" onClick={onClick} aria-label="Switch network">
      {content}
    </button>
  ) : (
    content
  );
}

function WalletPill({
  address,
  displayAddress,
  displayBalance,
  onClick,
}: {
  address: string;
  displayAddress?: string;
  displayBalance?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1.5 text-xs transition-colors hover:border-gold/45"
      aria-label={`Open account ${address}`}
    >
      <Wallet className="h-3.5 w-3.5 text-gold" />
      <span className="tabular font-medium">{displayAddress ?? address}</span>
      {displayBalance && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="tabular text-muted-foreground">
            {displayBalance}
          </span>
        </>
      )}
    </button>
  );
}

function WalletControls() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openConnectModal }) => {
        if (!mounted) return null;
        if (!account || !chain) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-gold px-3 text-xs font-semibold text-gold-foreground transition-colors hover:bg-gold/90"
            >
              <Wallet className="h-3.5 w-3.5" /> Connect Wallet
            </button>
          );
        }
        return (
          <WalletPill
            address={account.address}
            displayAddress={account.displayName}
            displayBalance={account.displayBalance}
            onClick={openAccountModal}
          />
        );
      }}
    </ConnectButton.Custom>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link
          to="/markets"
          search={{ q: "" }}
          className="flex items-center gap-2"
        >
          <Crown className="h-5 w-5 text-gold" />
          <span className="text-[15px] font-semibold tracking-[0.22em]">
            CROWN
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
              activeProps={{ className: "text-foreground bg-elevated" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <form
            action="/markets"
            method="get"
            className="relative hidden xl:block"
            title="Search loaded markets by date, UTC window, or status"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search markets"
              name="q"
              placeholder="Search markets"
              className="h-9 w-56 border-border bg-elevated pl-9 text-sm placeholder:text-muted-foreground"
            />
          </form>
          <div className="hidden md:block">
            <ConnectButton.Custom>
              {({ chain, mounted, openChainModal }) =>
                mounted && chain ? (
                  <NetworkPill chain={chain} onClick={openChainModal} />
                ) : null
              }
            </ConnectButton.Custom>
          </div>
          <div className="hidden sm:block">
            <WalletControls />
          </div>
          <button
            type="button"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-elevated lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "border-t border-border px-4 pb-4 pt-3 lg:hidden",
          open ? "block" : "hidden",
        )}
      >
        <div className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground"
              activeProps={{ className: "text-foreground bg-elevated" }}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <WalletControls />
        </div>
      </div>
    </header>
  );
}
