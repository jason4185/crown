export type CrownErrorCopy = {
  title: string;
  message: string;
};

const KNOWN_TITLES = [
  "Transaction cancelled",
  "Wrong network",
  "Market already exists",
  "Creation window closed",
  "Invalid market window",
  "Stake too small",
  "Stake limit reached",
  "Your asset is locked",
  "Predictions are closed",
  "Settlement is not ready",
  "Already claimed",
  "Nothing to claim",
  "Network request failed",
] as const;

function textFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getCrownErrorCopy(error: unknown): CrownErrorCopy {
  const raw = textFrom(error)
    .replace(/^\[EXPECTED\]\s*/i, "")
    .trim();
  for (const title of KNOWN_TITLES) {
    if (raw === title) return { title, message: "Please try again." };
    if (raw.startsWith(`${title}:`)) {
      return {
        title,
        message: raw.slice(title.length + 1).trim() || "Please try again.",
      };
    }
  }

  if (/user rejected|user denied|request rejected|denied by user/i.test(raw)) {
    return {
      title: "Transaction cancelled",
      message: "You rejected the request in your wallet.",
    };
  }
  if (/wrong chain|wrong network|unsupported chain|chain mismatch/i.test(raw)) {
    return {
      title: "Wrong network",
      message: "Switch to GenLayer Bradbury to continue.",
    };
  }
  if (/duplicate market|already exists/i.test(raw)) {
    return {
      title: "Market already exists",
      message:
        "A Crown market has already been created for this 4-hour window.",
    };
  }
  if (
    /market start must be in the future|creation lead|less than 5 minutes|lead time/i.test(
      raw,
    )
  ) {
    return {
      title: "Creation window closed",
      message:
        "This market can no longer be created because it starts in less than 5 minutes.",
    };
  }
  if (
    /duration|utc aligned|canonical.*4.?hour|market start must be utc/i.test(
      raw,
    )
  ) {
    return {
      title: "Invalid market window",
      message: "Crown markets must use an exact canonical 4-hour UTC window.",
    };
  }
  if (/minimum stake|minimum addition|stake is too small/i.test(raw)) {
    return {
      title: "Stake too small",
      message: "Each stake addition must be at least 1 GEN.",
    };
  }
  if (/maximum cumulative|maximum stake|stake limit|cap/i.test(raw)) {
    return {
      title: "Stake limit reached",
      message: "You can stake a maximum of 10 GEN in this market.",
    };
  }
  if (/only one asset|choose only one asset|different asset/i.test(raw)) {
    return {
      title: "Your asset is locked",
      message:
        "You already chose another asset in this market. A wallet can back only one asset per market.",
    };
  }
  if (
    /betting is closed|market is not open|not accepting positions/i.test(raw)
  ) {
    return {
      title: "Predictions are closed",
      message: "This market is no longer accepting positions.",
    };
  }
  if (
    /settlement is not ready|not ready.*settle|settlement.*grace/i.test(raw)
  ) {
    return {
      title: "Settlement is not ready",
      message: "This market cannot be settled yet.",
    };
  }
  if (/already claimed/i.test(raw)) {
    return {
      title: "Already claimed",
      message: "This position has already been claimed.",
    };
  }
  if (/nothing claimable|nothing to claim/i.test(raw)) {
    return {
      title: "Nothing to claim",
      message:
        "This wallet does not currently have a payout or refund available for this market.",
    };
  }
  if (
    /insufficient funds|insufficient balance|not enough gen|balance/i.test(raw)
  ) {
    return {
      title: "Insufficient GEN",
      message:
        "The connected wallet does not have enough GEN for this request.",
    };
  }
  if (/connect an injected wallet|wallet provider|connect wallet/i.test(raw)) {
    return {
      title: "Connect wallet",
      message: "Connect an injected wallet to continue.",
    };
  }
  return {
    title: "Network request failed",
    message:
      "We couldn't complete the request on GenLayer Bradbury. Please try again.",
  };
}

export function formatCrownError(error: unknown) {
  const copy = getCrownErrorCopy(error);
  return `${copy.title}: ${copy.message}`;
}

export function isCrownMarketNotFound(error: unknown) {
  return /market does not exist|market not found|invalid crown market id/i.test(
    textFrom(error),
  );
}
