import { useState } from 'react';
import { useDropdown } from '../lib/useDropdown';
import { isVerticalNavKey } from '../lib/keyboard';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SelectDropdownProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  ariaLabel: string;
}

export function SelectDropdown<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);

  const currentIndex = options.findIndex((o) => o.value === value);
  const currentOption = options[currentIndex] || options[0];

  const { containerRef, triggerRef, optionRefs, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    itemCount: options.length,
    initialFocusIndex: currentIndex >= 0 ? currentIndex : 0,
    horizontal: false,
  });

  const handleSelect = (newValue: T) => {
    if (newValue !== value) {
      onChange(newValue);
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isVerticalNavKey(e)) {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-secondary border border-border text-text-muted text-sm cursor-pointer hover:bg-bg-tertiary transition-colors"
      >
        <span>{currentOption.label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-[calc(100%+0.5rem)] right-0 min-w-[100px] bg-surface border border-border rounded-lg shadow-elevated z-50"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              role="option"
              aria-selected={value === option.value}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
              className={`w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm transition-colors hover:bg-bg-tertiary ${
                index === 0 ? 'rounded-t-lg' : ''
              } ${index === options.length - 1 ? 'rounded-b-lg' : ''} ${
                value === option.value
                  ? 'bg-bg-secondary text-text-primary'
                  : 'bg-transparent text-text-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
