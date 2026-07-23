import { useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";

/**
 * Custom hook to auto-scroll to bottom when new messages arrive
 */
export default function useScrollToBottom(conversationId, lastMessageId) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [conversationId, lastMessageId]);

  return ref;
}

/**
 * Subscribes to a CSS media query
 */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}