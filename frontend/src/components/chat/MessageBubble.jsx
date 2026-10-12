import { Check, CheckCheck, Clock, Hourglass } from "lucide-react";
import { withTransform } from "../../lib/imagekit";
import { MessageVideo } from "./MessageVideo";

// Compress + size images for the bubble (q-auto works for images; f-auto picks WebP/AVIF).
const IMAGE_TRANSFORM = "q-auto,w-640,f-auto";

export function MessageBubble({ message }) {
  const isOwnMessage = message.role === "me";
  const hasImage = Boolean(message.imageUrl);
  const hasVideo = Boolean(message.videoUrl);
  const isDecryptionFailed = Boolean(message.decryptionFailed);
  const hasExpiry = Boolean(message.expiresAt);
  const status = message.status || "sent";

  return (
    <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(90%,28rem)] rounded-2xl px-3 py-2 text-[15px] leading-snug sm:max-w-[min(75%,28rem)] sm:px-3.5 ${
          isDecryptionFailed
            ? "border border-red-500/30 bg-red-500/10 text-red-400"
            : isOwnMessage
            ? "rounded-br-md bg-accent text-accent-foreground"
            : "rounded-bl-md bg-surface"
        }`}
      >
        {hasImage ? (
          <img
            src={withTransform(message.imageUrl, IMAGE_TRANSFORM)}
            alt=""
            className="mb-1.5 max-h-40 max-w-full rounded-lg object-cover sm:max-h-52 sm:rounded-xl"
          />
        ) : null}
        {hasVideo ? <MessageVideo src={message.videoUrl} /> : null}
        {message.text ? (
          <p className={`whitespace-pre-wrap wrap-break-word ${isDecryptionFailed ? "italic text-xs" : ""}`}>
            {message.text}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-1.5 mt-1">
          {hasExpiry ? (
            <span title="Disappearing message active" className="opacity-75">
              <Hourglass className="size-3 text-amber-300 animate-pulse" />
            </span>
          ) : null}
          <p
            className={`text-[11px] tabular-nums ${
              isOwnMessage ? "text-accent-foreground/75" : "text-muted"
            }`}
          >
            {message.time}
          </p>
          {isOwnMessage ? (
            <span className="inline-flex items-center">
              {status === "read" ? (
                <CheckCheck className="size-3.5 text-sky-300" title="Read" />
              ) : status === "delivered" ? (
                <CheckCheck className="size-3.5 opacity-60" title="Delivered" />
              ) : status === "queued" ? (
                <Clock className="size-3 opacity-60 animate-spin" title="Queued (Offline)" />
              ) : (
                <Check className="size-3.5 opacity-60" title="Sent" />
              )}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}