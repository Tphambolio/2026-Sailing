import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PasswordGate from './PasswordGate';

// SHA-256 hex digest of "Freya2026" — matches the deployed VITE_SITE_PASSWORD_HASH.
const FREYA_HASH = '88d21ba4c7ae623f17b4c53f2f1a060ad58fa38cfda381d34799ac1ab8801225';

describe('PasswordGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('renders children directly when no password hash is configured (local dev default)', () => {
    vi.stubEnv('VITE_SITE_PASSWORD_HASH', '');
    render(<PasswordGate><p>secret content</p></PasswordGate>);
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  it('blocks children and shows the prompt when a hash is configured and nothing is unlocked yet', () => {
    vi.stubEnv('VITE_SITE_PASSWORD_HASH', FREYA_HASH);
    render(<PasswordGate><p>secret content</p></PasswordGate>);
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('unlocks and reveals children when the correct password is entered', async () => {
    vi.stubEnv('VITE_SITE_PASSWORD_HASH', FREYA_HASH);
    render(<PasswordGate><p>secret content</p></PasswordGate>);

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Freya2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() => expect(screen.getByText('secret content')).toBeInTheDocument());
    expect(localStorage.getItem('site-unlocked-hash')).toBe(FREYA_HASH);
  });

  it('shows an error and stays locked when the wrong password is entered', async () => {
    vi.stubEnv('VITE_SITE_PASSWORD_HASH', FREYA_HASH);
    render(<PasswordGate><p>secret content</p></PasswordGate>);

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() => expect(screen.getByText(/incorrect password/i)).toBeInTheDocument());
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('stays unlocked across remounts once the correct hash is stored', () => {
    localStorage.setItem('site-unlocked-hash', FREYA_HASH);
    vi.stubEnv('VITE_SITE_PASSWORD_HASH', FREYA_HASH);
    render(<PasswordGate><p>secret content</p></PasswordGate>);
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });
});
