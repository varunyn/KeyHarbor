import { useCallback, useEffect, useRef } from "react";

/** One monotonic token retires every async result from a previous Environment. */
export const useEnvironmentLifetime = () => {
  const generation = useRef(0);
  const retire = useCallback(() => {
    generation.current += 1;
    return generation.current;
  }, []);
  const capture = useCallback(() => generation.current, []);
  const isCurrent = useCallback(
    (captured: number) => generation.current === captured,
    []
  );
  useEffect(
    () => () => {
      retire();
    },
    [retire]
  );
  return { capture, isCurrent, retire };
};
