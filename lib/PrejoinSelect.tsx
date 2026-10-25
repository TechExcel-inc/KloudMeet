'use client';

import React from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import styles from '../styles/PreJoin.module.css';

export interface PrejoinSelectOption<T extends string> {
  value: T;
  label: string;
  /** One short line explaining the choice: shown under the field and in the menu. */
  description?: string;
  icon: LucideIcon;
}

export interface PrejoinSelectProps<T extends string> {
  label: string;
  value: T;
  options: PrejoinSelectOption<T>[];
  onChange: (value: T) => void;
}

/** PrejoinSelect — 预加入页的下拉框：左侧标签，右侧按钮 + 自绘列表（键盘可用），替代原生 select。 */
export function PrejoinSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: PrejoinSelectProps<T>) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const buttonId = `${id}-button`;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];
  const SelectedIcon = selected.icon;

  const openList = (index = selectedIndex) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    onChange(options[index].value);
    close(true);
  };

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div className={styles.selectGroup}>
      <div className={`${styles.rowField} ${styles.selectField}`} ref={rootRef}>
        <span id={labelId} className={styles.rowLabel}>
          {label}
        </span>
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          className={styles.selectButton}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${labelId} ${buttonId}`}
          aria-describedby={selected.description ? hintId : undefined}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={onButtonKeyDown}
        >
          <SelectedIcon size={18} className={styles.selectIcon} aria-hidden="true" />
          <span className={styles.selectValue}>{selected.label}</span>
          <ChevronDown
            size={18}
            className={`${styles.selectChevron}${open ? ` ${styles.selectChevronOpen}` : ''}`}
            aria-hidden="true"
          />
        </button>
        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={`${id}-opt-${activeIndex}`}
            className={styles.selectMenu}
            onKeyDown={onListKeyDown}
          >
            {options.map((option, index) => {
              const Icon = option.icon;
              const isSelected = index === selectedIndex;
              return (
                <li
                  key={option.value}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.selectOption}${index === activeIndex ? ` ${styles.selectOptionActive}` : ''}${isSelected ? ` ${styles.selectOptionSelected}` : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                >
                  <span className={styles.selectOptionIcon}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className={styles.selectOptionText}>
                    <span className={styles.selectOptionLabel}>{option.label}</span>
                    {option.description && (
                      <span className={styles.selectOptionDesc}>{option.description}</span>
                    )}
                  </span>
                  {isSelected && (
                    <Check size={18} className={styles.selectCheck} aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected.description && (
        <p id={hintId} className={styles.fieldHint}>
          {selected.description}
        </p>
      )}
    </div>
  );
}
