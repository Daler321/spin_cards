import type { MiniGameId } from '@spincards/shared';

/** Own line icons for the mini-game tiles (no third-party art). */
export function MiniGameIcon({ game }: { game: MiniGameId }) {
  return (
    <svg className="game-tile-icon" viewBox="0 0 48 48" aria-hidden="true">
      {game === 'mines' && (
        <>
          <rect x="6" y="6" width="16" height="16" rx="3" />
          <rect x="26" y="6" width="16" height="16" rx="3" />
          <rect x="6" y="26" width="16" height="16" rx="3" />
          <circle cx="34" cy="34" r="6" className="fill" />
          <path d="M34 25v3M34 40v3M25 34h3M40 34h3" />
        </>
      )}
      {game === 'plinko' && (
        <>
          {[
            [24, 8],
            [18, 16],
            [30, 16],
            [12, 24],
            [24, 24],
            [36, 24],
          ].map(([x, y]) => (
            <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r="2" className="fill" />
          ))}
          <path d="M6 34h36M6 34v8h36v-8M15 34v8M24 34v8M33 34v8" />
          <circle cx="21" cy="29" r="3" />
        </>
      )}
      {game === 'coinflip' && (
        <>
          <circle cx="24" cy="24" r="17" />
          <circle cx="24" cy="24" r="12" />
          <path d="M24 16l2.4 5 5.4.6-4 3.7 1.1 5.3-4.9-2.7-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z" />
        </>
      )}
      {game === 'blackjack' && (
        <>
          <rect x="8" y="10" width="20" height="28" rx="3" transform="rotate(-10 18 24)" />
          <rect x="20" y="10" width="20" height="28" rx="3" transform="rotate(8 30 24)" />
          <path
            d="M30 20c-3 3-5 5-2 7 1 .6 2 .2 2-.6 0 .8 1 1.2 2 .6 3-2 1-4-2-7z"
            className="fill"
          />
        </>
      )}
    </svg>
  );
}
