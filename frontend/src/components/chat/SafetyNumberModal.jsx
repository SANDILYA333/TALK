import { useState, useEffect } from "react";
import { Button } from "@heroui/react";
import { ShieldCheck, ShieldAlert, CheckCircle, X } from "lucide-react";
import {
  calculateSafetyNumber,
  getContactVerificationStatus,
  markContactVerified,
  unverifyContact,
} from "../../lib/crypto/e2e/safety-number.js";
import { getOrCreateDeviceIdentity } from "../../lib/crypto/identity.js";
import toast from "react-hot-toast";

export function SafetyNumberModal({ isOpen, onClose, peerUser }) {
  const [safetyData, setSafetyData] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState({
    isVerified: false,
    hasKeyChanged: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !peerUser) return;

    let isMounted = true;
    async function loadSafetyNumber() {
      setLoading(true);
      try {
        const localIdentity = await getOrCreateDeviceIdentity();
        const peerKeyHex =
          peerUser.publicKeyHex ||
          peerUser.activeDeviceId ||
          "01".repeat(32); // Fallback deterministic key representation for dev testing

        const res = await calculateSafetyNumber({
          localKeyHex: localIdentity.publicKeyHex,
          peerKeyHex: peerKeyHex.slice(0, 64).padEnd(64, "0"),
        });

        const status = getContactVerificationStatus({
          peerConnectId: peerUser.connectId,
          currentPeerKeyHex: peerKeyHex.slice(0, 64).padEnd(64, "0"),
        });

        if (isMounted) {
          setSafetyData(res);
          setVerificationStatus(status);
        }
      } catch (err) {
        console.error("Failed to compute safety number:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadSafetyNumber();
    return () => {
      isMounted = false;
    };
  }, [isOpen, peerUser]);

  if (!isOpen || !peerUser) return null;

  const handleToggleVerified = () => {
    if (!safetyData) return;
    const peerKeyHex = (peerUser.publicKeyHex || peerUser.connectId || "00".repeat(32))
      .slice(0, 64)
      .padEnd(64, "0");

    if (verificationStatus.isVerified) {
      unverifyContact(peerUser.connectId);
      setVerificationStatus({ isVerified: false, hasKeyChanged: false });
      toast.success("Contact marked as unverified");
    } else {
      markContactVerified({
        peerConnectId: peerUser.connectId,
        peerKeyHex,
        fingerprint: safetyData.fingerprint,
      });
      setVerificationStatus({ isVerified: true, hasKeyChanged: false });
      toast.success("Contact verified successfully!");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-muted hover:text-foreground transition-colors"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div
            className={`rounded-xl p-2.5 ${
              verificationStatus.hasKeyChanged
                ? "bg-red-500/20 text-red-400"
                : verificationStatus.isVerified
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-accent/20 text-accent"
            }`}
          >
            {verificationStatus.hasKeyChanged ? (
              <ShieldAlert className="size-6" />
            ) : (
              <ShieldCheck className="size-6" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold leading-tight">Verify Safety Number</h2>
            <p className="text-xs text-muted">End-to-End Encryption Verification</p>
          </div>
        </div>

        {verificationStatus.hasKeyChanged ? (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            <strong>Security Alert:</strong> This contact's identity key has changed since your last
            verification. This could indicate a device reinstall or a man-in-the-middle attempt.
          </div>
        ) : null}

        <p className="text-xs text-muted mb-4 leading-relaxed">
          Compare this safety number with <strong>{peerUser.fullName}</strong>. If both numbers match,
          your conversation is cryptographically secure and protected against interception.
        </p>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted animate-pulse">
            Computing cryptographic fingerprint...
          </div>
        ) : safetyData ? (
          <div className="my-4 rounded-xl border border-border bg-background/50 p-4 font-mono text-sm tracking-wider">
            <div className="grid grid-cols-3 gap-2.5 text-center text-[13px] font-semibold text-foreground/90">
              {safetyData.formattedBlocks.map((block, idx) => (
                <span key={idx} className="rounded bg-surface/80 py-1 px-1.5 shadow-sm">
                  {block}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant={verificationStatus.isVerified ? "secondary" : "primary"}
            className="w-full font-medium"
            onPress={handleToggleVerified}
          >
            {verificationStatus.isVerified ? (
              <>
                <CheckCircle className="size-4 mr-2 text-emerald-400" />
                Verified (Click to Reset)
              </>
            ) : (
              "Mark as Verified"
            )}
          </Button>

          <Button variant="ghost" size="sm" className="w-full text-muted" onPress={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
