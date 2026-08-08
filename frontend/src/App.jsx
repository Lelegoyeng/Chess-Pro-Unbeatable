import { useState, useEffect, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useStockfish } from './useStockfish';
import './App.css';

// ─── Layar Pilih Warna ────────────────────────────────────────────────────────
function ColorSelectScreen({ engineReady, onSelect }) {
  return (
    <div className="select-screen">
      <div className="select-card">
        {/* Logo / Judul */}
        <div className="select-logo">♛</div>
        <h1 className="select-title">Grandmaster Chess AI</h1>
        <p className="select-subtitle">Stockfish 18 · Skill Level 20 · Depth 18</p>

        {/* Status Engine */}
        <div className={`engine-status ${engineReady ? 'ready' : 'loading'}`}>
          <span className="engine-dot" />
          {engineReady ? 'Engine AI Siap' : 'Memuat Engine AI...'}
        </div>

        {/* Pilih Warna */}
        <p className="select-prompt">Pilih sisi Anda untuk memulai</p>
        <div className="color-options">
          <button
            type="button"
            className="color-btn white-btn"
            onClick={() => onSelect('w')}
            disabled={!engineReady}
          >
            <span className="piece-icon">♙</span>
            <span className="color-label">Bidak Putih</span>
            <span className="color-desc">Anda bergerak pertama</span>
          </button>

          <button
            type="button"
            className="color-btn black-btn"
            onClick={() => onSelect('b')}
            disabled={!engineReady}
          >
            <span className="piece-icon">♟</span>
            <span className="color-label">Bidak Hitam</span>
            <span className="color-desc">AI bergerak pertama</span>
          </button>
        </div>

        <p className="select-warning">⚠️ AI bermain di level Grandmaster — hampir tak terkalahkan</p>
      </div>
    </div>
  );
}

// ─── Layar Permainan ──────────────────────────────────────────────────────────
function GameScreen({ playerColor, onNewGame, engineReady, isThinking, bestMove, findBestMove, setBestMove }) {
  const [game, setGame] = useState(() => new Chess());
  const [gameStatus, setGameStatus] = useState('');
  const [lastMove, setLastMove] = useState(null);
  const gameRef = useRef(game);

  // Sinkronkan ref
  useEffect(() => { gameRef.current = game; }, [game]);

  // Update status bar
  useEffect(() => {
    const g = game;
    if (g.isCheckmate()) {
      const winner = g.turn() === 'w' ? '⬛ Hitam' : '⬜ Putih';
      setGameStatus(g.turn() === playerColor
        ? `Skakmat! ${winner} Menang 🏆`
        : 'Anda Menang! 🎉🏆');
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
    if (currentGame.turn() === playerColor || currentGame.isGameOver()) {
      setBestMove(null);
      return;
    }
    const newGame = new Chess(currentGame.fen());
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
  }, [bestMove, playerColor, setBestMove]);

  // Minta AI berpikir jika gilirannya
  useEffect(() => {
    const g = gameRef.current;
    if (g.turn() !== playerColor && !g.isGameOver() && !isThinking && engineReady) {
      findBestMove(g.fen());
    }
  }, [game, playerColor, engineReady, isThinking, findBestMove]);

  // Handle drag & drop pemain
  function onDrop(sourceSquare, targetSquare, piece) {
    if (game.turn() !== playerColor || game.isGameOver() || isThinking) return false;
    const newGame = new Chess(game.fen());
    try {
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: piece?.[1]?.toLowerCase() ?? 'q',
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
  const moveCount = Math.ceil(game.history().length / 2);

  // Highlight kotak terakhir
  const customSquareStyles = {};
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.35)' };
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.55)' };
  }

  return (
    <div className="game-screen">
      <div className="game-wrapper">

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
        <div className={`status-bar ${isGameOver ? 'status-gameover' : isThinking ? 'status-thinking' : 'status-ready'}`}>
          <span className="status-dot" />
          {gameStatus}
        </div>

        {/* Papan Catur */}
        <div className="board-wrapper">
          {isThinking && (
            <div className="thinking-overlay">
              <div className="thinking-spinner" />
            </div>
          )}
          <Chessboard
            position={game.fen()}
            onPieceDrop={onDrop}
            boardOrientation={playerColor === 'w' ? 'white' : 'black'}
            customDarkSquareStyle={{ backgroundColor: '#779556' }}
            customLightSquareStyle={{ backgroundColor: '#ebecd0' }}
            customSquareStyles={customSquareStyles}
            animationDuration={200}
            arePremovesAllowed={false}
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
              }}
            >
              🔄 Main Lagi
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [playerColor, setPlayerColor] = useState(null); // null = belum pilih
  const { engineReady, isThinking, bestMove, findBestMove, setBestMove } = useStockfish();

  const handleSelectColor = (color) => setPlayerColor(color);
  const handleNewGame = () => setPlayerColor(null);

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
    />
  );
}
