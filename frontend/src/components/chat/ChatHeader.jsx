import { Avatar, Button } from "@heroui/react";
import {
  ChevronLeftIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  Phone,
  Video,
  ShieldCheck,
} from "lucide-react";
import { AppLogo } from "../AppLogo";
import { AvatarWithOnlineIndicator } from "./AvatarWithOnlineIndicator";

import { ThemePresetPicker } from "../ThemePresetPicker";
import { ThemeToggle } from "../ThemeToggle";
import { WallpaperPicker } from "../WallpaperPicker";
import { SafetyNumberModal } from "./SafetyNumberModal";
import { CallModal } from "./CallModal";

import { useChatStore } from "../../store/useChatStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useSelectedConversation } from "../../hooks/useSelectedConversation";

export function ChatHeader() {
  const isSoundEnabled = useChatStore((state) => state.isSoundEnabled);
  const setActiveConversationId = useChatStore((state) => state.setActiveConversationId);
  const setSoundEnabled = useChatStore((state) => state.setSoundEnabled);
  const isSafetyModalOpen = useChatStore((state) => state.isSafetyModalOpen);
  const setIsSafetyModalOpen = useChatStore((state) => state.setIsSafetyModalOpen);
  const setActiveCall = useChatStore((state) => state.setActiveCall);
  const setIsCallModalOpen = useChatStore((state) => state.setIsCallModalOpen);

  const socket = useAuthStore((state) => state.socket);
  const { activeConversation, activeConversationId, isLargeScreen } = useSelectedConversation();

  const handleStartCall = (callType) => {
    if (!activeConversationId) return;
    setActiveCall({
      partnerId: activeConversationId,
      callType,
      isIncoming: false,
      status: "calling",
    });
    setIsCallModalOpen(true);

    if (socket) {
      socket.emit("call:initiate", {
        receiverId: activeConversationId,
        callType,
        offer: { type: "offer", sdp: "dummy_sdp_for_webrtc_session" },
      });
    }
  };

  return (
    <>
      <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-1.5 py-1.5 sm:gap-2 sm:px-2 sm:py-2">
        {activeConversation && !isLargeScreen ? (
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            className="shrink-0"
            onPress={() => setActiveConversationId(null)}
          >
            <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
          </Button>
        ) : null}

        {activeConversation ? (
          <>
            <AvatarWithOnlineIndicator isOnline={activeConversation.peer.isOnline ?? true}>
              <Avatar className="size-9 shrink-0">
                <Avatar.Image
                  alt={activeConversation.peer.name}
                  src={activeConversation.peer.avatarUrl}
                />
                <Avatar.Fallback className="text-sm font-medium">
                  {activeConversation.peer.initials}
                </Avatar.Fallback>
              </Avatar>
            </AvatarWithOnlineIndicator>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-[15px] font-semibold leading-tight">
                  {activeConversation.peer.name}
                </p>
                {activeConversation.peer.connectId ? (
                  <span
                    className="inline-flex items-center rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-mono text-emerald-400"
                    title={`Verified Connect ID: ${activeConversation.peer.connectId}`}
                  >
                    E2EE
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted">
                {activeConversation.peer.isOnline ? (
                  <span className="font-medium text-success">Online</span>
                ) : (
                  "Offline"
                )}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center gap-2.5 sm:text-left">
            <AppLogo size={36} className="rounded-[9px]" />
            <div className="flex-1 text-center sm:text-left">
              <p className="truncate text-[13px] font-medium text-muted">Select a conversation</p>
            </div>
          </div>
        )}

        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-0.5 sm:gap-1">
          {activeConversation ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                className="shrink-0 text-accent"
                title="Verify Safety Number"
                onPress={() => setIsSafetyModalOpen(true)}
              >
                <ShieldCheck className="size-5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                className="shrink-0 text-accent"
                title="Voice Call"
                onPress={() => handleStartCall("audio")}
              >
                <Phone className="size-4.5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                className="shrink-0 text-accent"
                title="Video Call"
                onPress={() => handleStartCall("video")}
              >
                <Video className="size-4.5" />
              </Button>
            </>
          ) : null}

          <div className="hidden min-[400px]:contents">
            <WallpaperPicker />
            <ThemePresetPicker />
          </div>

          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            className="shrink-0"
            aria-pressed={isSoundEnabled}
            onPress={() => setSoundEnabled(!isSoundEnabled)}
          >
            {isSoundEnabled ? (
              <Volume2Icon className="size-5.5" strokeWidth={2} aria-hidden />
            ) : (
              <VolumeXIcon className="size-5.5" strokeWidth={2} aria-hidden />
            )}
          </Button>

          {activeConversation ? (
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              className="shrink-0"
              aria-label="Close chat"
              onPress={() => setActiveConversationId(null)}
            >
              <XIcon className="size-5.5" strokeWidth={2} aria-hidden />
            </Button>
          ) : null}
        </div>
      </header>

      {activeConversation ? (
        <SafetyNumberModal
          isOpen={isSafetyModalOpen}
          onClose={() => setIsSafetyModalOpen(false)}
          peerUser={{
            fullName: activeConversation.peer.name,
            connectId: activeConversation.peer.connectId,
            publicKeyHex: activeConversation.peer.activeDeviceId,
          }}
        />
      ) : null}

      <CallModal />
    </>
  );
}