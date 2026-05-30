import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactionSummary, ReactionWithUser } from './types';
import { EMOJI_OPTIONS, LONG_PRESS_TIMEOUT_MS } from './types';
import { useDropdown } from '../../lib/useDropdown';
import { isHorizontalNavKey } from '../../lib/keyboard';

export interface ReactionPillsProps {
  reactions: ReactionSummary[];
  userReaction: string | null;
  onReactionClick: (emoji: string) => void;
  pickerPosition?: 'above' | 'below';
  useViewportPositioning?: boolean;
  reactionDetails?: ReactionWithUser[];
  onLoadReactionDetails?: () => void;
  currentUserId?: string;
  showNames?: boolean;
}

interface ReactionPillButtonProps {
  emoji: string;
  count: number;
  isUserReaction: boolean;
  names: string[] | undefined;
  pillBaseClass: string;
  onClick: () => void;
  onLoadDetails: () => void;
  showTooltip: boolean;
  onShowTooltip: () => void;
  enableLongPress: boolean;
}

function ReactionPillButton({
  emoji,
  count,
  isUserReaction,
  names,
  pillBaseClass,
  onClick,
  onLoadDetails,
  showTooltip,
  onShowTooltip,
  enableLongPress,
}: ReactionPillButtonProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enableLongPress) return;
      longPressedRef.current = false;
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        onLoadDetails();
        onShowTooltip();
      }, LONG_PRESS_TIMEOUT_MS);
    },
    [enableLongPress, onLoadDetails, onShowTooltip]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPosRef.current) return;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
    const deltaY = Math.abs(touch.clientY - startPosRef.current.y);
    if (deltaX > 10 || deltaY > 10) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      startPosRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (longPressedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressedRef.current = false;
        return;
      }
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  return (
    <div className="relative group">
      <button
        onTouchStart={enableLongPress ? handleTouchStart : undefined}
        onTouchMove={enableLongPress ? handleTouchMove : undefined}
        onTouchEnd={enableLongPress ? handleTouchEnd : undefined}
        onClick={handleClick}
        className={`${pillBaseClass} px-2.5 gap-1 ${
          isUserReaction ? 'bg-accent/25 hover:bg-accent/35' : 'bg-bg-tertiary hover:bg-bg-border'
        }`}
        aria-label={`${isUserReaction ? 'Remove' : 'Add'} ${emoji} reaction`}
        aria-pressed={isUserReaction}
      >
        <span>{emoji}</span>
        <span className="text-text-primary font-medium">{count}</span>
      </button>
      {names && names.length > 0 && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2.5 px-2.5 py-1.5 bg-surface border border-border rounded-lg shadow-elevated text-sm text-text-secondary whitespace-nowrap transition-opacity pointer-events-none z-[70] ${
            showTooltip ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {names.join(', ')}
        </div>
      )}
    </div>
  );
}

export function ReactionPills({
  reactions,
  userReaction,
  onReactionClick,
  pickerPosition = 'below',
  useViewportPositioning = false,
  reactionDetails,
  onLoadReactionDetails,
  currentUserId,
  showNames = false,
}: ReactionPillsProps) {
  // The emoji picker is owned here (via the shared useDropdown), so the feed
  // and lightbox get identical, iOS-safe open/focus/keyboard/blur behaviour
  // without re-implementing it.
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentReactionIndex = userReaction ? EMOJI_OPTIONS.indexOf(userReaction) : 0;
  const { containerRef, triggerRef, setOptionRef, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen: pickerOpen,
    onClose: () => setPickerOpen(false),
    itemCount: EMOJI_OPTIONS.length,
    initialFocusIndex: currentReactionIndex >= 0 ? currentReactionIndex : 0,
    horizontal: true,
  });

  const selectEmoji = useCallback(
    (emoji: string) => {
      onReactionClick(emoji);
      setPickerOpen(false);
      triggerRef.current?.focus();
    },
    [onReactionClick, triggerRef]
  );

  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isHorizontalNavKey(e)) {
      e.preventDefault();
      setPickerOpen(true);
    }
  }, []);

  const hasLoadedRef = useRef(false);
  const prevReactionsRef = useRef(reactions);
  useEffect(() => {
    if (prevReactionsRef.current !== reactions) {
      prevReactionsRef.current = reactions;
      hasLoadedRef.current = false;
    }
  }, [reactions]);

  const [longPressTooltipEmoji, setLongPressTooltipEmoji] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [resizeCounter, setResizeCounter] = useState(0);

  useEffect(() => {
    if (!pickerOpen || !useViewportPositioning) return;

    const handleResize = () => setResizeCounter((c) => c + 1);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [pickerOpen, useViewportPositioning]);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;

    if (!pickerOpen || !useViewportPositioning || !triggerRef.current) {
      picker.style.position = '';
      picker.style.left = '';
      picker.style.top = '';
      picker.style.bottom = '';
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const pickerWidth = picker.offsetWidth || 280;
    const padding = 8;
    const viewportWidth = window.innerWidth;

    let left = rect.left + rect.width / 2 - pickerWidth / 2;
    left = Math.max(padding, Math.min(left, viewportWidth - pickerWidth - padding));

    picker.style.position = 'fixed';
    picker.style.left = `${left}px`;

    if (pickerPosition === 'above') {
      picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      picker.style.top = '';
    } else {
      picker.style.top = `${rect.bottom + 8}px`;
      picker.style.bottom = '';
    }
  }, [pickerOpen, useViewportPositioning, pickerPosition, resizeCounter, triggerRef]);

  useEffect(() => {
    if (!longPressTooltipEmoji) return;

    const dismiss = () => setLongPressTooltipEmoji(null);
    document.addEventListener('touchstart', dismiss);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('scroll', dismiss, true);

    return () => {
      document.removeEventListener('touchstart', dismiss);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [longPressTooltipEmoji]);

  const pillBaseClass =
    'h-9 rounded-full flex items-center justify-center text-sm transition-colors cursor-pointer select-none';

  // Names per emoji, for the hover / long-press tooltip. Sourced from the
  // detailed reaction list, which loads lazily.
  const reactionsByEmoji = useMemo(() => {
    if (!reactionDetails || reactionDetails.length === 0) return undefined;

    const grouped: Record<string, string[]> = {};
    for (const r of reactionDetails) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      const name = currentUserId && r.userId === currentUserId ? 'You' : r.userName;
      grouped[r.emoji].push(name);
    }
    return grouped;
  }, [reactionDetails, currentUserId]);

  // Counts come only from `reactions`, which is kept current optimistically.
  // They must NOT be derived from `reactionDetails`: that list loads
  // asynchronously, so using it for counts lets a late/stale load clobber an
  // optimistic update — e.g. on iOS a tap also fires mouseenter and triggers
  // the load, making the count jump +1 then snap back. Names can lag
  // harmlessly; counts cannot.
  const displayReactions = useMemo(
    () => [...reactions].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
    [reactions]
  );

  const loadNames = useCallback(() => {
    if (showNames && !hasLoadedRef.current && onLoadReactionDetails) {
      hasLoadedRef.current = true;
      onLoadReactionDetails();
    }
  }, [showNames, onLoadReactionDetails]);

  // Only hover-capable (mouse) devices load names on enter. On touch, a tap
  // also synthesizes mouseenter, so loading here would fire a redundant fetch
  // on every tap; touch users load names via long-press instead.
  const handleMouseEnter = useCallback(() => {
    if (window.matchMedia('(hover: hover)').matches) {
      loadNames();
    }
  }, [loadNames]);

  return (
    <div className="flex gap-1.5 flex-wrap items-center relative" onMouseEnter={handleMouseEnter}>
      {displayReactions.map(({ emoji, count }) => {
        const isUserReaction = userReaction === emoji;
        const names = showNames ? reactionsByEmoji?.[emoji] : undefined;
        return (
          <ReactionPillButton
            key={emoji}
            emoji={emoji}
            count={count}
            isUserReaction={isUserReaction}
            names={names}
            pillBaseClass={pillBaseClass}
            onClick={() => onReactionClick(emoji)}
            onLoadDetails={loadNames}
            showTooltip={showNames && longPressTooltipEmoji === emoji}
            onShowTooltip={() => setLongPressTooltipEmoji(emoji)}
            enableLongPress={showNames}
          />
        );
      })}

      <div ref={containerRef} className="relative" onBlur={pickerOpen ? handleBlur : undefined}>
        <button
          ref={triggerRef}
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((open) => !open);
          }}
          onKeyDown={handleTriggerKeyDown}
          className={`${pillBaseClass} w-9 ${
            pickerOpen
              ? 'bg-bg-tertiary text-text-primary'
              : 'bg-bg-tertiary hover:bg-bg-border text-text-secondary'
          }`}
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
        >
          +
        </button>

        {pickerOpen && (
          <div
            ref={pickerRef}
            role="listbox"
            aria-label="Select reaction"
            className={`z-[60] bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1 ${
              useViewportPositioning
                ? ''
                : `absolute right-0 ${pickerPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`
            }`}
          >
            {EMOJI_OPTIONS.map((emoji, index) => (
              <button
                key={emoji}
                ref={setOptionRef(index)}
                role="option"
                aria-selected={userReaction === emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  selectEmoji(emoji);
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, index)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors cursor-pointer ${
                  userReaction === emoji
                    ? 'bg-accent/25 hover:bg-accent/35'
                    : 'hover:bg-bg-tertiary'
                }`}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
