import { useState, useCallback, useEffect, useRef } from 'react';

const BACKEND_URL = 'http://localhost:5000';

export function useStockfish() {
  const [engineReady, setEngineReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [bestMove, setBestMove] = useState(null);
  const isThinkingRef = useRef(false);

  // Poll health endpoint sampai engine benar-benar siap
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 30;

    const checkHealth = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/bestmove/health`);
        const data = await res.json();
        if (data.status === 'ok') {
          if (!cancelled) setEngineReady(true);
          return;
        }
      } catch {
        // Backend belum siap atau belum jalan
      }

      retries++;
      if (retries < MAX_RETRIES && !cancelled) {
        setTimeout(checkHealth, 1000);
      }
    };

    checkHealth();
    return () => { cancelled = true; };
  }, []);

  const findBestMove = useCallback(async (fen) => {
    if (!engineReady || isThinkingRef.current) return;

    isThinkingRef.current = true;
    setIsThinking(true);

    try {
      const response = await fetch(`${BACKEND_URL}/bestmove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth: 18 }),
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();
      if (data.bestMove) {
        setBestMove(data.bestMove);
      }
    } catch (error) {
      console.error('Kesalahan komunikasi dengan Backend AI:', error);
    } finally {
      isThinkingRef.current = false;
      setIsThinking(false);
    }
  }, [engineReady]);

  return { engineReady, isThinking, bestMove, findBestMove, setBestMove };
}
