import { useState } from 'react';

import * as Popover from '@radix-ui/react-popover';

import type { SelectorProps, SelectorTab } from '../types';

/**
 * The one selector, used by every area.
 *
 * Two independent axes and nothing else: cardinality (single for the featured
 * pane, multi for the bottom stack) and filter (overlayable for the chart
 * popup, non-overlayable for the panes). Adding an indicator anywhere in the
 * app means it appears here — the list comes from the API, never from a
 * hardcoded set.
 *
 * Laid out in columns grouped by family, because the catalogue is ~50 today and
 * plausibly hundreds later; a single scrolling list stops working well before
 * that. Favourites are the default tab so the common case opens to a short
 * list, and All is one click away for finding something new.
 *
 * Built on Radix Popover so the panel escapes its container: the pane areas
 * scroll and clip their own overflow, which left a hand-rolled absolute panel
 * cut off or pushed off-screen.
 */
export function IndicatorSelector({
  indicators,
  overlay,
  multi,
  selected,
  onChange,
  label,
  favorites,
  onToggleFavorite,
}: SelectorProps) {
  const [tab, setTab] = useState<SelectorTab>('favorites');
  const options = indicators.filter((i) => i.overlay === overlay);
  const starred = options.filter((i) => favorites.includes(i.id));
  const shown = tab === 'favorites' ? starred : options;
  const families = [...new Set(shown.map((i) => i.family))].sort();

  function toggle(id: string) {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

      return;
    }

    onChange(selected[0] === id ? [] : [id]);
  }

  return (
    <Popover.Root>
      <Popover.Trigger className="rounded border border-[#2c313a] bg-[#1a1d23] px-2 py-1 text-xs text-[#e8e8e8] hover:bg-[#22262e]">
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ''} ▾
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-[min(70vh,560px)] w-max max-w-[min(92vw,780px)] flex-col rounded-md border border-[#2c313a] bg-[#12151a] shadow-2xl"
        >
          <div className="flex items-center gap-1 border-b border-[#1c2027] px-2 py-1.5">
            <Tab active={tab === 'favorites'} onClick={() => setTab('favorites')}>
              Favorites ({starred.length})
            </Tab>
            <Tab active={tab === 'all'} onClick={() => setTab('all')}>
              All ({options.length})
            </Tab>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="ml-auto rounded px-2 py-0.5 text-[11px] text-[#6b7280] hover:bg-[#1c2027] hover:text-[#e8e8e8]"
              >
                clear
              </button>
            )}
          </div>

          {/* Families wrap as fixed-width blocks, so the panel is as wide as its
              content needs and no wider — one family stays narrow, many fill out. */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1 overflow-y-auto p-2">
            {families.map((family) => (
              <div key={family} className="w-52 shrink-0">
                <div className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-[#6b7280]">{family}</div>
                {shown
                  .filter((i) => i.family === family)
                  .map((i) => (
                    <div key={i.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[#1c2027]">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs text-[#e8e8e8]">
                        <input
                          type={multi ? 'checkbox' : 'radio'}
                          checked={selected.includes(i.id)}
                          onChange={() => toggle(i.id)}
                        />
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
                        <span className="truncate" title={i.label}>
                          {i.label}
                        </span>
                      </label>
                      <Star on={favorites.includes(i.id)} onClick={() => onToggleFavorite(i.id)} />
                    </div>
                  ))}
              </div>
            ))}

            {shown.length === 0 && (
              <div className="p-2 text-xs text-[#6b7280]">
                {tab === 'favorites' ? 'nothing starred yet — switch to All and star some' : 'none cached'}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-[11px] ${
        active ? 'bg-[#2b6cb0] text-white' : 'text-[#8b93a3] hover:bg-[#1c2027]'
      }`}
    >
      {children}
    </button>
  );
}

/** Hollow when unset, yellow when set. Present in both tabs so it toggles from anywhere. */
function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={on ? 'remove from favorites' : 'add to favorites'}
      className={`shrink-0 px-1 text-base leading-none ${on ? 'text-[#e3b341]' : 'text-[#4b5563] hover:text-[#8b93a3]'}`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
