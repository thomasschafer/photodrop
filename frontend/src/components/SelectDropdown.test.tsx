import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SelectDropdown } from './SelectDropdown';

const options = [
  { value: 'newest' as const, label: 'Newest' },
  { value: 'oldest' as const, label: 'Oldest' },
];

function setup(onChange = vi.fn()) {
  render(
    <SelectDropdown value="newest" onChange={onChange} options={options} ariaLabel="Sort order" />
  );
  return onChange;
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /newest/i }));
  return screen.getByRole('listbox');
}

describe('SelectDropdown', () => {
  it('selects an option on click and closes', () => {
    const onChange = setup();
    const listbox = openMenu();

    fireEvent.click(within(listbox).getByRole('option', { name: 'Oldest' }));

    expect(onChange).toHaveBeenCalledWith('oldest');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('stays open when an option blurs with no relatedTarget (iOS button tap)', () => {
    // iOS Safari doesn't focus a tapped button, so the focused option blurs
    // with relatedTarget=null right before its click. The menu must stay open
    // so the click can select; closing here is the bug we fixed.
    setup();
    const listbox = openMenu();
    const oldest = within(listbox).getByRole('option', { name: 'Oldest' });

    fireEvent.blur(oldest, { relatedTarget: null });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes when focus tabs out to an element outside the dropdown', () => {
    const onChange = setup();
    const listbox = openMenu();
    const oldest = within(listbox).getByRole('option', { name: 'Oldest' });

    // A real tab-out has a relatedTarget outside the container.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.blur(oldest, { relatedTarget: outside });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    outside.remove();
  });
});
