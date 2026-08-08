import { useState, useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useStockfish } from './useStockfish';
import './App.css';

// ─── Konstanta ────────────────────────────────────────────────────────────────
const PIECE_UNICODE = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const STORAGE_KEY = 'chess-pro-unbeatable-state';

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.playerColor) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Klon posisi chess.js TANPA kehilangan riwayat langkah.
 * Catatan: `new Chess(fen)` akan menghapus history() — jadi kita klon lewat PGN.
 */
function cloneGame(source) {
  try {
    const clone = new Chess();
    clone.loadPgn(source.pgn());
    return clone;
  } catch {
    return new Chess(source.fen());
  }
}

/** Konversi eval centipawn ke persentase kemenangan (perspektif Putih). */
function evalToWinPct(evalCp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evalCp)) - 1);
}

function formatEval(analysis) {
  if (!analysis) return '—';
  if (analysis.mate != null) return `M${analysis.mate > 0 ? '+' : '-'}${Math.abs(analysis.mate)}`;
  if (analysis.evalCp != null) {
    const value = analysis.evalCp / 100;
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  }
  return '—';
}

// ─── Layar Pilih Warna ────────────────────────────────────────────────────────
function ColorSelectScreen({ engineReady, onSelect }) {
  return (
    <div className="select-screen">
      <div className="select-card">
        {/* Logo / Judul */}
        <div className="select-logo">♛</div>
        <h1 className="select-title">Chess AI</h1>
        <p className="select-subtitle">Lelegoyeng Dev</p>

        {/* Status Engine */}
        <div className={`engine-status ${engineReady ? 'ready' : 'loading'}`}>
          <span className="engine-dot" />
          {engineReady ? 'Engine AI Siap' : 'Menghubungkan ke Engine AI...'}
        </div>

        {/* Pilih Warna */}
        <p className="select-prompt">Pilih sisi Anda untuk memulai</p>
        <div className="color-options">
          <button
            type="button"
            className="color-btn white-btn"
            onClick={() => onSelect('w')}
          >
            <span className="piece-icon">♙</span>
            <span className="color-label">Bidak Putih</span>
            <span className="color-desc">Anda bergerak pertama</span>
          </button>

          <button
            type="button"
            className="color-btn black-btn"
            onClick={() => onSelect('b')}
          >
            <span className="piece-icon">♟</span>
            <span className="color-label">Bidak Hitam</span>
            <span className="color-desc">AI bergerak pertama</span>
          </button>
        </div>

        {!engineReady && (
          <p className="select-warning">
            ⚠️ Engine belum terhubung — Anda tetap bisa mulai, AI akan merespons
            setelah engine tersedia. Pastikan backend berjalan di port 5000.
          </p>
        )}
        {engineReady && (
          <p className="select-warning">
            ⚠️ AI bermain di level Grandmaster — hampir tak terkalahkan
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Kartu Analisis ───────────────────────────────────────────────────────────
function AnalysisCard({ game, playerColor, analysis, stats, isThinking }) {
  const evalPct = useMemo(() => {
    if (!analysis) return null;
    if (analysis.mate != null) return analysis.mate > 0 ? 100 : 0;
    if (analysis.evalCp != null) return Math.max(4, Math.min(96, evalToWinPct(analysis.evalCp)));
    return null;
  }, [analysis]);

  // Langkah terbaik dari engine (UCI → SAN)
  const bestMoveSan = useMemo(() => {
    if (!analysis?.pv?.length) return null;
    try {
      const tmp = new Chess(game.fen());
      const uci = analysis.pv[0];
      const m = tmp.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : 'q',
      });
      return m?.san ?? null;
    } catch {
      return null;
    }
  }, [analysis, game]);

  const materialAdv = stats.white - stats.black;

  const whiteSide = playerColor === 'w';

  return (
    <div className="card analysis-card">
      <div className="card-header">
        <span className="card-title">📊 Analisis</span>
        <span className="card-badge">{analysis ? `Depth ${analysis.depth}` : 'Menunggu...'}</span>
      </div>

      {/* Eval bar */}
      <div className="eval-block">
        <div className="eval-bar">
          <div
            className="eval-bar-fill"
            style={{ width: `${evalPct ?? 50}%` }}
          />
          <div className="eval-bar-mid" />
        </div>
        <div className="eval-label">
          <span className="eval-text">{formatEval(analysis)}</span>
          <span className="eval-persp">Perspektif Putih</span>
        </div>
      </div>

      {/* Material */}
      <div className="stat-row">
        <span className="stat-label">Material</span>
        <span className="stat-value">
          {stats.white} vs {stats.black}
        </span>
      </div>
      <div className={`material-adv ${materialAdv !== 0 ? (materialAdv > 0 ? 'adv-white' : 'adv-black') : ''}`}>
        {materialAdv !== 0
          ? `${materialAdv > 0 ? '⬜' : '⬛'} Putih unggul ${Math.abs(materialAdv)} poin`
          : '⚖️ Material seimbang'}
      </div>

      {/* Bidak yang ditangkap */}
      <div className="captured-block">
        <div className="captured-side">
          <span className="captured-label">⬜ Putih menangkap</span>
          <span className="captured-pieces">
            {stats.capturedByWhite.length === 0 ? (
              <span className="captured-empty">—</span>
            ) : (
              stats.capturedByWhite.map((c) => (
                <span key={c.id} className="piece-glyph">{PIECE_UNICODE[c.type]}</span>
              ))
            )}
          </span>
        </div>
        <div className="captured-side">
          <span className="captured-label">⬛ Hitam menangkap</span>
          <span className="captured-pieces">
            {stats.capturedByBlack.length === 0 ? (
              <span className="captured-empty">—</span>
            ) : (
              stats.capturedByBlack.map((c) => (
                <span key={c.id} className="piece-glyph black-glyph">{PIECE_UNICODE[c.type]}</span>
              ))
            )}
          </span>
        </div>
      </div>

      {/* Langkah terbaik engine */}
      <div className="stat-row bestmove-row">
        <span className="stat-label">Langkah terbaik</span>
        <span className="stat-value">
          {isThinking ? (
            <span className="thinking-text">Menghitung...</span>
          ) : bestMoveSan ? (
            <span className="bestmove-text">♞ {bestMoveSan}</span>
          ) : (
            <span className="thinking-text">—</span>
          )}
        </span>
      </div>

      <div className="stat-row">
        <span className="stat-label">Anda bermain</span>
        <span className="stat-value">{whiteSide ? '⬜ Putih' : '⬛ Hitam'}</span>
      </div>
    </div>
  );
}

// ─── Riwayat Langkah ──────────────────────────────────────────────────────────
function HistoryPanel({ history, latestIndex }) {
  const listRef = useRef(null);

  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      number: i / 2 + 1,
      white: history[i],
      whiteIdx: i,
      black: history[i + 1],
      blackIdx: i + 1,
    });
  }

  useEffect(() => {
    const { length } = history;
    if (length > 0 && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [history]);

  return (
    <div className="card history-card">
      <div className="card-header">
        <span className="card-title">📜 Riwayat Langkah</span>
        <span className="card-badge">{history.length} langkah</span>
      </div>
      <div className="history-list" ref={listRef}>
        {rows.length === 0 ? (
          <p className="history-empty">Belum ada langkah — mulai permainan!</p>
        ) : (
          rows.map((row) => (
            <div className="history-row" key={row.number}>
              <span className="move-num">{row.number}.</span>
              <span className={`move-san ${row.whiteIdx === latestIndex ? 'move-current' : ''}`}>
                {row.white}
              </span>
              <span className={`move-san ${row.blackIdx === latestIndex ? 'move-current' : ''}`}>
                {row.black ?? ''}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Layar Permainan ──────────────────────────────────────────────────────────
function GameScreen({
  playerColor,
  onNewGame,
  engineReady,
  isThinking,
  bestMove,
  findBestMove,
  setBestMove,
  analyzePosition,
  lastRequestedFenRef,
}) {
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = loadSavedState();

  const [game, setGame] = useState(() => {
    try {
      if (savedRef.current?.pgn) {
        try {
          const restored = new Chess();
          restored.loadPgn(savedRef.current.pgn);
          return restored;
        } catch {
          // PGN korup → jatuh ke pemulihan lewat FEN
        }
      }
      return savedRef.current?.fen ? new Chess(savedRef.current.fen) : new Chess();
    } catch {
      return new Chess();
    }
  });
  const [gameStatus, setGameStatus] = useState('');
  const [lastMove, setLastMove] = useState(savedRef.current?.lastMove ?? null);
  const [analysis, setAnalysis] = useState(null);
  const gameRef = useRef(game);

  // Simpan progres permainan (PGN + FEN + langkah terakhir) agar history tetap tersimpan
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ playerColor, pgn: game.pgn(), fen: game.fen(), lastMove }),
      );
    } catch {
      // localStorage tidak tersedia — abaikan
    }
  }, [game, lastMove, playerColor]);

  // Sinkronkan ref
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // Statistik material & bidak yang ditangkap
  const stats = useMemo(() => {
    const hist = game.history({ verbose: true });
    const capturedByWhite = [];
    const capturedByBlack = [];
    for (let i = 0; i < hist.length; i += 1) {
      const m = hist[i];
      if (!m.captured) continue;
      const entry = { type: m.captured, id: `${i}-${m.captured}` };
      if (m.color === 'w') capturedByWhite.push(entry);
      else capturedByBlack.push(entry);
    }
    let white = 0;
    let black = 0;
    for (const row of game.board()) {
      for (const sq of row) {
        if (!sq) continue;
        const value = PIECE_VALUES[sq.type] ?? 0;
        if (sq.color === 'w') white += value;
        else black += value;
      }
    }
    return { white, black, capturedByWhite, capturedByBlack };
  }, [game]);

  const history = useMemo(() => game.history(), [game]);
  const latestIndex = history.length - 1;

  // Update status bar
  useEffect(() => {
    const g = game;
    if (g.isCheckmate()) {
      const winner = g.turn() === 'w' ? '⬛ Hitam' : '⬜ Putih';
      setGameStatus(
        g.turn() === playerColor ? `Skakmat! ${winner} Menang 🏆` : 'Anda Menang! 🎉🏆',
      );
    } else if (g.isStalemate()) {
      setGameStatus('Pat! Remis 🤝');
    } else if (g.isDraw()) {
      setGameStatus('Remis! 🤝');
    } else if (isThinking) {
      setGameStatus('AI Sedang Berpikir... 🧠');
    } else if (g.inCheck()) {
      setGameStatus(g.turn() === playerColor ? 'Skak! Lindungi Raja Anda ⚠️' : 'AI dalam Skak!');
    } else if (g.turn() === playerColor) {
      setGameStatus('Giliran Anda ♟️');
    } else {
      setGameStatus('Giliran AI...');
    }
  }, [game, isThinking, playerColor]);

  // Terapkan langkah AI
  useEffect(() => {
    if (!bestMove) return;
    const currentGame = gameRef.current;
    // Tolak respons basi: langkah AI harus untuk posisi yang masih sama
    // (melindungi dari kasus permainan di-reset saat AI sedang berpikir).
    if (
      currentGame.turn() === playerColor ||
      currentGame.isGameOver() ||
      lastRequestedFenRef.current !== currentGame.fen()
    ) {
      setBestMove(null);
      return;
    }
    const newGame = cloneGame(currentGame);
    try {
      const move = newGame.move({
        from: bestMove.substring(0, 2),
        to: bestMove.substring(2, 4),
        promotion: bestMove.length > 4 ? bestMove.substring(4, 5) : 'q',
      });
      if (move) {
        setLastMove({ from: move.from, to: move.to });
        setGame(newGame);
      }
    } catch (e) {
      console.error('Error menerapkan langkah AI:', bestMove, e);
    }
    setBestMove(null);
  }, [bestMove, playerColor, setBestMove, lastRequestedFenRef]);

  // Minta AI berpikir jika gilirannya.
  // Guard `!bestMove` mencegah request ganda saat langkah AI baru saja diterapkan
  // di commit yang sama (efek think membaca `game` yang belum diperbarui).
  useEffect(() => {
    const g = game;
    if (g.turn() !== playerColor && !g.isGameOver() && !isThinking && engineReady && !bestMove) {
      findBestMove(g.fen());
    }
  }, [game, playerColor, engineReady, isThinking, bestMove, findBestMove]);

  // Minta analisis posisi saat giliran pemain (engine sedang idle).
  // Ref guard mencegah request ganda untuk posisi yang sama (mis. StrictMode).
  const analyzedFenRef = useRef(null);
  useEffect(() => {
    const g = game;
    if (g.isGameOver()) return;
    if (g.turn() === playerColor && !isThinking) {
      const fen = g.fen();
      if (analyzedFenRef.current === fen) return;
      analyzedFenRef.current = fen;
      analyzePosition(fen).then((res) => {
        if (res) setAnalysis(res);
      });
    }
  }, [game, playerColor, isThinking, analyzePosition]);

  // Handle drag & drop pemain (API react-chessboard v5: argumen berupa objek)
  function onDrop({ sourceSquare, targetSquare }) {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor || game.isGameOver() || isThinking) return false;
    const newGame = cloneGame(game);
    try {
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        // v5 tidak menyediakan picker promosi → otomatis promosi jadi menteri
        promotion: 'q',
      });
      if (!move) return false;
      setLastMove({ from: move.from, to: move.to });
      setGame(newGame);
      return true;
    } catch {
      return false;
    }
  }

  const isGameOver = game.isGameOver();
  const moveCount = Math.ceil(history.length / 2);

  // Highlight kotak terakhir
  const customSquareStyles = {};
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.35)' };
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.55)' };
  }

  return (
    <div className="game-screen">
      <div className="game-layout">
        {/* Kolom Papan */}
        <div className="board-column">
          {/* Header */}
          <header className="game-header">
            <div className="game-title-group">
              <span className="game-logo">♛</span>
              <div>
                <h1 className="game-title">Grandmaster Chess AI</h1>
                <p className="game-meta">Stockfish 18 · Level Grandmaster</p>
              </div>
            </div>
            <div className="game-info">
              <span className="move-counter">Giliran {moveCount + 1}</span>
              <span className={`player-badge ${playerColor === 'w' ? 'badge-white' : 'badge-black'}`}>
                {playerColor === 'w' ? '♙ Putih' : '♟ Hitam'}
              </span>
            </div>
          </header>

          {/* Status Bar */}
          <div
            className={`status-bar ${isGameOver ? 'status-gameover' : isThinking ? 'status-thinking' : 'status-ready'}`}
          >
            <span className="status-dot" />
            {gameStatus}
          </div>

          {!engineReady && (
            <div className="engine-warning">
              ⚠️ Engine AI tidak terhubung. Gerakan Anda tetap bisa dimainkan, tetapi AI
              tidak akan merespons. Pastikan backend berjalan di port 5000.
            </div>
          )}

          {/* Papan Catur */}
          <div className="board-wrapper">
            {isThinking && (
              <div className="thinking-overlay">
                <div className="thinking-spinner" />
              </div>
            )}
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: onDrop,
                boardOrientation: playerColor === 'w' ? 'white' : 'black',
                darkSquareStyle: { backgroundColor: '#779556' },
                lightSquareStyle: { backgroundColor: '#ebecd0' },
                squareStyles: customSquareStyles,
                animationDurationInMs: 200,
              }}
            />
          </div>

          {/* Kontrol */}
          <div className="game-controls">
            <button type="button" className="btn-new-game" onClick={onNewGame}>
              ← Pilih Warna Baru
            </button>
            {isGameOver && (
              <button
                type="button"
                className="btn-play-again"
                onClick={() => {
                  setGame(new Chess());
                  setLastMove(null);
                  setBestMove(null);
                  setAnalysis(null);
                  analyzedFenRef.current = null;
                }}
              >
                🔄 Main Lagi
              </button>
            )}
          </div>
        </div>

        {/* Sidebar: Analisis + Riwayat */}
        <aside className="sidebar">
          <AnalysisCard
            game={game}
            playerColor={playerColor}
            analysis={analysis}
            stats={stats}
            isThinking={isThinking}
          />
          <HistoryPanel history={history} latestIndex={latestIndex} />
        </aside>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [playerColor, setPlayerColor] = useState(() => loadSavedState()?.playerColor ?? null);
  const {
    engineReady,
    isThinking,
    bestMove,
    findBestMove,
    setBestMove,
    analyzePosition,
    lastRequestedFenRef,
  } = useStockfish();

  const handleSelectColor = (color) => setPlayerColor(color);
  const handleNewGame = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // abaikan
    }
    setPlayerColor(null);
  };

  if (!playerColor) {
    return <ColorSelectScreen engineReady={engineReady} onSelect={handleSelectColor} />;
  }

  return (
    <GameScreen
      playerColor={playerColor}
      onNewGame={handleNewGame}
      engineReady={engineReady}
      isThinking={isThinking}
      bestMove={bestMove}
      findBestMove={findBestMove}
      setBestMove={setBestMove}
      analyzePosition={analyzePosition}
      lastRequestedFenRef={lastRequestedFenRef}
    />
  );
}
