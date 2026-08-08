import { useState, useCallback, useEffect, useRef } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export function useStockfish() {
  const [engineReady, setEngineReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [bestMove, setBestMove] = useState(null);
  const isThinkingRef = useRef(false);
  const findBestMoveRef = useRef(null);
  // FEN yang diminta untuk langkah AI terakhir — dipakai untuk menolak respons
  // basi (mis. setelah permainan di-reset saat AI masih berpikir).
  const lastRequestedFenRef = useRef(null);

  // Poll health endpoint terus-menerus:
  // - Selama belum siap, coba tiap 2 detik (tanpa batas percobaan).
  // - Setelah siap, tetap cek tiap 5 detik; jika backend restart/mati, frontend
  //   akan tahu dan AI bisa tersambung kembali otomatis.
  useEffect(() => {
    let cancelled = false;
    let failures = 0;

    const checkHealth = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${BACKEND_URL}/bestmove/health`);
        const data = await res.json();
        if (data.status === 'ok') {
          failures = 0;
          if (!cancelled) setEngineReady(true);
        } else {
          failures += 1;
        }
      } catch {
        failures += 1;
      }

      // Matikan status siap setelah 3 kegagalan berturut-turut (hindari flapping)
      if (failures >= 3 && !cancelled) {
        setEngineReady(false);
      }

      if (!cancelled) {
        setTimeout(checkHealth, failures >= 3 ? 3000 : 2000);
      }
    };

    checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const findBestMove = useCallback(
    async (fen, retriesLeft = 2) => {
      if (!engineReady || isThinkingRef.current) return;

      isThinkingRef.current = true;
      setIsThinking(true);
      lastRequestedFenRef.current = fen;

      let retrying = false;
      try {
        const response = await fetch(`${BACKEND_URL}/bestmove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen, depth: 18 }),
        });

        // 429 = engine sedang sibuk (mis. sedang analisis) → coba lagi sebentar
        if (response.status === 429 && retriesLeft > 0) {
          retrying = true;
          await new Promise((r) => setTimeout(r, 1500));
          return findBestMoveRef.current(fen, retriesLeft - 1);
        }

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();
        if (data.bestMove) {
          setBestMove(data.bestMove);
        }
      } catch (error) {
        console.error('Kesalahan komunikasi dengan Backend AI:', error);
      } finally {
        // Jangan reset status berpikir saat retry masih berjalan
        if (!retrying) {
          isThinkingRef.current = false;
          setIsThinking(false);
        }
      }
    },
    [engineReady],
  );

  findBestMoveRef.current = findBestMove;

  // Analisis posisi: kembalikan { evalCp, mate, pv, depth } atau null.
  // Hanya dipanggil saat engine sedang idle (tidak sedang berpikir).
  const analyzePosition = useCallback(
    async (fen) => {
      if (!engineReady || isThinkingRef.current) return null;
      try {
        const response = await fetch(`${BACKEND_URL}/bestmove/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen, depth: 14 }),
        });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const data = await response.json();
        return {
          evalCp: typeof data.evalCp === 'number' ? data.evalCp : null,
          mate: typeof data.mate === 'number' ? data.mate : null,
          pv: Array.isArray(data.pv) ? data.pv : [],
          depth: data.depth ?? 0,
        };
      } catch (error) {
        console.error('Kesalahan saat menganalisis posisi:', error);
        return null;
      }
    },
    [engineReady],
  );

  return {
    engineReady,
    isThinking,
    bestMove,
    findBestMove,
    setBestMove,
    analyzePosition,
    lastRequestedFenRef,
  };
}
