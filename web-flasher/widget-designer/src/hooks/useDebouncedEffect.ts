import { useEffect, useRef } from "react";

/**
 * Debounce a value update and call `fn` after `delay` ms of inactivity.
 * Used to throttle the source preview recompile on every keystroke.
 */
export function useDebouncedEffect(fn, delay, deps) {
  const handle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (handle.current) clearTimeout(handle.current);
    handle.current = setTimeout(() => fn(), delay);
    return () => {
      if (handle.current) clearTimeout(handle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
