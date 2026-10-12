import { Button, TextArea } from "@heroui/react";
import { ImageIcon, LoaderIcon, SendHorizontalIcon, Timer } from "lucide-react";
import { useRef } from "react";
import useKeyboardSound from "../../hooks/useKeyboardSound";
import { useChatStore } from "../../store/useChatStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useSelectedConversation } from "../../hooks/useSelectedConversation";

const TIMER_OPTIONS = [
  { seconds: 0, label: "Off" },
  { seconds: 3600, label: "1h" },
  { seconds: 86400, label: "1d" },
  { seconds: 604800, label: "1w" },
];

export function ChatComposer() {
  const composerText = useChatStore((state) => state.composerText);
  const isSoundEnabled = useChatStore((state) => state.isSoundEnabled);
  const sendMediaMessage = useChatStore((state) => state.sendMediaMessage);
  const isSendingMedia = useChatStore((state) => state.isSendingMedia);
  const sendTextMessage = useChatStore((state) => state.sendTextMessage);
  const setComposerText = useChatStore((state) => state.setComposerText);
  const disappearingTimer = useChatStore((state) => state.disappearingTimer);
  const setDisappearingTimer = useChatStore((state) => state.setDisappearingTimer);
  const typingUsers = useChatStore((state) => state.typingUsers);

  const socket = useAuthStore((state) => state.socket);
  const { activeConversationId, activeConversation } = useSelectedConversation();
  const { playRandomKeyStrokeSound } = useKeyboardSound();
  const mediaInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const isPartnerTyping = Boolean(typingUsers[activeConversationId]);

  const playSoundIfEnabled = () => {
    if (isSoundEnabled) playRandomKeyStrokeSound();
  };

  const handleSend = async () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (socket && activeConversationId) {
      socket.emit("typing:stop", { receiverId: activeConversationId });
    }
    const didSendMessage = await sendTextMessage(activeConversationId);
    if (didSendMessage) playSoundIfEnabled();
  };

  const handleComposerTextChange = (event) => {
    const text = event.target.value;
    setComposerText(text);
    playSoundIfEnabled();

    if (socket && activeConversationId) {
      socket.emit("typing:start", { receiverId: activeConversationId });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing:stop", { receiverId: activeConversationId });
      }, 2500);
    }
  };

  const handleCycleTimer = () => {
    const currentIndex = TIMER_OPTIONS.findIndex((t) => t.seconds === disappearingTimer);
    const nextIndex = (currentIndex + 1) % TIMER_OPTIONS.length;
    setDisappearingTimer(TIMER_OPTIONS[nextIndex].seconds);
  };

  const currentTimerLabel =
    TIMER_OPTIONS.find((t) => t.seconds === disappearingTimer)?.label || "Off";

  const handleMediaPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const didSendMessage = await sendMediaMessage({
      conversationId: activeConversationId,
      file,
    });

    if (didSendMessage) playSoundIfEnabled();
  };

  return (
    <footer className="shrink-0 border-t border-border px-1.5 pb-2 pt-2 sm:px-2">
      {isPartnerTyping ? (
        <div className="mx-auto mb-1 flex items-center gap-1.5 px-3 text-xs text-muted italic animate-pulse">
          <span className="size-1.5 rounded-full bg-accent animate-ping" />
          <span>{activeConversation?.peer?.name || "Contact"} is typing...</span>
        </div>
      ) : null}

      {isSendingMedia ? (
        <div className="mx-auto mb-2 flex max-w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted">
          <LoaderIcon
            className="size-4 shrink-0 animate-spin text-accent"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate">Uploading media...</span>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-full items-end gap-1.5 px-0.5 sm:gap-2 sm:px-1">
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          disabled={isSendingMedia}
          tabIndex={-1}
          aria-hidden
          onChange={handleMediaPick}
        />
        <Button
          variant="ghost"
          isIconOnly
          isDisabled={isSendingMedia}
          className="size-9 shrink-0 touch-manipulation self-end text-accent"
          onPress={() => mediaInputRef.current?.click()}
        >
          <ImageIcon className="size-5 sm:size-6" strokeWidth={2} />
        </Button>

        <Button
          variant={disappearingTimer > 0 ? "secondary" : "ghost"}
          size="sm"
          className={`h-9 px-2 shrink-0 touch-manipulation self-end ${
            disappearingTimer > 0 ? "text-amber-400 font-medium" : "text-muted"
          }`}
          title={`Disappearing messages: ${currentTimerLabel} (Click to toggle)`}
          onPress={handleCycleTimer}
        >
          <Timer className="size-4" strokeWidth={2} />
          <span className="text-[11px] ml-1">{currentTimerLabel}</span>
        </Button>

        <TextArea
          fullWidth
          variant="secondary"
          placeholder="iMessage"
          rows={1}
          value={composerText}
          onChange={handleComposerTextChange}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          className="flex-1 rounded-full"
        />

        <Button variant="primary" isIconOnly isDisabled={!composerText.trim()} onPress={handleSend}>
          <SendHorizontalIcon className="size-5" />
        </Button>
      </div>
    </footer>
  );
}