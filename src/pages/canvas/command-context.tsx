import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';

export interface CanvasCommandHandlers {
  importMarkdownFile: (file: File) => Promise<void>;
}

interface CanvasCommandContextValue {
  getHandlers: () => CanvasCommandHandlers | null;
  registerHandlers: (handlers: CanvasCommandHandlers) => () => void;
}

const CanvasCommandContext = createContext<CanvasCommandContextValue | null>(
  null,
);

export function CanvasCommandProvider({ children }: PropsWithChildren) {
  const handlersRef = useRef<CanvasCommandHandlers | null>(null);
  const getHandlers = useCallback(() => handlersRef.current, []);
  const registerHandlers = useCallback((handlers: CanvasCommandHandlers) => {
    handlersRef.current = handlers;
    return () => {
      if (handlersRef.current === handlers) {
        handlersRef.current = null;
      }
    };
  }, []);
  const value = useMemo(
    () => ({ getHandlers, registerHandlers }),
    [getHandlers, registerHandlers],
  );

  return (
    <CanvasCommandContext.Provider value={value}>
      {children}
    </CanvasCommandContext.Provider>
  );
}

export function useCanvasCommandContext(): CanvasCommandContextValue {
  const context = useContext(CanvasCommandContext);
  if (!context) {
    throw new Error(
      'useCanvasCommandContext must be used within a CanvasCommandProvider.',
    );
  }
  return context;
}
