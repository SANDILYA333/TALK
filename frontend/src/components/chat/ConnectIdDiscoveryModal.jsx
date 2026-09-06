import { useState } from "react";
import { Button, Modal, useOverlayState } from "@heroui/react";
import {
  Search,
  ShieldCheck,
  KeyRound,
  Copy,
  Check,
  UserSearch,
  AlertCircle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useConnectIdDiscovery } from "../../hooks/useConnectIdDiscovery";
import { getInitials } from "../../hooks/useSelectedConversation";

export function ConnectIdDiscoveryModal({ trigger }) {
  const modal = useOverlayState();
  const {
    query,
    setQuery,
    result,
    errorMessage,
    search,
    reset,
    isLoading,
    isSuccess,
    isNotFound,
    isError,
  } = useConnectIdDiscovery();

  const [copied, setCopied] = useState(false);

  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      reset();
      setCopied(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      search(query);
    }
  };

  const handleCopyConnectId = (id) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal.Root state={modal} onOpenChange={handleOpenChange}>
      <Modal.Trigger>
        {trigger || (
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:bg-default/15"
            aria-label="Find user by Connect ID"
          >
            <UserSearch className="size-4 text-primary" aria-hidden />
            <span>Find by Connect ID</span>
          </Button>
        )}
      </Modal.Trigger>

      <Modal.Backdrop variant="opaque">
        <Modal.Container size="md" scroll="inside" placement="center">
          <Modal.Dialog className="max-h-[85dvh] border border-border bg-background text-foreground shadow-2xl">
            <Modal.Header className="flex flex-row items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserSearch className="size-4" />
                </div>
                <div>
                  <Modal.Heading className="text-base font-semibold tracking-tight text-foreground">
                    Connect ID Discovery
                  </Modal.Heading>
                  <p className="text-xs text-muted">
                    Search and verify public cryptographic identities
                  </p>
                </div>
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="space-y-5 pt-4">
              {/* Search Form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative flex items-center">
                  <KeyRound className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value.toUpperCase())}
                    placeholder="TALK-XXXX-XXXX"
                    className="w-full rounded-xl border border-border bg-default/10 py-2.5 pl-9 pr-24 font-mono text-sm uppercase tracking-wider text-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="Enter TALK Connect ID"
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="sm"
                    color="primary"
                    isDisabled={!query.trim() || isLoading}
                    className="absolute right-1.5 h-8 px-3 text-xs font-medium"
                  >
                    {isLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <>
                        <Search className="size-3.5" />
                        <span>Search</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted">
                  Connect IDs are 14-character identifiers (e.g. <span className="font-mono text-foreground font-medium">TALK-8F2K-91XZ</span>) derived directly from device public keys.
                </p>
              </form>

              {/* Status / Output Section */}
              <div aria-live="polite">
                {isLoading && (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-muted">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="mt-2 text-xs font-medium">Querying identity registry...</p>
                  </div>
                )}

                {isSuccess && result && (
                  <div className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
                        <ShieldCheck className="size-4" />
                        Verified Public Identity
                      </span>
                      <span className="rounded-md bg-default/20 px-2 py-0.5 text-[10px] font-mono text-muted">
                        v{result.version || 1} • {result.algorithm || "X25519"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      {result.user?.profilePic ? (
                        <img
                          src={result.user.profilePic}
                          alt={result.user.fullName || "User Avatar"}
                          className="size-12 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <div className="flex size-12 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                          {getInitials(result.user?.fullName || "TALK User")}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold text-foreground">
                          {result.user?.fullName || "TALK User"}
                        </h4>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <code className="rounded bg-default/20 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                            {result.connectId}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyConnectId(result.connectId)}
                            className="rounded p-1 text-muted hover:bg-default/20 hover:text-foreground"
                            title="Copy Connect ID"
                            aria-label="Copy Connect ID"
                          >
                            {copied ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Public Key Fingerprint Preview */}
                    {result.publicKey && (
                      <div className="border-t border-border/50 pt-2 text-[11px] text-muted">
                        <span className="font-medium text-foreground">Public Key:</span>{" "}
                        <code className="font-mono text-[10px] text-muted">
                          {result.publicKey.slice(0, 12)}...{result.publicKey.slice(-12)}
                        </code>
                      </div>
                    )}
                  </div>
                )}

                {isNotFound && (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
                    <AlertCircle className="size-8 text-warning" />
                    <p className="mt-2 text-sm font-medium text-foreground">No Identity Found</p>
                    <p className="mt-1 max-w-xs text-xs text-muted">
                      No registered device matches this Connect ID. Check for typos or ask the user to verify their code.
                    </p>
                  </div>
                )}

                {isError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Search Failed</p>
                      <p className="mt-0.5 text-danger/80">{errorMessage}</p>
                    </div>
                  </div>
                )}

                {!isLoading && !isSuccess && !isNotFound && !isError && (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-muted">
                    <Sparkles className="size-6 text-primary/60" />
                    <p className="mt-2 text-xs">
                      Enter an 8-character Connect ID to discover a peer.
                    </p>
                  </div>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
