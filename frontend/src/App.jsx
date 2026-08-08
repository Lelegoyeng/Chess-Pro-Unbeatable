import { useState, useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useStockfish } from './useStockfish';
import './App.css';

// ─── Konstanta ────────────────────────────────────────────────────────────────
const PIECE_UNICODE = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAMES = { p: 'Pion', n: 'Kuda', b: 'Gajah', r: 'Benteng', q: 'Menteri', k: 'Raja' };
const PIECE_COLORS = { p: '#9ca3af', n: '#a78bfa', b: '#60a5fa', r: '#2dd4bf', q: '#fbbf24', k: '#ef4444' };
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

/** Format nilai eval (sudah berperspektif Putih). */
function formatEvalNum(evalCp, mate) {
  if (mate != null) return `M${mate > 0 ? '+' : '-'}${Math.abs(mate)}`;
  if (evalCp != null) {
    const value = evalCp / 100;
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  }
  return '—';
}

/** Konversi notasi kotak ("e4") ke koordinat persen untuk overlay papan. */
function squareToPct(square, flipped) {
  const file = square.charCodeAt(0) - 97;
  const rank = square.charCodeAt(1) - 49;
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { left: col * 12.5, top: row * 12.5 };
}

function squareOverlayStyle(square, flipped) {
  const { left, top } = squareToPct(square, flipped);
  return { left: `${left}%`, top: `${top}%`, width: '12.5%', height: '12.5%' };
}

/**
 * Temukan sumber skak: bidak lawan yang menyerang kotak raja.
 * Pakai `attackers(square, color)` bawaan chess.js (verbose) sehingga konsisten
 * dengan definisi inCheck() chess.js dan menangani skak ganda sekaligus.
 * Catatan: `moves({square})` TIDAK bisa dipakai karena hanya mengembalikan
 * langkah untuk sisi yang sedang giliran (bukan sisi penyerang).
 * @returns {{ kingSquare: string|null, attackers: Array<{from, to, piece}> }}
 */
function findCheckInfo(game) {
  if (!game?.inCheck()) return { kingSquare: null, attackers: [] };
  const turn = game.turn();
  const enemy = turn === 'w' ? 'b' : 'w';
  const board = game.board();
  let kingSquare = null;
  const pieces = {};

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = board[r][c];
      if (!piece) continue;
      const sq = `${'abcdefgh'[c]}${8 - r}`;
      pieces[sq] = piece.type;
      if (piece.type === 'k' && piece.color === turn) kingSquare = sq;
    }
  }

  if (!kingSquare) return { kingSquare: null, attackers: [] };

  let attackerSquares = [];
  try {
    attackerSquares = game.attackers(kingSquare, enemy);
  } catch {
    attackerSquares = [];
  }

  const attackers = attackerSquares.map((from) => ({
    from,
    to: kingSquare,
    piece: pieces[from] ?? '?',
  }));
  return { kingSquare, attackers };
}

// ─── Grafik Evaluasi (garis) ──────────────────────────────────────────────────
function EvalChart({ history }) {
  const W = 300;
  const H = 110;
  const PAD = 8;
  const data = history.filter((e) => e.evalCp != null || e.mate != null);

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        Belum ada data evaluasi — mulai bermain untuk melihat grafik 📈
      </div>
    );
  }

  const winPctOf = (e) => {
    if (e.mate != null) {
      const whiteWins = e.side === 'w' ? e.mate > 0 : e.mate < 0;
      return whiteWins ? 100 : 0;
    }
    const whiteEval = e.side === 'w' ? e.evalCp : -e.evalCp;
    return Math.max(2, Math.min(98, evalToWinPct(whiteEval)));
  };

  const pts = data.map((e, i) => {
    const winPct = winPctOf(e);
    const x = data.length === 1 ? W / 2 : PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (winPct / 100) * (H - PAD * 2);
    return { x, y };
  });

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)} ${H - PAD} L${pts[0].x.toFixed(1)} ${H - PAD} Z`;
  const midY = H - PAD - (H - PAD * 2) / 2;
  const last = data[data.length - 1];
  const lastWhiteEval = last.side === 'w' ? last.evalCp : -last.evalCp;
  const lastMate = last.mate != null ? (last.side === 'w' ? last.mate : -last.mate) : null;
  const lastPt = pts[pts.length - 1];
  const isWhiteAdv = lastMate != null ? lastMate > 0 : lastWhiteEval >= 0;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="eval-chart">
        <title>Grafik perkembangan evaluasi</title>
        <defs>
          <linearGradient id="evalArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8e6e0" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#e8e6e0" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} className="chart-mid" />
        <path d={areaPath} fill="url(#evalArea)" />
        <path
          d={linePath}
          fill="none"
          className={`chart-line ${isWhiteAdv ? 'chart-line-white' : 'chart-line-black'}`}
        />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="3.5"
          className={`chart-dot ${isWhiteAdv ? 'chart-dot-white' : 'chart-dot-black'}`}
        />
      </svg>
      <div className="chart-footer">
        <span>⬛ Hitam unggul</span>
        <span className="chart-value">{formatEvalNum(lastWhiteEval, lastMate)}</span>
        <span>⬜ Putih unggul</span>
      </div>
    </div>
  );
}

// ─── Donut Aktivitas Bidak ────────────────────────────────────────────────────
function ActivityDonut({ title, byPiece }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const entries = Object.entries(byPiece)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  let offset = 0;

  return (
    <div className="donut">
      <div className="donut-chart-wrap">
        <svg viewBox="0 0 80 80" className="donut-svg">
          <title>Aktivitas bidak</title>
          <circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="10"
          />
          {entries.map(([type, count]) => {
            const frac = count / total;
            const seg = (
              <circle
                key={type}
                cx="40"
                cy="40"
                r={R}
                fill="none"
                stroke={PIECE_COLORS[type]}
                strokeWidth="10"
                strokeDasharray={`${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`}
                strokeDashoffset={-offset.toFixed(2)}
                transform="rotate(-90 40 40)"
              />
            );
            offset += frac * C;
            return seg;
          })}
        </svg>
        <div className="donut-center">
          <span className="donut-total">{total}</span>
          <span className="donut-label">langkah</span>
        </div>
      </div>
      <span className="donut-title">{title}</span>
      <div className="donut-legend">
        {entries.length === 0 ? (
          <span className="legend-empty">Belum ada langkah</span>
        ) : (
          entries.map(([type, count]) => (
            <span key={type} className="legend-item">
              <span className="legend-swatch" style={{ background: PIECE_COLORS[type] }} />
              {PIECE_NAMES[type]} <b>{count}</b>
            </span>
          ))
        )}
      </div>
    </div>
  );
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
function AnalysisCard({ game, playerColor, analysis, stats, evalHistory, isThinking }) {
  const whiteEval = useMemo(() => {
    if (!analysis) return null;
    const whiteToMove = game.turn() === 'w';
    if (analysis.mate != null) return whiteToMove ? analysis.mate : -analysis.mate;
    if (analysis.evalCp != null) return whiteToMove ? analysis.evalCp : -analysis.evalCp;
    return null;
  }, [analysis, game]);

  const evalPct = useMemo(() => {
    if (whiteEval == null) return null;
    if (analysis.mate != null) return whiteEval > 0 ? 100 : 0;
    return Math.max(4, Math.min(96, evalToWinPct(whiteEval)));
  }, [analysis, whiteEval]);

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

  // Aktivitas tiap sisi: langkah per jenis bidak, tangkapan, skak
  const activity = useMemo(() => {
    const hist = game.history({ verbose: true });
    const mk = () => ({ moves: 0, captures: 0, checks: 0, byPiece: {} });
    const sides = { w: mk(), b: mk() };
    for (const m of hist) {
      const s = sides[m.color];
      s.moves += 1;
      s.byPiece[m.piece] = (s.byPiece[m.piece] ?? 0) + 1;
      if (m.captured) s.captures += 1;
      if (m.san.endsWith('+') || m.san.endsWith('#')) s.checks += 1;
    }
    return sides;
  }, [game]);

  const materialAdv = stats.white - stats.black;
  const whiteSide = playerColor === 'w';
  const evalLabel = formatEvalNum(
    analysis?.evalCp != null ? whiteEval : null,
    analysis?.mate != null ? whiteEval : null,
  );

  return (
    <div className="card analysis-card">
      <div className="card-header">
        <span className="card-title">📊 Analisis</span>
        <span className="card-badge">{analysis ? `Depth ${analysis.depth}` : 'Menunggu...'}</span>
      </div>

      {/* Eval bar */}
      <div className="eval-block">
        <div className="eval-bar">
          <div className="eval-bar-fill" style={{ width: `${evalPct ?? 50}%` }} />
          <div className="eval-bar-mid" />
        </div>
        <div className="eval-label">
          <span className="eval-text">{evalLabel}</span>
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

      {/* Grafik evaluasi */}
      <div className="chart-section">
        <div className="chart-title-row">
          <span className="chart-title">📈 Perkembangan Evaluasi</span>
          <span className="chart-badge">Perspektif Putih</span>
        </div>
        <EvalChart history={evalHistory} />
      </div>

      {/* Aktivitas bidak */}
      <div className="chart-section">
        <div className="chart-title-row">
          <span className="chart-title">🎯 Bagaimana Sisi Bermain</span>
          <span className="chart-badge">Aktivitas bidak</span>
        </div>
        <div className="donut-row">
          <ActivityDonut title="⬜ Putih" byPiece={activity.w.byPiece} />
          <ActivityDonut title="⬛ Hitam" byPiece={activity.b.byPiece} />
        </div>
        <div className="activity-stats">
          <div className="activity-col">
            <span>Langkah <b>{activity.w.moves}</b></span>
            <span>Tangkapan <b>{activity.w.captures}</b></span>
            <span>Skak <b>{activity.w.checks}</b></span>
          </div>
          <div className="activity-col">
            <span>Langkah <b>{activity.b.moves}</b></span>
            <span>Tangkapan <b>{activity.b.captures}</b></span>
            <span>Skak <b>{activity.b.checks}</b></span>
          </div>
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

  // Riwayat evaluasi untuk grafik garis: { ply, side, evalCp, mate }
  const [evalHistory, setEvalHistory] = useState(() => {
    const saved = savedRef.current?.evalHistory;
    if (!Array.isArray(saved)) return [];
    const maxPly = game.history().length;
    const seen = new Set();
    return saved.filter(
      (e) =>
        e &&
        typeof e.ply === 'number' &&
        e.ply <= maxPly &&
        !seen.has(e.ply) &&
        Boolean(seen.add(e.ply)),
    );
  });

  // Simpan progres permainan (PGN + FEN + langkah terakhir) agar history tetap tersimpan
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ playerColor, pgn: game.pgn(), fen: game.fen(), lastMove, evalHistory }),
      );
    } catch {
      // localStorage tidak tersedia — abaikan
    }
  }, [game, lastMove, playerColor, evalHistory]);

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

  // Sumber skak & status skakmat
  const isCheckmate = game.isCheckmate();
  const flipped = playerColor === 'b';
  const checkInfo = useMemo(() => findCheckInfo(game), [game]);

  // Data grafik hanya untuk ply yang masih relevan dengan permainan saat ini
  const chartHistory = useMemo(
    () => evalHistory.filter((e) => e.ply <= history.length),
    [evalHistory, history],
  );

  // Update status bar
  useEffect(() => {
    const g = game;
    if (g.isCheckmate()) {
      const loser = g.turn();
      const winner = loser === 'w' ? '⬛ Hitam' : '⬜ Putih';
      setGameStatus(
        loser === playerColor
          ? `Skakmat! Raja Anda terkunci dan tak bisa bergerak — ${winner} Menang 🏆`
          : `Skakmat! Raja ${loser === 'w' ? 'Putih' : 'Hitam'} terkunci dan tak bisa bergerak — Anda Menang! 🎉`,
      );
    } else if (g.isStalemate()) {
      setGameStatus('Pat! Remis 🤝');
    } else if (g.isDraw()) {
      setGameStatus('Remis! 🤝');
    } else if (isThinking) {
      setGameStatus('AI Sedang Berpikir... 🧠');
    } else if (g.inCheck()) {
      const from = checkInfo.attackers.length
        ? ` dari ${checkInfo.attackers.map((a) => PIECE_NAMES[a.piece]).join(' & ')}`
        : '';
      setGameStatus(
        g.turn() === playerColor
          ? `Skak! Lindungi Raja Anda${from} ⚠️`
          : `AI dalam Skak${from}!`,
      );
    } else if (g.turn() === playerColor) {
      setGameStatus('Giliran Anda ♟️');
    } else {
      setGameStatus('Giliran AI...');
    }
  }, [game, isThinking, playerColor, checkInfo]);

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
      const requestPly = g.history().length;
      const requestSide = g.turn();
      analyzePosition(fen).then((res) => {
        if (!res) return;
        // Catat poin evaluasi untuk ply tsb (data historis sah walau pemain sudah
        // melangkah duluan). Dedup global + urutkan agar grafik tetap konsisten
        // meski respons tiba tidak berurutan.
        setEvalHistory((prev) => {
          if (prev.some((e) => e.ply === requestPly)) return prev;
          return [
            ...prev,
            { ply: requestPly, side: requestSide, evalCp: res.evalCp, mate: res.mate },
          ].sort((a, b) => a.ply - b.ply);
        });
        // Hanya tampilkan analisis jika posisi belum berubah (hindari eval basi
        // yang salah perspektif setelah pemain bergerak cepat).
        if (gameRef.current.fen() === fen) {
          setAnalysis(res);
        }
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

  // Highlight kotak terakhir + kotak sumber skak & raja
  const customSquareStyles = {};
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.35)' };
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.55)' };
  }
  if (checkInfo.attackers.length > 0) {
    for (const a of checkInfo.attackers) {
      customSquareStyles[a.from] = {
        backgroundColor: 'rgba(239, 68, 68, 0.5)',
        boxShadow: 'inset 0 0 0 2px rgba(239, 68, 68, 0.9)',
      };
    }
    customSquareStyles[checkInfo.kingSquare] = {
      backgroundColor: isCheckmate ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.55)',
      boxShadow: 'inset 0 0 0 2px rgba(239, 68, 68, 0.95)',
    };
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
                <h1 className="game-title">Chess AI</h1>
                <p className="game-meta">Lelegoyeng Dev</p>
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
          <div className={`board-wrapper ${isCheckmate ? 'mated' : ''}`}>
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

            {/* Garis sumber skak */}
            {checkInfo.attackers.length > 0 && (
              <svg className="check-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <title>Garis sumber skak</title>
                {checkInfo.attackers.map((a) => {
                  const from = squareToPct(a.from, flipped);
                  const to = squareToPct(a.to, flipped);
                  return (
                    <line
                      key={`${a.from}-${a.to}`}
                      className="check-line"
                      x1={from.left + 6.25}
                      y1={from.top + 6.25}
                      x2={to.left + 6.25}
                      y2={to.top + 6.25}
                    />
                  );
                })}
              </svg>
            )}

            {/* Ring highlight penyerang & raja (hanya saat skak, bukan skakmat) */}
            {!isCheckmate && checkInfo.attackers.length > 0 && (
              <>
                {checkInfo.attackers.map((a) => (
                  <div key={a.from} className="check-ring" style={squareOverlayStyle(a.from, flipped)} />
                ))}
                <div
                  className="check-ring check-ring-king"
                  style={squareOverlayStyle(checkInfo.kingSquare, flipped)}
                />
              </>
            )}

            {/* Raja mati saat skakmat */}
            {isCheckmate && checkInfo.kingSquare && (
              <div
                className="mate-overlay"
                style={squareOverlayStyle(checkInfo.kingSquare, flipped)}
              >
                <span className="mate-x">✕</span>
              </div>
            )}
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
                  setEvalHistory([]);
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
            evalHistory={chartHistory}
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
